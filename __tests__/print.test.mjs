import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";
import { printBinderMarkup, printInPlace, PRINT_ROOT_CLASS, PRINTING_CLASS } from "../src/print.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "../src/index.html"), "utf-8");

// The SDK's `esc`, restated: the SDK is served by the hub and is not in this repo.
const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const glyph = (name) => `[glyph:${name}]`;
const helpers = { esc, glyph };

const XSS = `<script>alert("x")</script>`;
const XSS_ESCAPED = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;";

const entry = (over) => ({
  id: "e1", category: "accounts", title: "Bank", location_hint: "", details: "",
  sort_order: 0, created_at: "2026-01-01", ...over,
});

describe("printBinderMarkup", () => {
  it("prints the heading, the date line, and every field of every entry under its category", () => {
    const out = printBinderMarkup({
      entries: [
        entry({ id: "1", category: "medical", title: "GP surgery", location_hint: "Fridge door", details: "Dr Lee\n555-0100" }),
        entry({ id: "2", category: "accounts", title: "Joint account", location_hint: "Blue folder", details: "Sort code 00-00-00" }),
      ],
      printedOn: "October 7, 2026",
    }, helpers);
    for (const text of [
      "<h1>[glyph:sos] In Case of Emergency</h1>",
      "Printed October 7, 2026 · Keep this somewhere a trusted person can find it.",
      "<h2>[glyph:bank] Accounts &amp; Bills</h2>",
      `<div class="p-title">Joint account</div>`,
      `<div class="p-loc">Where: Blue folder</div>`,
      `<div class="p-details">Sort code 00-00-00</div>`,
      "<h2>[glyph:stethoscope] Medical</h2>",
      `<div class="p-title">GP surgery</div>`,
      `<div class="p-loc">Where: Fridge door</div>`,
      `<div class="p-details">Dr Lee\n555-0100</div>`,
    ]) expect(out, text).toContain(text);
    // Category order follows CATEGORIES, not input order.
    expect(out.indexOf("Accounts &amp; Bills")).toBeLessThan(out.indexOf("Medical"));
    expect(out).not.toContain("No entries.");
  });

  it("escapes every interpolated value", () => {
    const out = printBinderMarkup({
      entries: [entry({ title: XSS, location_hint: XSS, details: XSS })],
      printedOn: XSS,
    }, helpers);
    expect(out).not.toContain("<script");
    // title + location + details + date
    expect(out.split(XSS_ESCAPED).length - 1).toBe(4);
  });

  it("omits the optional lines an entry does not have", () => {
    const out = printBinderMarkup({ entries: [entry({ title: "Bank" })], printedOn: "x" }, helpers);
    expect(out).toContain(`<div class="p-title">Bank</div>`);
    expect(out).not.toContain("p-loc");
    expect(out).not.toContain("p-details");
  });

  it("prints exactly the entries it is handed — visibility is the caller's filter", () => {
    const out = printBinderMarkup({ entries: [entry({ title: "Only this" })], printedOn: "x" }, helpers);
    expect(out.split('class="p-entry"').length - 1).toBe(1);
  });

  it("says so when there are no entries", () => {
    const out = printBinderMarkup({ entries: [], printedOn: "x" }, helpers);
    expect(out).toContain("<p>No entries.</p>");
    expect(out).not.toContain("<h2>");
  });

  it("carries no script, handler, or control of its own", () => {
    const out = printBinderMarkup({ entries: [entry({ details: "d", location_hint: "l" })], printedOn: "x" }, helpers);
    expect(out).not.toMatch(/<script|<button|\son\w+=/i);
  });
});

// ── printInPlace ────────────────────────────────────────────────────────────
// A window with just the surface printInPlace uses. `onPrint` stands in for the
// browser's print dialog; timers are collected so the test decides when they run.
function fakeWindow({ onPrint = () => {}, withMedia = true } = {}) {
  const listeners = new Map();
  const mediaListeners = new Set();
  const timers = [];
  const children = [];
  const classes = new Set();
  const win = {
    printCalls: 0,
    timers,
    children,
    classes,
    document: {
      title: "App",
      body: { appendChild(node) { children.push(node); node.parent = children; } },
      documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } },
      createElement: () => ({
        className: "", innerHTML: "", parent: null,
        remove() { const i = children.indexOf(this); if (i >= 0) children.splice(i, 1); },
      }),
    },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn({ type: name }); },
    listenerCount() { let n = mediaListeners.size; for (const set of listeners.values()) n += set.size; return n; },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1] = null; },
    runTimers() { for (const fn of timers.splice(0)) fn?.(); },
    fireMedia(matches) { for (const fn of [...mediaListeners]) fn({ matches }); },
    print() { win.printCalls++; onPrint(win); },
  };
  if (withMedia) {
    win.matchMedia = () => ({
      addEventListener: (_name, fn) => mediaListeners.add(fn),
      removeEventListener: (_name, fn) => mediaListeners.delete(fn),
    });
  }
  return win;
}

function expectClean(win) {
  expect(win.children).toEqual([]);
  expect(win.classes.has(PRINTING_CLASS)).toBe(false);
  expect(win.document.title).toBe("App");
  expect(win.listenerCount()).toBe(0);
}

describe("printInPlace", () => {
  it("mounts the markup in a print root, flags <html>, and prints this window", () => {
    let seen = null;
    const win = fakeWindow({
      onPrint: (w) => { seen = { root: w.children[0], printing: w.classes.has(PRINTING_CLASS), title: w.document.title }; },
    });
    printInPlace(win, "<p>card</p>", { title: "Job" });
    expect(win.printCalls).toBe(1);
    expect(seen.root.className).toBe(PRINT_ROOT_CLASS);
    expect(seen.root.innerHTML).toBe("<p>card</p>");
    expect(seen.printing).toBe(true);
    expect(seen.title).toBe("Job");
    win.fire("afterprint");
  });

  it("leaves nothing behind when afterprint fires during print() (blocking dialog)", () => {
    const win = fakeWindow({ onPrint: (w) => w.fire("afterprint") });
    printInPlace(win, "<p>card</p>", { title: "Job" });
    win.runTimers();
    expectClean(win);
  });

  it("leaves nothing behind when afterprint fires later (non-blocking dialog)", () => {
    const win = fakeWindow();
    printInPlace(win, "<p>card</p>", { title: "Job" });
    win.runTimers();
    expect(win.children.length).toBe(1); // still there for the open dialog
    win.fire("afterprint");
    expectClean(win);
  });

  it("cleans up when the print media query goes false and afterprint never fires", () => {
    const win = fakeWindow();
    printInPlace(win, "<p>card</p>", { title: "Job" });
    win.fireMedia(true);
    expect(win.children.length).toBe(1);
    win.fireMedia(false);
    expectClean(win);
  });

  it("falls back to the first input after print() returned when no print event ever fires", () => {
    const win = fakeWindow({ withMedia: false });
    printInPlace(win, "<p>card</p>", { title: "Job" });
    // The click that started the print is still being dispatched: it must not end it.
    win.fire("pointerdown");
    expect(win.children.length).toBe(1);
    win.runTimers();
    win.fire("pointerdown");
    expectClean(win);
  });

  it("cleans up on pagehide and on a keypress", () => {
    const a = fakeWindow();
    printInPlace(a, "<p>card</p>", { title: "Job" });
    a.fire("pagehide");
    expectClean(a);

    const b = fakeWindow();
    printInPlace(b, "<p>card</p>", { title: "Job" });
    b.runTimers();
    b.fire("keydown");
    expectClean(b);
  });

  it("a second print replaces the first rather than stacking two cards", () => {
    const win = fakeWindow();
    printInPlace(win, "<p>one</p>", { title: "Job" });
    printInPlace(win, "<p>two</p>", { title: "Job" });
    expect(win.children.map(c => c.innerHTML)).toEqual(["<p>two</p>"]);
    win.fire("afterprint");
    expectClean(win);
  });

  it("cleans up and returns null when print() throws", () => {
    const win = fakeWindow({ onPrint: () => { throw new Error("blocked"); } });
    expect(printInPlace(win, "<p>card</p>", { title: "Job" })).toBe(null);
    expectClean(win);
  });

  it("the returned teardown is idempotent", () => {
    const win = fakeWindow();
    const end = printInPlace(win, "<p>card</p>", { title: "Job" });
    end(); end();
    win.fire("afterprint");
    expectClean(win);
  });
});

// ── The page wiring ─────────────────────────────────────────────────────────
describe("index.html prints in place", () => {
  it("opens no window and writes no second document", () => {
    expect(html).not.toMatch(/window\.open\s*\(/);
    expect(html).not.toMatch(/document\.write\s*\(/);
  });

  it("keeps the print root off screen and shows only it in print", () => {
    const css = html.replace(/\s+/g, " ");
    expect(css).toMatch(/\.print-root \{ display: none;/);
    const printBlock = css.match(/@media print \{(.*?)\} \}/)?.[1] ?? "";
    expect(printBlock).toContain("html.printing body > *:not(.print-root) { display: none !important; }");
    expect(printBlock).toContain("html.printing .print-root { display: block;");
    // The root itself is given a visible display nowhere outside print media.
    expect(css.split("@media print")[0]).not.toMatch(/\.print-root \{[^}]*display: (?!none)/);
  });
});

describe("printBinder still filters by visibility before printing", () => {
  it("hands printBinderMarkup only entries that pass canSeeEntry", () => {
    const fn = html.slice(html.indexOf("window.printBinder ="), html.indexOf("// ── Init"));
    expect(fn).toMatch(/const visible = entries\.filter\(e => canSeeEntry\(e, ME, groups, settings\.access_group_id\)\);/);
    expect(fn).toMatch(/printBinderMarkup\(\{ entries: visible, printedOn \}/);
  });
});
