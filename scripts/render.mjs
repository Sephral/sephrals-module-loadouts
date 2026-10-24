// Small HTML pieces shared by the dialogs.

import { escapeHtml } from "./core.mjs";

export function renderPreflightSection(label, items, { html = false } = {}) {
  if (!items.length) return "";
  const entries = items
    .map((item) => `<li>${html ? item : escapeHtml(item)}</li>`)
    .join("");
  return `<section><p><strong>${label}</strong></p><ul>${entries}</ul></section>`;
}
