# In Case of Emergency 🆘

A shared household binder for the things another adult would need to know if you
were suddenly unavailable — where documents live, account & utility details, who
to call, medical info, passwords, and how to run the household.

Built for the Chickadee Bandit hub. Static HTML/JS + a per-household D1 database.

## What it does

- **Structured entries** grouped into categories (Accounts & Bills, Documents,
  People to Call, Household & How-To, Medical, Passwords & Digital, Other).
  Each entry has a title, a "where to find it" hint, and free-text details.
- **Encrypted at rest** — titles, details, and location hints are encrypted by
  the hub before they hit the database.
- **Access control** — one app-wide setting (admin-managed) chooses who can see
  the binder:
  - **All adults** (default) — every adult in the household can read and add
    entries; children cannot.
  - **A specific group** — only members of a designated hub group (plus each
    entry's own author) can see the binder.
- **Print / Save as PDF** — produces a clean, printable copy to hand to a
  trusted person or keep somewhere findable. This is the intended way to share
  the binder with someone outside the household; there is no automated external
  delivery.

## Access model details

Enforcement is server-side via the `entries` table's `owner_or_visibility` row
policy with **`write_visibility_scoped: true`** (see `manifest.json`). The
app-wide mode is stored in the `app_config` `settings` table (`access_mode`,
`access_group_id`) and written only through the hub's admin-config endpoint.
Every entry carries a plaintext `visibility` value (`adults` or `group`) derived
from the current mode; changing the mode re-labels all entries so the whole
binder follows the new setting.

`write_visibility_scoped` makes **writes follow reads**: the access group may
edit any entry, and everyone else may create/edit/delete exactly the entries
they can see. A member can never blind-write or delete an entry they can't even
see — closing the gap where a non-group adult could otherwise wipe group-only
entries. Both reads and writes are fully enforced by the hub.

Notes / current limitations:

- **Mode-switch re-key is fail-safe, not always complete.** Widening the
  audience (group → all adults) is performed by whoever changes the setting; if
  that admin isn't in the group they can't see (and so can't re-key) the
  group-only rows, which then stay restricted. The failure is always
  *over-restrictive*, never a disclosure. In practice the admin who set up group
  mode is in the group. (Narrowing all adults → group always completes, since
  the rows are adult-visible at that moment.)
- **Children can still create their own entries** via direct SQL (INSERT isn't
  adult-gated without a group). Confidentiality holds — they can only see/edit
  their own — so this is a low-stakes nuisance, not a leak.
- **No file/document attachments** yet. The hub's document/file sharing is
  whole-household or owner-only and can't be scoped to "adults or group", so
  attaching files would leak them to children. The `location_hint` field covers
  the "where the document is" need instead. Attachments are a future item.
- **No "dead man's switch."** Releasing the binder after a period of inactivity
  (or emailing it to external contacts) would require hub-side work — a per-user
  check-in timestamp, a cron job, and an external-email capability — none of
  which an app bundle can provide. Out of scope by design.

## Development

```bash
npm install
npm run dev     # http://localhost:3001 (demo data when no hub is attached)
npm test        # vitest — manifest + access-logic + privileged-gate contract
npm run build   # writes dist/bundle.json
```

Access logic lives in `src/logic.js` (pure, unit-tested); `src/shared.js`
mirrors the hub-sdk helpers used by logic so tests need no browser.
