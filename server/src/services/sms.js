const db = require('../config/db');
const env = require('../config/env');

/**
 * Arkasel HTTP SMS contract (configurable via env):
 *   POST {ARKASEL_ENDPOINT}
 *   Headers: {Content-Type: application/json,
 *             <ARKASEL_AUTH_HEADER>: <ARKASEL_AUTH_SCHEME><ARKASEL_API_KEY>}
 *   Body:    {sender, to, message}
 * A 2xx response counts as delivered. Adjust ARKASEL_AUTH_HEADER /
 * ARKASEL_AUTH_SCHEME if the gateway expects a different auth style.
 */
function isArkaselConfigured() {
  return Boolean(env.arkasel.endpoint && env.arkasel.apiKey);
}

async function sendViaArkasel(phone, message) {
  const { endpoint, apiKey, senderId, authHeader, authScheme } = env.arkasel;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers[authHeader] = `${authScheme}${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sender: senderId, to: phone, message }),
  });
  const response = (await res.text().catch(() => '')).slice(0, 500);
  return { ok: res.ok, status: res.status, response };
}

/** Replace {{first_name}} {{full_name}} {{church_name}} placeholders. */
function renderTemplate(template, vars) {
  const v = vars || {};
  const first = String(v.full_name || '').split(' ')[0];
  return String(template || '')
    .replace(/{{\s*first_name\s*}}/gi, first)
    .replace(/{{\s*full_name\s*}}/gi, v.full_name || '')
    .replace(/{{\s*church_name\s*}}/gi, v.church_name || '')
    .trim();
}

module.exports = { isArkaselConfigured, sendViaArkasel, renderTemplate };