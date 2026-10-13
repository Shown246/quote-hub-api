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

  const baseUrl = (env && env.BASE_URL) || "http://192.168.0.108:4000";

  const stages = [
    { duration: "1m", target: 20 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "2m30s", target: 250 },
    { duration: "30s", target: 0 },
  ];

  const summaryTrendStats = [
    "avg",
    "min",
    "med",
    "max",
    "p(90)",
    "p(95)",
    "p(99)",
    "count",
  ];

  const thresholds = {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(90)<150", "p(95)<250", "p(99)<500"],

    // Latency SLAs per endpoint
    "http_req_duration{name:feed_for_you}": ["p(95)<100", "p(99)<200"],
    "http_req_duration{name:feed_following}": ["p(95)<200", "p(99)<400"],
    "http_req_duration{name:search}": ["p(95)<250", "p(99)<500"],
    "http_req_duration{name:create_quote}": ["p(95)<250", "p(99)<500"],
    "http_req_duration{name:like_quote}": ["p(95)<150", "p(99)<300"],
    "http_req_duration{name:bookmark_quote}": ["p(95)<150", "p(99)<300"],
    "http_req_duration{name:repost_quote}": ["p(95)<150", "p(99)<300"],
    "http_req_duration{name:quote_details}": ["p(95)<150", "p(99)<300"],
    "http_req_duration{name:health_live}": ["p(95)<100", "p(99)<200"],

    // Error rate tracking per endpoint
    "http_req_failed{name:feed_for_you}": ["rate<0.01"],
    "http_req_failed{name:feed_following}": ["rate<0.01"],
    "http_req_failed{name:search}": ["rate<0.01"],
    "http_req_failed{name:create_quote}": ["rate<0.01"],
    "http_req_failed{name:like_quote}": ["rate<0.01"],
    "http_req_failed{name:bookmark_quote}": ["rate<0.01"],
    "http_req_failed{name:repost_quote}": ["rate<0.01"],
    "http_req_failed{name:quote_details}": ["rate<0.01"],
    "http_req_failed{name:health_live}": ["rate<0.01"],
  };

  return {
    baseUrl,
    stages,
    summaryTrendStats,
    thresholds,
  };
}

export default getConfig();
