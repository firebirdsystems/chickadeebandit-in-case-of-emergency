// Printing without a second window.
//
// The binder used to be written into a popup (`window.open("", "_blank")`). The
// hub's app frame does not grant popups, so it is now built into a container
// in THIS document that is `display: none` on screen at all times and shown
// only by `@media print` while <html> carries PRINTING_CLASS (the rules live in
// index.html). Nothing here imports the SDK or touches a global, so the markup
// and the lifecycle are both testable from Node.

import { groupByCategory } from "./logic.js";

export const PRINT_ROOT_CLASS = "print-root";
export const PRINTING_CLASS = "printing";

/**
 * The printable binder, as markup for the print container.
 *
 * `entries` must ALREADY be filtered to what this member may see — the caller
 * applies `canSeeEntry`; this function prints everything it is handed.
 * `esc` is the SDK's HTML escape and `glyph` its icon helper; both are passed
 * in because this module must stay importable without the hub. EVERY stored
 * value goes through `esc`. This is the complete list of what reaches paper;
 * add nothing to it lightly.
 */
export function printBinderMarkup({ entries, printedOn }, { esc, glyph }) {
  const sections = groupByCategory(entries).map(cat => `
        <h2>${glyph(cat.glyph)} ${esc(cat.label)}</h2>
        ${cat.items.map(e => `
          <div class="p-entry">
            <div class="p-title">${esc(e.title)}</div>
            ${e.location_hint ? `<div class="p-loc">Where: ${esc(e.location_hint)}</div>` : ""}
            ${e.details ? `<div class="p-details">${esc(e.details)}</div>` : ""}
          </div>`).join("")}
      `).join("");

  return `
        <h1>${glyph("sos")} In Case of Emergency</h1>
        <div class="meta">Printed ${esc(printedOn)} · Keep this somewhere a trusted person can find it.</div>
        ${sections || "<p>No entries.</p>"}`;
}

// The teardown of the print that is still open, if any.
let endCurrentPrint = null;

/**
 * Print `markup` from this document: mount it in a hidden container, flag
 * <html>, call `win.print()`, and take all of it away again afterwards.
 *
 * Teardown runs once, on whichever comes first:
 *   - `afterprint`;
 *   - the `print` media query going false (browsers that skip `afterprint`);
 *   - `pagehide`;
 *   - the first pointer or key event after `print()` has returned. The print
 *     dialog is modal, so input reaching the page means it is gone. This is
 *     the fallback for a browser that fires neither of the first two, and it
 *     is armed only after `print()` returns so the click that started the
 *     print cannot end it.
 * There is deliberately no timer: where `print()` does not block, a timer
 * would empty the page out from under an open print preview.
 *
 * Returns the teardown (idempotent), or null when printing is unavailable.
 */
export function printInPlace(win, markup, { title } = {}) {
  if (endCurrentPrint) endCurrentPrint();
  const doc = win?.document;
  if (!doc?.body || typeof win.print !== "function") return null;

  const root = doc.createElement("div");
  root.className = PRINT_ROOT_CLASS;
  root.innerHTML = markup;
  doc.body.appendChild(root);

  const previousTitle = doc.title;
  if (title) doc.title = title; // names the print job / the saved PDF
  doc.documentElement.classList.add(PRINTING_CLASS);

  const media = typeof win.matchMedia === "function" ? win.matchMedia("print") : null;
  const INPUT_EVENTS = ["pointerdown", "keydown"];
  let done = false;
  let armTimer = null;

  function onMedia(event) { if (!event.matches) finish(); }
  function finish() {
    if (done) return;
    done = true;
    root.remove();
    doc.documentElement.classList.remove(PRINTING_CLASS);
    if (title) doc.title = previousTitle;
    win.removeEventListener("afterprint", finish);
    win.removeEventListener("pagehide", finish);
    for (const name of INPUT_EVENTS) win.removeEventListener(name, finish, true);
    media?.removeEventListener?.("change", onMedia);
    if (armTimer !== null) win.clearTimeout(armTimer);
    if (endCurrentPrint === finish) endCurrentPrint = null;
  }
  endCurrentPrint = finish;

  win.addEventListener("afterprint", finish);
  win.addEventListener("pagehide", finish);
  media?.addEventListener?.("change", onMedia);

  try {
    win.print();
  } catch {
    finish();
    return null;
  }
  if (!done) {
    armTimer = win.setTimeout(() => {
      armTimer = null;
      if (done) return;
      for (const name of INPUT_EVENTS) win.addEventListener(name, finish, true);
    }, 0);
  }
  return finish;
}
