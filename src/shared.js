/**
 * Shared utilities — mirrors hub-sdk.js for use in logic.js tests (no browser env).
 */

export function isAdult(member) {
  return !!member && (member.role === "adult" || member.role === "admin" || member.role === "owner");
}
