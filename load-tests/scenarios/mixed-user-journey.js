// load-tests/scenarios/mixed-user-journey.js
import http from "k6/http";
import { check, sleep } from "k6";
import { getConfig } from "../config/env.js";
import { buildHeaders, generateUuid } from "../utils/http-client.js";
export { handleSummary } from "../utils/reporter.js";

/**
 * Validates that the pre-warmed seed dataset exists.
 */
export function validateDatasetExists(data) {
  if (!data || !data.users || data.users.length === 0) {
    throw new Error("Seed dataset missing! Run 'npx tsx load-tests/scripts/seed-load-data.ts' first to generate test accounts.");
  }
  return true;
}

/**
 * Categorizes a random float [0, 1) into an action category based on the 80/15/5 distribution.
 *
 * @param {number} roll - Float between 0.0 and 1.0
 * @returns {"READ" | "INTERACTION" | "WRITE"}
 */
export function selectActionCategory(roll) {
  if (roll < 0.80) {
    return "READ";
  }
  if (roll < 0.95) {
    return "INTERACTION";
  }
  return "WRITE";
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
  stages: config.stages,
  thresholds: config.thresholds,
  summaryTrendStats: config.summaryTrendStats,
};

const SAMPLE_POST_TEXTS = [
  "Reflecting on leadership and humility in modern systems.",
  "Courage is resisting fear, mastering fear, not absence of fear.",
  "Simple architectures survive chaos; complex ones create it.",
  "In three words I can sum up everything I've learned about life: it goes on.",
  "Focus on being productive instead of busy.",
  "A quiet mind can hear intuition above the noise.",
];

export default function () {
  validateDatasetExists(dataset);

  const config = getConfig();
  const baseUrl = config.baseUrl;
  const users = dataset.users;
  const quoteIds = dataset.quoteIds || [];
  const searchTerms = dataset.searchTerms || ["wisdom", "courage", "life"];

  // 1. Session Assignment per VU
  const vuId = typeof __VU !== "undefined" ? __VU : 1;
  const user = users[(vuId - 1) % users.length];
  const authHeaders = buildHeaders(user);

  const otherQuotes = dataset.quotes
    ? dataset.quotes.filter((q) => q.userId !== user.id)
    : [];

  const getRandomQuoteId = () => {
    if (otherQuotes.length > 0) {
      const idx = Math.floor(Math.random() * otherQuotes.length);
      return otherQuotes[idx].id;
    }
    if (quoteIds.length === 0) return null;
    const idx = Math.floor(Math.random() * quoteIds.length);
    return quoteIds[idx];
  };

  const roll = Math.random();
  const category = selectActionCategory(roll);

  if (category === "READ") {
    // 80% Total: For You (40%), Following (25%), Quote Details (10%), Search (5%)
    if (roll < 0.40) {
      // 40% - For You Feed
      const res = http.get(`${baseUrl}/api/v1/feed/for-you`, {
        headers: authHeaders,
        tags: { name: "feed_for_you" },
      });
      check(res, {
        "feed/for-you status is 200": (r) => r.status === 200,
        "feed/for-you valid response": (r) => {
          try {
            const body = r.json();
            return Array.isArray(body?.data);
          } catch {
            return false;
          }
        },
      });
    } else if (roll < 0.65) {
      // 25% - Following Feed with pagination crawl
      const res = http.get(`${baseUrl}/api/v1/feed/following`, {
        headers: authHeaders,
        tags: { name: "feed_following" },
      });
      check(res, {
        "feed/following status is 200": (r) => r.status === 200,
        "feed/following valid response": (r) => {
          try {
            const body = r.json();
            return Array.isArray(body?.data);
          } catch {
            return false;
          }
        },
      });

      // 50% chance to fetch page 2 if cursor exists
      if (Math.random() < 0.50) {
        try {
          const body = res.json();
          const nextCursor = body?.pagination?.nextCursor;
          if (nextCursor && typeof nextCursor === "string" && nextCursor !== "null" && nextCursor !== "undefined") {
            const page2Res = http.get(`${baseUrl}/api/v1/feed/following?cursor=${encodeURIComponent(nextCursor)}`, {
              headers: authHeaders,
              tags: { name: "feed_following" },
            });
            check(page2Res, { "feed/following page 2 status is 200": (r) => r.status === 200 });
          }
        } catch {
          // ignore JSON parse error on failed responses
        }
      }
    } else if (roll < 0.75) {
      // 10% - Quote Details
      const qid = getRandomQuoteId();
      if (qid) {
        const res = http.get(`${baseUrl}/api/v1/quotes/${qid}`, {
          headers: authHeaders,
          tags: { name: "quote_details" },
        });
        check(res, {
          "quote details status is 200": (r) => r.status === 200,
          "quote details valid response": (r) => {
            try {
              const body = r.json();
              return Boolean(body?.id);
            } catch {
              return false;
            }
          },
        });
      }
    } else {
      // 5% - Trigram Search
      const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];
      const res = http.get(`${baseUrl}/api/v1/search?q=${encodeURIComponent(term)}`, {
        headers: authHeaders,
        tags: { name: "search" },
      });
      check(res, {
        "search status is 200": (r) => r.status === 200,
        "search valid response": (r) => {
          try {
            const body = r.json();
            return Array.isArray(body?.data || body?.items || body);
          } catch {
            return false;
          }
        },
      });
    }
  } else if (category === "INTERACTION") {
    // 15% Total: Like (8%), Bookmark (4%), Repost (3%)
    const qid = getRandomQuoteId();
    if (qid) {
      if (roll < 0.88) {
        // 8% - Like / Unlike
        const res = http.post(`${baseUrl}/api/v1/quotes/${qid}/like`, null, {
          headers: authHeaders,
          tags: { name: "like_quote" },
        });
        check(res, { "like status is 200 or 201": (r) => r.status === 200 || r.status === 201 });
      } else if (roll < 0.92) {
        // 4% - Bookmark
        const res = http.post(`${baseUrl}/api/v1/quotes/${qid}/bookmark`, null, {
          headers: authHeaders,
          tags: { name: "bookmark_quote" },
        });
        check(res, { "bookmark status is 200 or 201": (r) => r.status === 200 || r.status === 201 });
      } else {
        // 3% - Repost
        const res = http.post(`${baseUrl}/api/v1/quotes/${qid}/repost`, null, {
          headers: authHeaders,
          tags: { name: "repost_quote" },
        });
        check(res, { "repost status is 200 or 201": (r) => r.status === 200 || r.status === 201 });
      }
    }
  } else {
    // 5% Total: Create Quote
    const idempotencyKey = generateUuid();
    const createHeaders = buildHeaders(user, idempotencyKey);
    const postText = SAMPLE_POST_TEXTS[Math.floor(Math.random() * SAMPLE_POST_TEXTS.length)] + " [" + idempotencyKey.slice(0, 8) + "]";

    const res = http.post(
      `${baseUrl}/api/v1/quotes`,
      JSON.stringify({
        text: postText,
        isOriginal: true,
        themeId: "018f3a2c-0000-7000-8000-000000000001",
      }),
      {
        headers: createHeaders,
        tags: { name: "create_quote" },
      }
    );
    check(res, {
      "create quote status is 200 or 201": (r) => r.status === 200 || r.status === 201,
      "create quote valid response": (r) => {
        try {
          const body = r.json();
          return Boolean(body?.id);
        } catch {
          return false;
        }
      },
    });
  }

  // Think time pacing: jittered sleep between 0.2s and 0.8s
  sleep(0.2 + Math.random() * 0.6);
}
