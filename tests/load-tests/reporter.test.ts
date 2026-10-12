// tests/load-tests/reporter.test.ts
import { describe, it, expect } from "vitest";
import { formatTextSummary, generateHtmlReport } from "../../load-tests/utils/reporter.js";

describe("reporter utils", () => {
  const mockK6Data = {
    metrics: {
      http_req_duration: {
        values: { "p(90)": 45.2, "p(95)": 78.1, "p(99)": 142.0, avg: 35.0, count: 5000 },
        thresholds: { "p(95)<250": { ok: true } }
      },
      http_req_failed: {
        values: { rate: 0.002 },
        thresholds: { "rate<0.01": { ok: true } }
      },
      http_reqs: {
        values: { rate: 125.4, count: 5000 }
      }
    }
  };

  it("formats ASCII summary table with percentiles and SLA verdicts", () => {
    const table = formatTextSummary(mockK6Data);
    expect(table).toContain("p90(ms)");
    expect(table).toContain("p95(ms)");
    expect(table).toContain("p99(ms)");
    expect(table).toContain("45.2");
    expect(table).toContain("PASS");
  });

  it("handles zero requests without throwing NaN or crashing", () => {
    const emptyData = {
      metrics: {
        http_req_duration: { values: { "p(90)": 0, "p(95)": 0, "p(99)": 0, count: 0 } },
        http_req_failed: { values: { rate: 0 } },
        http_reqs: { values: { rate: 0, count: 0 } }
      }
    };
    const table = formatTextSummary(emptyData);
    expect(table).toBeDefined();
    expect(table).not.toContain("NaN");
  });

  it("generates valid standalone HTML dashboard string", () => {
    const html = generateHtmlReport(mockK6Data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Performance Test Summary");
    expect(html).toContain("78.1");
  });

  it("formats ASCII summary table with per-endpoint REQS, RPS, p99, ERR rates, and checks", () => {
    const dataWithEndpoints = {
      state: { testRunDurationMs: 10000 },
      metrics: {
        http_req_duration: {
          values: { "p(90)": 50, "p(95)": 80, "p(99)": 120, avg: 40, count: 200 },
          thresholds: { "p(95)<250": { ok: true } }
        },
        http_req_failed: { values: { rate: 0.005 } },
        http_reqs: { values: { rate: 20.0, count: 200 } },
        "http_req_duration{name:feed_for_you}": {
          values: { "p(90)": 30.5, "p(95)": 45.2, "p(99)": 60.1, count: 100 },
          thresholds: { "p(95)<100": { ok: true } }
        },
        "http_req_failed{name:feed_for_you}": {
          values: { rate: 0.01 }
        },
        checks: {
          values: { passes: 198, fails: 2, rate: 0.99 }
        }
      }
    };
    const table = formatTextSummary(dataWithEndpoints);
    expect(table).toContain("GET  /api/v1/feed/for-you");
    expect(table).toContain("60.1"); // p99
    expect(table).toContain("1.00%"); // error rate
    expect(table).toContain("100"); // count
    expect(table).toContain("Checks: 198/200 passed (99.00%)");
  });
});
