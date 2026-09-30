import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const html = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An app with nothing to preload (kv/none storage, or no bounded first read)
// declares no `preload`; the checks below then hold vacuously until it adds one.
const preload = manifest.preload ?? {};

// The client expression each declared param must be posted as. `:me` is the
// hub-resolved member id, which the app reads as `ME.id`.
const PARAM_SOURCE = { ":me": "ME.id" };

// The hub runs `manifest.preload` while rendering the document and answers the
// app's matching api/db request from the embedded rows — matching on the
// statement text with whitespace collapsed AND the params. A drifted copy is
// not an error anywhere: it is a preload that silently never answers. So the
// manifest is checked against the source here.
describe("manifest.preload mirrors the app's first-render reads", () => {
  const body = norm(html);
  const prefix = `app_${manifest.id.replace(/-/g, "_")}__`;

  it("db() posts { sql, params } and ME is the hub's current member", () => {
    expect(body).toContain("body: JSON.stringify({ sql, params })");
    if (Object.values(preload).some(({ params = [] }) => params.includes(":me"))) {
      expect(body).toMatch(/const ME\s*=\s*window\.__CURRENT_MEMBER\b/);
    }
  });

  it("declares statements the app posts — the WHOLE db(…) call, text and params", () => {
    // The whole quoted argument plus the params that follow it, not a substring
    // of the SQL: a statement that is a prefix of the posted one (a paging or
    // filter suffix), or the right text posted with different params, would
    // pass a substring check and never answer a request.
    for (const [name, { sql, params = [] }] of Object.entries(preload)) {
      for (const p of params) expect(PARAM_SOURCE[p], `${name}: no client source known for param ${p}`).toBeDefined();
      const args = params.length ? `, ?\\[${params.map((p) => reEsc(PARAM_SOURCE[p])).join(", ")}\\],? ?` : ",? ?";
      const call = new RegExp(`db\\( ?([\`"'])${reEsc(norm(sql))}\\1${args}\\)`);
      expect(call.test(body), `preload.${name} is not a db(…) call src/index.html posts`).toBe(true);
    }
  });

  it("stays within the hub's caps and reads only this app's tables", () => {
    expect(Object.keys(preload).length).toBeLessThanOrEqual(6);
    for (const [name, { sql, params = [] }] of Object.entries(preload)) {
      expect(sql, name).toMatch(/^(SELECT|WITH) /);
      expect(sql, name).not.toMatch(/;|--/);
      for (const table of sql.match(/(?:FROM|JOIN)\s+(\w+)/g) ?? []) expect(table, name).toMatch(new RegExp(`\\s${prefix}`));
      expect((sql.match(/\?/g) ?? []).length, `${name}: placeholders vs params`).toBe(params.length);
    }
  });
});
