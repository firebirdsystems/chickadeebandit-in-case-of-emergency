import { describe, it, expect } from "vitest";
import { testPrivilegedGateContract } from "./helpers/privileged-gate.mjs";
import {
  CATEGORIES, normalizeCategory, accessGroup, isInAccessGroup,
  visibilityForMode, canSeeEntry, canEditEntry, canContribute, groupByCategory, searchableFields,
} from "../src/logic.js";

const adultIn   = { id: "a1", role: "adult" };   // adult, in the access group
const adultOut  = { id: "a2", role: "adult" };   // adult, not in the access group
const child     = { id: "c1", role: "child" };   // non-adult
const GROUPS    = [{ id: "g1", name: "Trusted Circle", memberIds: ["a1"] }];
const GID       = "g1";

function entry(over = {}) {
  return { id: "e", category: "accounts", title: "t", details: "", location_hint: "", visibility: "adults", sort_order: 0, created_by: "a2", created_at: "2026-01-01", ...over };
}

describe("categories", () => {
  it("normalizeCategory falls back to 'other' for unknown keys", () => {
    expect(normalizeCategory("accounts")).toBe("accounts");
    expect(normalizeCategory("nope")).toBe("other");
  });
  it("every category key is unique", () => {
    const keys = CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("accessGroup / visibilityForMode", () => {
  it("accessGroup returns null when unset or dangling", () => {
    expect(accessGroup(GROUPS, null)).toBe(null);
    expect(accessGroup(GROUPS, "missing")).toBe(null);
    expect(accessGroup(GROUPS, GID)).toEqual(GROUPS[0]);
  });
  it("visibilityForMode maps mode to the stored visibility value", () => {
    expect(visibilityForMode("group")).toBe("group");
    expect(visibilityForMode("all_adults")).toBe("adults");
    expect(visibilityForMode(undefined)).toBe("adults");
  });
});

// isInAccessGroup fronts the 'group' privileged read/bypass — pin it to the hub.
testPrivilegedGateContract("isInAccessGroup", isInAccessGroup, {
  member: adultIn, outsider: adultOut, groups: GROUPS, groupId: GID,
  // This app's manifest declares privileged_groups[0].on_unresolvable: "adults".
  onUnresolvable: "adults",
});

describe("canSeeEntry (mirrors owner_or_visibility SELECT)", () => {
  it("all-adults entries: every adult sees them, children do not", () => {
    const e = entry({ visibility: "adults" });
    expect(canSeeEntry(e, adultIn, GROUPS, GID)).toBe(true);
    expect(canSeeEntry(e, adultOut, GROUPS, GID)).toBe(true);
    expect(canSeeEntry(e, child, GROUPS, GID)).toBe(false);
  });
  it("group entries: only group members see them", () => {
    const e = entry({ visibility: "group", created_by: "author-x" });
    expect(canSeeEntry(e, adultIn, GROUPS, GID)).toBe(true);   // in group
    expect(canSeeEntry(e, adultOut, GROUPS, GID)).toBe(false); // adult, not in group
  });
  it("the author always sees their own entry regardless of visibility", () => {
    const e = entry({ visibility: "group", created_by: "a2" });
    expect(canSeeEntry(e, adultOut, GROUPS, GID)).toBe(true);
  });
  it("no one sees anything without a member identity", () => {
    expect(canSeeEntry(entry(), null, GROUPS, GID)).toBe(false);
  });
});

describe("canEditEntry (mirrors write_visibility_scoped — writes follow reads)", () => {
  it("an adult may edit an all-adults entry they don't own (they can see it)", () => {
    expect(canEditEntry(entry({ visibility: "adults", created_by: "someone" }), adultOut, GROUPS, GID)).toBe(true);
  });
  it("a non-group adult may NOT edit a group entry they can't see", () => {
    expect(canEditEntry(entry({ visibility: "group", created_by: "author-x" }), adultOut, GROUPS, GID)).toBe(false);
  });
  it("a group member may edit any entry", () => {
    expect(canEditEntry(entry({ visibility: "group", created_by: "someone" }), adultIn, GROUPS, GID)).toBe(true);
    expect(canEditEntry(entry({ visibility: "adults", created_by: "someone" }), adultIn, GROUPS, GID)).toBe(true);
  });
  it("a non-adult may edit only their own entry", () => {
    expect(canEditEntry(entry({ visibility: "adults", created_by: "c1" }), child, GROUPS, GID)).toBe(true);
    expect(canEditEntry(entry({ visibility: "adults", created_by: "x" }), child, GROUPS, GID)).toBe(false);
  });
});

describe("canContribute", () => {
  it("all-adults mode: any adult may contribute, children may not", () => {
    expect(canContribute(adultOut, GROUPS, "all_adults", GID)).toBe(true);
    expect(canContribute(child, GROUPS, "all_adults", GID)).toBe(false);
  });
  it("group mode: only group members may contribute", () => {
    expect(canContribute(adultIn, GROUPS, "group", GID)).toBe(true);
    expect(canContribute(adultOut, GROUPS, "group", GID)).toBe(false);
  });
});

describe("groupByCategory", () => {
  it("orders by CATEGORIES, drops empty ones, sorts within a category", () => {
    const grouped = groupByCategory([
      entry({ id: "2", category: "contacts", sort_order: 1 }),
      entry({ id: "1", category: "accounts", sort_order: 5 }),
      entry({ id: "3", category: "accounts", sort_order: 1 }),
    ]);
    expect(grouped.map(g => g.key)).toEqual(["accounts", "contacts"]);
    expect(grouped[0].items.map(i => i.id)).toEqual(["3", "1"]); // by sort_order
  });
});

describe("searchableFields", () => {
  it("matches on the details, which is where the actual information lives", () => {
    const fields = searchableFields({ title: "House deeds", details: "green folder, top of the wardrobe", category: "documents", location_hint: "" });
    expect(fields).toContain("green folder, top of the wardrobe");
  });
});
