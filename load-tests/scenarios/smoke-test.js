// load-tests/scenarios/smoke-test.js
import http from "k6/http";
import { check, sleep } from "k6";
import { getConfig } from "../config/env.js";
import { buildHeaders, generateUuid } from "../utils/http-client.js";
export { handleSummary } from "../utils/reporter.js";

/**
 * Validates that the pre-warmed seed dataset exists.
 * Throws an actionable error if seed dataset is missing.
 */
export function validateDatasetExists(data) {
  if (!data || !data.users || data.users.length === 0) {
    throw new Error("Seed dataset missing! Run 'npx tsx load-tests/scripts/seed-load-data.ts' first to generate test accounts.");
  }
  return true;
}

let dataset = null;
try {
  if (typeof open === "function") {
    dataset = JSON.parse(open("../data/users.json"));
  }
} catch {
  dataset = null;
}

const config = getConfig();
export const options = {
  vus: 1,
  duration: "30s",
  summaryTrendStats: config.summaryTrendStats,
  thresholds: config.thresholds,
};

export default function () {
  validateDatasetExists(dataset);

  const config = getConfig();
  const baseUrl = config.baseUrl;
  const user = dataset.users[0];
  const quoteId = dataset.quoteIds && dataset.quoteIds[dataset.quoteIds.length - 1];

  // 1. Health check
  const healthRes = http.get(`${baseUrl}/health/live`, {
    tags: { name: "health_live" },
  });
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
  });

  // 2. Feed For You
  const headers = buildHeaders(user);
  const forYouRes = http.get(`${baseUrl}/api/v1/feed/for-you`, {
    headers,
    tags: { name: "feed_for_you" },
  });
  check(forYouRes, {
    "for-you feed status is 200": (r) => r.status === 200,
  });

  // 3. Feed Following
  const followingRes = http.get(`${baseUrl}/api/v1/feed/following`, {
    headers,
    tags: { name: "feed_following" },
  });
  check(followingRes, {
    "following feed status is 200": (r) => r.status === 200,
  });

  // 4. Fuzzy Search
  const searchRes = http.get(`${baseUrl}/api/v1/search?q=wisdom`, {
    headers,
    tags: { name: "search" },
  });
  check(searchRes, {
    "search status is 200": (r) => r.status === 200,
  });

  // 5. Quote Creation
  const createHeaders = buildHeaders(user, generateUuid());
  const createRes = http.post(
    `${baseUrl}/api/v1/quotes`,
    JSON.stringify({
      text: "Smoke test quote: " + generateUuid(),
      isOriginal: true,
      themeId: "018f3a2c-0000-7000-8000-000000000001",
    }),
    {
      headers: createHeaders,
      tags: { name: "create_quote" },
    }
  );
  check(createRes, {
    "create quote status is 200 or 201": (r) => r.status === 200 || r.status === 201,
  });

  // 6. Like Quote (if quoteId exists)
  if (quoteId) {
    const likeRes = http.post(`${baseUrl}/api/v1/quotes/${quoteId}/like`, null, {
      headers,
      tags: { name: "like_quote" },
    });
    check(likeRes, {
      "like quote status is 200 or 201": (r) => r.status === 200 || r.status === 201,
    });
  }

  sleep(0.5);
}
