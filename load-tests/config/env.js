// load-tests/config/env.js

/**
 * Returns the load test configuration options for k6.
 * Merges overrides with runtime environment variables (__ENV in k6, process.env in Node).
 *
 * @param {Record<string, string>} [envOverrides]
 * @returns {object}
 */
export function getConfig(envOverrides) {
  const env = envOverrides !== undefined
    ? envOverrides
    : (typeof __ENV !== "undefined" ? __ENV : (typeof process !== "undefined" ? process.env : {}));

  const baseUrl = (env && env.BASE_URL) || "http://192.168.0.112:4000";

  const stages = [
    { duration: "1m", target: 20 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "2m30s", target: 250 },
    { duration: "30s", target: 0 },
  ];

  const thresholds = {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(90)<150", "p(95)<250", "p(99)<500"],
    "http_req_duration{name:feed_for_you}": ["p(95)<100", "p(99)<200"],
    "http_req_duration{name:feed_following}": ["p(95)<200", "p(99)<400"],
    "http_req_duration{name:search}": ["p(95)<250", "p(99)<500"],
    "http_req_duration{name:create_quote}": ["p(95)<250", "p(99)<500"],
    "http_req_duration{name:like_quote}": ["p(95)<150", "p(99)<300"],
  };

  return {
    baseUrl,
    stages,
    thresholds,
  };
}

export default getConfig();
