// load-tests/utils/http-client.js

let uuidSeq = 0;

/**
 * Generates a unique RFC 9562 UUIDv7 string in pure ES6 JavaScript without external dependencies.
 * Incorporates virtual user ID (__VU) and chunked 24-bit entropy within safe integer precision
 * to guarantee collision resistance across parallel k6 Goja runtimes.
 *
 * @returns {string}
 */
export function generateUuid() {
  const now = Date.now();
  uuidSeq = (uuidSeq + 1) & 0xfff;
  const vuId = (typeof __VU !== "undefined" ? __VU : 0) & 0xff;

  const timeHex = now.toString(16).padStart(12, "0");
  const timeHigh = timeHex.slice(0, 8);
  const timeMid = timeHex.slice(8, 12);

  // 4-bit version 7 + 12-bit sequence
  const verAndSeq = (0x7000 | uuidSeq).toString(16).padStart(4, "0");

  // 2-bit RFC 9562 variant 10xx + 6-bit VU id + 6-bit random
  const variantAndVu = (0x8000 | ((vuId & 0x3f) << 6) | Math.floor(Math.random() * 0x3f)).toString(16).padStart(4, "0");

  // Two 24-bit random chunks within double precision limit
  const r1 = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const r2 = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const randRest = `${r1}${r2}`;

  return `${timeHigh}-${timeMid}-${verAndSeq}-${variantAndVu}-${randRest}`;
}

/**
 * Builds HTTP headers for k6 requests including authentication and idempotency headers.
 *
 * @param {object} [user] - Test user object containing token and optional cookie
 * @param {string} [idempotencyKey] - Optional idempotency key for mutations
 * @returns {Record<string, string>}
 */
export function buildHeaders(user, idempotencyKey) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (user) {
    if (user.token) {
      headers["Authorization"] = `Bearer ${user.token}`;
    }
    if (user.cookie) {
      headers["Cookie"] = user.cookie;
    } else if (user.token) {
      headers["Cookie"] = `better-auth.session_token=${user.token}`;
    }
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return headers;
}
