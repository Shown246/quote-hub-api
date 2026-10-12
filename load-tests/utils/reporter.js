// load-tests/utils/reporter.js

/**
 * Helper to safely extract number value or return fallback.
 */
function safeNum(val, fallback = 0) {
  if (typeof val === "number" && !isNaN(val)) {
    return val;
  }
  return fallback;
}

/**
 * Checks whether thresholds on a metric passed.
 */
function getSlaStatus(metric) {
  if (!metric || !metric.thresholds) return "PASS";
  for (const key of Object.keys(metric.thresholds)) {
    if (metric.thresholds[key].ok === false) {
      return "FAIL";
    }
  }
  return "PASS";
}

/**
 * Formats a clean ASCII summary table from k6 data metrics.
 *
 * @param {object} data - k6 data summary object
 * @returns {string} Formatted ASCII table
 */
export function formatTextSummary(data) {
  const metrics = (data && data.metrics) || {};
  const durationMetric = metrics.http_req_duration || {};
  const failedMetric = metrics.http_req_failed || {};
  const reqsMetric = metrics.http_reqs || {};

  const totalReqs = safeNum(durationMetric.values?.count ?? reqsMetric.values?.count);
  const totalRps = safeNum(reqsMetric.values?.rate);
  const errRate = safeNum(failedMetric.values?.rate) * 100;

  const p90 = durationMetric.values?.["p(90)"];
  const p95 = durationMetric.values?.["p(95)"];
  const p99 = durationMetric.values?.["p(99)"];

  const formatLatency = (val, count) => {
    if (count === 0 || totalReqs === 0 || val === undefined || val === null || isNaN(val)) {
      return "N/A";
    }
    return val.toFixed(1);
  };

  const header = "ENDPOINT / ROUTE                     REQS     RPS   p90(ms)   p95(ms)   p99(ms)   ERR(%)  SLA";
  const separator = "=".repeat(header.length);
  const divider = "-".repeat(header.length);

  const lines = [
    separator,
    header,
    separator,
  ];

  // Inspect tagged sub-metrics if present
  const endpointKeys = Object.keys(metrics).filter((k) =>
    k.startsWith("http_req_duration{name:")
  );

  const endpointNamesMap = {
    feed_for_you: "GET  /api/v1/feed/for-you",
    feed_following: "GET  /api/v1/feed/following",
    quote_details: "GET  /api/v1/quotes/:id",
    search: "GET  /api/v1/search",
    like_quote: "POST /api/v1/quotes/:id/like",
    bookmark_quote: "POST /api/v1/quotes/:id/bookmark",
    repost_quote: "POST /api/v1/quotes/:id/repost",
    create_quote: "POST /api/v1/quotes",
    health_live: "GET  /health/live",
    health_ready: "GET  /health/ready",
  };

  const activeKeys = endpointKeys.filter((k) => {
    const epCount = metrics[k]?.values?.count;
    return epCount !== undefined && epCount > 0;
  });
  const keysToDisplay = activeKeys.length > 0 ? activeKeys : endpointKeys;

  if (keysToDisplay.length > 0) {
    for (const key of keysToDisplay) {
      const match = key.match(/name:([^}]+)/);
      const tag = match ? match[1] : key;
      const displayName = endpointNamesMap[tag] || tag;

      const epDuration = metrics[key];
      const epReqs = metrics[`http_reqs{name:${tag}}`];
      const epFailed = metrics[`http_req_failed{name:${tag}}`];

      const epCountVal = epDuration.values?.count ?? epReqs?.values?.count;
      let epRpsVal = epReqs?.values?.rate;
      if (epRpsVal === undefined && epCountVal !== undefined) {
        const durationSec = safeNum(data?.state?.testRunDurationMs) / 1000;
        if (durationSec > 0) {
          epRpsVal = epCountVal / durationSec;
        }
      }

      let epErrVal = epFailed?.values?.rate;
      if (epErrVal === undefined && epCountVal !== undefined && safeNum(failedMetric.values?.rate) === 0) {
        epErrVal = 0;
      }

      const epStatus = getSlaStatus(epDuration);

      const rName = displayName.padEnd(34, " ");
      const rReqs = (epCountVal !== undefined ? String(epCountVal) : "-").padStart(6, " ");
      const rRps = (epRpsVal !== undefined ? epRpsVal.toFixed(1) : "-").padStart(7, " ");
      const rP90 = formatLatency(epDuration.values?.["p(90)"], epCountVal).padStart(9, " ");
      const rP95 = formatLatency(epDuration.values?.["p(95)"], epCountVal).padStart(9, " ");
      const rP99 = formatLatency(epDuration.values?.["p(99)"], epCountVal).padStart(9, " ");
      const rErr = (epCountVal === 0 ? "-" : (epErrVal !== undefined ? `${(epErrVal * 100).toFixed(2)}%` : "-")).padStart(8, " ");
      const rSla = (epCountVal === 0 ? "PASS" : epStatus).padStart(5, " ");

      lines.push(`${rName} ${rReqs} ${rRps} ${rP90} ${rP95} ${rP99} ${rErr} ${rSla}`);
    }
    lines.push(divider);
  }

  const overallStatus =
    getSlaStatus(durationMetric) === "PASS" && getSlaStatus(failedMetric) === "PASS"
      ? "PASS"
      : "FAIL";

  const totalName = "TOTAL / OVERALL".padEnd(34, " ");
  const tReqs = String(totalReqs).padStart(6, " ");
  const tRps = (totalReqs === 0 ? "0.0" : totalRps.toFixed(1)).padStart(7, " ");
  const tP90 = formatLatency(p90, totalReqs).padStart(9, " ");
  const tP95 = formatLatency(p95, totalReqs).padStart(9, " ");
  const tP99 = formatLatency(p99, totalReqs).padStart(9, " ");
  const tErr = `${errRate.toFixed(2)}%`.padStart(8, " ");
  const tSla = overallStatus.padStart(5, " ");

  lines.push(`${totalName} ${tReqs} ${tRps} ${tP90} ${tP95} ${tP99} ${tErr} ${tSla}`);
  lines.push(separator);

  const checksMetric = metrics.checks || {};
  const passes = checksMetric.values?.passes;
  const fails = checksMetric.values?.fails;
  if (passes !== undefined && fails !== undefined) {
    const totalChecks = passes + fails;
    const passRate = totalChecks > 0 ? ((passes / totalChecks) * 100).toFixed(2) : "100.00";
    lines.push(`Checks: ${passes}/${totalChecks} passed (${passRate}%)`);
    lines.push(separator);
  }

  return lines.join("\n");
}

/**
 * Generates an interactive, standalone post-run HTML dashboard string.
 *
 * @param {object} data - k6 data summary object
 * @returns {string} Standalone HTML document
 */
export function generateHtmlReport(data) {
  const metrics = (data && data.metrics) || {};
  const duration = metrics.http_req_duration || {};
  const failed = metrics.http_req_failed || {};
  const reqs = metrics.http_reqs || {};

  const totalCount = safeNum(duration.values?.count ?? reqs.values?.count);
  const totalRps = safeNum(reqs.values?.rate);
  const p90 = safeNum(duration.values?.["p(90)"]);
  const p95 = safeNum(duration.values?.["p(95)"]);
  const p99 = safeNum(duration.values?.["p(99)"]);
  const avg = safeNum(duration.values?.avg);
  const errRate = (safeNum(failed.values?.rate) * 100).toFixed(2);
  const slaStatus = getSlaStatus(duration) === "PASS" && getSlaStatus(failed) === "PASS" ? "PASS" : "FAIL";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Test Summary</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --success: #10b981;
      --danger: #ef4444;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      padding: 2rem;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 1.8rem; font-weight: 700; color: var(--accent); }
    .badge {
      font-size: 0.9rem;
      font-weight: 600;
      padding: 0.35rem 0.8rem;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    .badge-pass { background-color: rgba(16, 185, 129, 0.2); color: var(--success); border: 1px solid var(--success); }
    .badge-fail { background-color: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--card-bg);
      padding: 1.25rem;
      border-radius: 0.75rem;
      border: 1px solid var(--border);
    }
    .card-title { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem; text-transform: uppercase; }
    .card-value { font-size: 1.6rem; font-weight: 700; color: var(--text-main); }
    .table-container {
      background: var(--card-bg);
      border-radius: 0.75rem;
      border: 1px solid var(--border);
      overflow-x: auto;
      padding: 1rem;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { color: var(--text-muted); font-weight: 600; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
    tr:last-child td { border-bottom: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Quote-Hub Performance Test Summary</h1>
    <span class="badge ${slaStatus === "PASS" ? "badge-pass" : "badge-fail"}">SLA: ${slaStatus}</span>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-title">Total Requests</div>
      <div class="card-value">${totalCount.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-title">Throughput</div>
      <div class="card-value">${totalRps.toFixed(1)} RPS</div>
    </div>
    <div class="card">
      <div class="card-title">Avg Latency</div>
      <div class="card-value">${avg.toFixed(1)} ms</div>
    </div>
    <div class="card">
      <div class="card-title">p90 Latency</div>
      <div class="card-value">${p90.toFixed(1)} ms</div>
    </div>
    <div class="card">
      <div class="card-title">p95 Latency</div>
      <div class="card-value">${p95.toFixed(1)} ms</div>
    </div>
    <div class="card">
      <div class="card-title">p99 Latency</div>
      <div class="card-value">${p99.toFixed(1)} ms</div>
    </div>
    <div class="card">
      <div class="card-title">Error Rate</div>
      <div class="card-value" style="color: ${Number(errRate) < 1.0 ? "var(--success)" : "var(--danger)"}">${errRate}%</div>
    </div>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Metric / Percentile</th>
          <th>Measured</th>
          <th>SLA Target</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Latency p90</td>
          <td>${p90.toFixed(1)} ms</td>
          <td>&lt; 150 ms</td>
          <td><span class="badge ${p90 < 150 ? "badge-pass" : "badge-fail"}">${p90 < 150 ? "PASS" : "FAIL"}</span></td>
        </tr>
        <tr>
          <td>Latency p95</td>
          <td>${p95.toFixed(1)} ms</td>
          <td>&lt; 250 ms</td>
          <td><span class="badge ${p95 < 250 ? "badge-pass" : "badge-fail"}">${p95 < 250 ? "PASS" : "FAIL"}</span></td>
        </tr>
        <tr>
          <td>Latency p99</td>
          <td>${p99.toFixed(1)} ms</td>
          <td>&lt; 500 ms</td>
          <td><span class="badge ${p99 < 500 ? "badge-pass" : "badge-fail"}">${p99 < 500 ? "PASS" : "FAIL"}</span></td>
        </tr>
        <tr>
          <td>HTTP Error Rate</td>
          <td>${errRate}%</td>
          <td>&lt; 1.00%</td>
          <td><span class="badge ${Number(errRate) < 1.0 ? "badge-pass" : "badge-fail"}">${Number(errRate) < 1.0 ? "PASS" : "FAIL"}</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

/**
 * Standard k6 summary export handler hook.
 *
 * @param {object} data - k6 execution metrics data
 * @returns {Record<string, string>}
 */
export function handleSummary(data) {
  return {
    stdout: formatTextSummary(data),
    "load-tests/results/report.html": generateHtmlReport(data),
    "load-tests/results/summary.json": JSON.stringify(data, null, 2),
  };
}
