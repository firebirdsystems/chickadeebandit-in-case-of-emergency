import { isAdult } from "./shared.js";
export { isAdult };

/**
 * Categories the binder is organised into. `key` is stored plaintext in the
 * `category` column; `label`/`icon` are display-only.
 */
export const CATEGORIES = [
  { key: "accounts",   label: "Accounts & Bills",   icon: "🏦" },
  { key: "documents",  label: "Documents",          icon: "📄" },
  { key: "contacts",   label: "People to Call",     icon: "📇" },
  { key: "household",  label: "Household & How-To", icon: "🏠" },
  { key: "medical",    label: "Medical",            icon: "🩺" },
  { key: "digital",    label: "Passwords & Digital",icon: "🔐" },
  { key: "other",      label: "Other",              icon: "🗒️" },
];

const CATEGORY_KEYS = new Set(CATEGORIES.map(c => c.key));

export function categoryMeta(key) {
  return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];
}

export function normalizeCategory(key) {
  return CATEGORY_KEYS.has(key) ? key : "other";
}

/**
 * Resolve the hub group designated as the access group, or null when none is
 * configured (or the configured id points at a group that no longer exists).
 */
export function accessGroup(groups, groupId) {
  if (!groupId) return null;
  return (groups ?? []).find(g => g.id === groupId) ?? null;
}

/**
 * Whether a member belongs to the configured access group.
 *
 * MUST mirror the hub's `memberInAppGroupSetting` (the resolver behind the
 * `entries` policy's `bypass_group_setting` / `privileged_values` grant):
 * privileged IFF a group is configured AND it still exists AND the member is in
 * it. There is deliberately NO "all adults" fallback when unset — the hub grants
 * no bypass in that state. Gate signature is (member, groups, groupId) so it can
 * be checked with testPrivilegedGateContract.
 */
export function isInAccessGroup(member, groups, groupId) {
  if (!member) return false;
  const g = accessGroup(groups, groupId);
  return !!g && g.memberIds.includes(member.id);
}

/**
 * The single visibility value the app stamps on every entry, derived from the
 * app-wide access mode. 'group' rows are readable only by the access group (+
 * owner); 'adults' rows are readable by every adult (+ owner).
 */
export function visibilityForMode(mode) {
  return mode === "group" ? "group" : "adults";
}

/**
 * Whether `me` may SEE an entry. Mirrors the server `owner_or_visibility` SELECT
 * rule: owner always; otherwise the row's visibility must be in the caller's
 * granted set — 'adults' when the caller is an adult, 'group' when the caller is
 * in the access group.
 */
export function canSeeEntry(entry, me, groups, groupId) {
  if (!me) return false;
  if (entry.created_by === me.id) return true;
  const granted = [];
  if (isAdult(me)) granted.push("adults");
  if (isInAccessGroup(me, groups, groupId)) granted.push("group");
  return granted.includes(entry.visibility);
}

/**
 * Whether `me` may EDIT/DELETE an entry. Mirrors the server `entries` policy's
 * write_visibility_scoped rule — writes follow reads: the access group may edit
 * any row, and everyone else may edit exactly the rows they can see (their own,
 * plus rows whose visibility grants them read). A member can never edit or
 * delete a row they can't even see.
 */
export function canEditEntry(entry, me, groups, groupId) {
  if (!me) return false;
  if (isInAccessGroup(me, groups, groupId)) return true; // privileged: any row
  return canSeeEntry(entry, me, groups, groupId);        // else: what you can read
}

/**
 * Who may add entries and manage the binder, given the current access mode.
 * In group mode this is the access group; otherwise any adult. This is
 * stricter-than-or-equal-to the server (which allows any member to INSERT their
 * own row), so it never shows UI the hub then blocks with a 403.
 */
export function canContribute(me, groups, mode, groupId) {
  if (!me) return false;
  if (mode === "group") return isInAccessGroup(me, groups, groupId);
  return isAdult(me);
}

/**
 * Group an array of entries by category, preserving CATEGORIES order and
 * dropping empty categories. Entries within a category are ordered by
 * sort_order then created_at.
 */
export function groupByCategory(entries) {
  const byKey = new Map();
  for (const e of entries ?? []) {
    const key = normalizeCategory(e.category);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }
  const out = [];
  for (const cat of CATEGORIES) {
    const items = byKey.get(cat.key);
    if (!items || items.length === 0) continue;
    items.sort((a, b) =>
      (a.sort_order - b.sort_order) ||
      String(a.created_at).localeCompare(String(b.created_at))
    );
    out.push({ ...cat, items });
  }
  return out;
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * The details are the whole entry — where a document lives, which
 * account, who to ring. Under pressure this is looked up by fragment,
 * not by browsing categories.
 */
export function searchableFields(item) {
  return [item.title, item.details, item.category, item.location_hint];
}
