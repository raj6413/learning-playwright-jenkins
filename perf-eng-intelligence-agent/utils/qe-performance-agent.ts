import fs from "fs";
import path from "path";

type K6Summary = {
  metrics?: Record<
    string,
    {
      values?: Record<string, number>;
    }
  >;
};

type ThresholdConfig = {
  thresholds: {
    maxP95Ms: number;
    maxP99Ms: number;
    maxErrorRatePct: number;
    minThroughputRps: number;
    maxRegressionPct: number;
    slowEndpointP95Ms: number;
    maxSlowEndpointErrorRatePct: number;
  };
  analysis: {
    compareBaseline: boolean;
    analyzeK6: boolean;
    analyzeJMeter: boolean;
    topSlowEndpoints: number;
  };
};

type JMeterSample = {
  timestamp: number;
  elapsed: number;
  label: string;
  responseCode: string;
  success: boolean;
};

type MetricSet = {
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  throughputRps: number;
  totalRequests: number;
};

type Finding = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  metric: string;
  observed: string;
  threshold: string;
  message: string;
};

const ROOT = process.cwd();

const INPUT_DIR = path.join(ROOT, "perf-eng-intelligence-agent/test-data", "qe-performance");
const CURRENT_DIR = path.join(INPUT_DIR, "current");
const BASELINE_DIR = path.join(INPUT_DIR, "baseline");

const CONFIG_FILE = path.join(INPUT_DIR, "thresholds.json");
const K6_FILE = path.join(CURRENT_DIR, "k6-summary.json");
const BASELINE_FILE = path.join(BASELINE_DIR, "k6-summary.json");
const JMETER_FILE = path.join(CURRENT_DIR, "jmeter-results.csv");

const OUTPUT_DIR = path.join(ROOT, "perf-eng-intelligence-agent/test-results");
const REPORT_MD = path.join(OUTPUT_DIR, "qe-performance-intelligence.md");
const REPORT_JSON = path.join(OUTPUT_DIR, "qe-performance-intelligence.json");

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ?? "qwen3:4b";

const findings: Finding[] = [];

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found: ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function addFinding(
  severity: Finding["severity"],
  category: string,
  metric: string,
  observed: string,
  threshold: string,
  message: string
) {
  findings.push({
    severity,
    category,
    metric,
    observed,
    threshold,
    message
  });
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);

  const index = Math.ceil(percentileValue * sorted.length) - 1;

  return sorted[Math.max(0, index)];
}

function getMetric(
  summary: K6Summary,
  metricName: string,
  valueName: string
): number | undefined {
  const value = summary.metrics?.[metricName]?.values?.[valueName];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseK6Summary(summary: K6Summary): MetricSet {
  const avgMs = getMetric(summary, "http_req_duration", "avg");
  const p95Ms = getMetric(summary, "http_req_duration", "p(95)");
  const p99Ms = getMetric(summary, "http_req_duration", "p(99)");
  const errorRate = getMetric(summary, "http_req_failed", "rate");
  const throughput = getMetric(summary, "http_reqs", "rate");
  const requests = getMetric(summary, "http_reqs", "count");

  const missing: string[] = [];

  if (avgMs === undefined) missing.push("http_req_duration.avg");
  if (p95Ms === undefined) missing.push("http_req_duration.p(95)");
  if (p99Ms === undefined) missing.push("http_req_duration.p(99)");
  if (errorRate === undefined) missing.push("http_req_failed.rate");
  if (throughput === undefined) missing.push("http_reqs.rate");
  if (requests === undefined) missing.push("http_reqs.count");

  if (missing.length > 0) {
    throw new Error(
      `k6 summary is missing required metrics: ${missing.join(", ")}`
    );
  }

  return {
    avgMs: avgMs!,
    p95Ms: p95Ms!,
    p99Ms: p99Ms!,
    errorRatePct: errorRate! * 100,
    throughputRps: throughput!,
    totalRequests: requests!
  };
}

// CSV parser that supports quoted fields and escaped quotes.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result;
}

function parseJMeterCsv(file: string): JMeterSample[] {
  if (!fs.existsSync(file)) {
    return [];
  }

  const content = fs.readFileSync(file, "utf-8").trim();

  if (!content) return [];

  const lines = content.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]).map(h => h.trim());

  const requiredHeaders = [
    "timeStamp",
    "elapsed",
    "label",
    "responseCode",
    "success"
  ];

  const missing = requiredHeaders.filter(h => !headers.includes(h));

  if (missing.length > 0) {
    throw new Error(
      `JMeter CSV is missing required columns: ${missing.join(", ")}`
    );
  }

  const index = (name: string) => headers.indexOf(name);

  const samples: JMeterSample[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const columns = parseCsvLine(lines[i]);

    const timestamp = Number(columns[index("timeStamp")]);
    const elapsed = Number(columns[index("elapsed")]);

    const label = columns[index("label")] ?? "Unknown";
    const responseCode = columns[index("responseCode")] ?? "";
    const success = (columns[index("success")] ?? "")
      .toLowerCase() === "true";

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(elapsed) ||
      elapsed < 0
    ) {
      continue;
    }

    samples.push({
      timestamp,
      elapsed,
      label,
      responseCode,
      success
    });
  }

  return samples;
}

function analyzeJMeter(samples: JMeterSample[]) {
  if (samples.length === 0) {
    return null;
  }

  const elapsedValues = samples.map(s => s.elapsed);
  const totalRequests = samples.length;
  const failures = samples.filter(s => !s.success).length;

  const start = Math.min(...samples.map(s => s.timestamp));
  const end = Math.max(...samples.map(s => s.timestamp + s.elapsed));

  const durationSeconds = Math.max((end - start) / 1000, 0.001);

  const overall: MetricSet = {
    avgMs:
      elapsedValues.reduce((sum, value) => sum + value, 0) /
      totalRequests,
    p95Ms: percentile(elapsedValues, 0.95),
    p99Ms: percentile(elapsedValues, 0.99),
    errorRatePct: (failures / totalRequests) * 100,
    throughputRps: totalRequests / durationSeconds,
    totalRequests
  };

  const grouped = new Map<string, JMeterSample[]>();

  for (const sample of samples) {
    const current = grouped.get(sample.label) ?? [];
    current.push(sample);
    grouped.set(sample.label, current);
  }

  const endpoints = [...grouped.entries()]
    .map(([label, group]) => {
      const times = group.map(s => s.elapsed);
      const failed = group.filter(s => !s.success).length;

      return {
        label,
        requests: group.length,
        avgMs:
          times.reduce((sum, value) => sum + value, 0) /
          times.length,
        p95Ms: percentile(times, 0.95),
        p99Ms: percentile(times, 0.99),
        errorRatePct: (failed / group.length) * 100
      };
    })
    .sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    overall,
    endpoints
  };
}

function compareK6WithBaseline(
  current: MetricSet,
  baseline: MetricSet,
  config: ThresholdConfig["thresholds"]
) {
  const comparisons = [
    {
      metric: "p95 response time",
      current: current.p95Ms,
      baseline: baseline.p95Ms,
      unit: "ms",
      higherIsWorse: true
    },
    {
      metric: "p99 response time",
      current: current.p99Ms,
      baseline: baseline.p99Ms,
      unit: "ms",
      higherIsWorse: true
    },
    {
      metric: "error rate",
      current: current.errorRatePct,
      baseline: baseline.errorRatePct,
      unit: "%",
      higherIsWorse: true
    },
    {
      metric: "throughput",
      current: current.throughputRps,
      baseline: baseline.throughputRps,
      unit: "req/s",
      higherIsWorse: false
    }
  ];

  for (const item of comparisons) {
    if (item.baseline === 0) {
      continue;
    }

    const changePct =
      ((item.current - item.baseline) / Math.abs(item.baseline)) * 100;

    const regressionPct = item.higherIsWorse
      ? changePct
      : -changePct;

    if (regressionPct > config.maxRegressionPct) {
      addFinding(
        "HIGH",
        "BASELINE_REGRESSION",
        item.metric,
        `${item.current.toFixed(2)} ${item.unit}`,
        `No more than ${config.maxRegressionPct}% regression`,
        `${item.metric} regressed by ${regressionPct.toFixed(1)}% compared with baseline (${item.baseline.toFixed(2)} ${item.unit}).`
      );
    }
  }
}

function evaluateThresholds(
  metrics: MetricSet,
  config: ThresholdConfig["thresholds"],
  source: string
) {
  if (metrics.p95Ms > config.maxP95Ms) {
    addFinding(
      "HIGH",
      "SLA_BREACH",
      `${source} p95`,
      `${metrics.p95Ms.toFixed(2)} ms`,
      `<= ${config.maxP95Ms} ms`,
      `${source} p95 response time exceeds the configured SLA.`
    );
  }

  if (metrics.p99Ms > config.maxP99Ms) {
    addFinding(
      "HIGH",
      "SLA_BREACH",
      `${source} p99`,
      `${metrics.p99Ms.toFixed(2)} ms`,
      `<= ${config.maxP99Ms} ms`,
      `${source} p99 response time exceeds the configured SLA.`
    );
  }

  if (metrics.errorRatePct > config.maxErrorRatePct) {
    addFinding(
      "CRITICAL",
      "ERROR_RATE_BREACH",
      `${source} error rate`,
      `${metrics.errorRatePct.toFixed(2)}%`,
      `<= ${config.maxErrorRatePct}%`,
      `${source} error rate exceeds the configured maximum.`
    );
  }

  if (metrics.throughputRps < config.minThroughputRps) {
    addFinding(
      "MEDIUM",
      "THROUGHPUT_BREACH",
      `${source} throughput`,
      `${metrics.throughputRps.toFixed(2)} req/s`,
      `>= ${config.minThroughputRps} req/s`,
      `${source} throughput is below the configured minimum.`
    );
  }
}

function evaluateJMeterEndpoints(
  endpoints: NonNullable<ReturnType<typeof analyzeJMeter>>["endpoints"],
  config: ThresholdConfig["thresholds"]
) {
  for (const endpoint of endpoints) {
    if (endpoint.p95Ms > config.slowEndpointP95Ms) {
      addFinding(
        "HIGH",
        "SLOW_ENDPOINT",
        endpoint.label,
        `${endpoint.p95Ms.toFixed(2)} ms`,
        `p95 <= ${config.slowEndpointP95Ms} ms`,
        `Endpoint '${endpoint.label}' has a high p95 response time.`
      );
    }

    if (endpoint.errorRatePct > config.maxSlowEndpointErrorRatePct) {
      addFinding(
        "CRITICAL",
        "ENDPOINT_ERROR_RATE",
        endpoint.label,
        `${endpoint.errorRatePct.toFixed(2)}%`,
        `<= ${config.maxSlowEndpointErrorRatePct}%`,
        `Endpoint '${endpoint.label}' exceeds the allowed error rate.`
      );
    }
  }
}

async function getAIRecommendations(
  summary: string
): Promise<string> {
  const controller = new AbortController();

  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(
      `${OLLAMA_URL}/api/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          prompt: `
You are a senior Performance Engineering Architect.

Analyze the deterministic performance test results below.

Provide:
1. Executive performance assessment.
2. Most important performance risks.
3. Likely investigation areas (clearly label these as hypotheses).
4. Recommended next performance tests.
5. Practical engineering actions.

Rules:
- Do not invent metrics or findings.
- Distinguish observed facts from hypotheses.
- Do not claim root cause without evidence.
- Prioritize actionable recommendations.
- Keep the answer concise.

Performance data:
${summary}
          `
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const result = await response.json() as {
      response?: string;
    };

    return result.response?.trim() ||
      "Ollama returned an empty recommendation.";
  } catch (error) {
    return `AI recommendations unavailable: ${
      error instanceof Error ? error.message : String(error)
    }. Deterministic performance analysis is still available.`;
  } finally {
    clearTimeout(timeout);
  }
}

function determineReleaseRisk() {
  if (findings.some(f => f.severity === "CRITICAL")) {
    return "HIGH";
  }

  if (findings.some(f => f.severity === "HIGH")) {
    return "ELEVATED";
  }

  if (findings.some(f => f.severity === "MEDIUM")) {
    return "MODERATE";
  }

  return "LOW";
}

function buildMarkdown(
  k6Metrics: MetricSet | null,
  baselineMetrics: MetricSet | null,
  jmeter: ReturnType<typeof analyzeJMeter>,
  config: ThresholdConfig,
  aiRecommendations: string,
  releaseRisk: string
): string {
  const lines: string[] = [
    "# QE Performance Engineering Intelligence Report",
    "",
    "## Executive Summary",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Release performance risk: **${releaseRisk}**`,
    `- Total findings: ${findings.length}`,
    `- Critical: ${findings.filter(f => f.severity === "CRITICAL").length}`,
    `- High: ${findings.filter(f => f.severity === "HIGH").length}`,
    `- Medium: ${findings.filter(f => f.severity === "MEDIUM").length}`,
    "",
    "## k6 Results",
    ""
  ];

  if (k6Metrics) {
    lines.push(
      "| Metric | Current | Threshold |",
      "|---|---:|---:|",
      `| Average response time | ${k6Metrics.avgMs.toFixed(2)} ms | Informational |`,
      `| p95 response time | ${k6Metrics.p95Ms.toFixed(2)} ms | <= ${config.thresholds.maxP95Ms} ms |`,
      `| p99 response time | ${k6Metrics.p99Ms.toFixed(2)} ms | <= ${config.thresholds.maxP99Ms} ms |`,
      `| Error rate | ${k6Metrics.errorRatePct.toFixed(2)}% | <= ${config.thresholds.maxErrorRatePct}% |`,
      `| Throughput | ${k6Metrics.throughputRps.toFixed(2)} req/s | >= ${config.thresholds.minThroughputRps} req/s |`,
      `| Total requests | ${k6Metrics.totalRequests} | Informational |`,
      ""
    );
  } else {
    lines.push("No k6 summary file was analyzed.", "");
  }

  lines.push("## Baseline Comparison", "");

  if (k6Metrics && baselineMetrics && config.analysis.compareBaseline) {
    lines.push(
      "| Metric | Baseline | Current |",
      "|---|---:|---:|",
      `| p95 | ${baselineMetrics.p95Ms.toFixed(2)} ms | ${k6Metrics.p95Ms.toFixed(2)} ms |`,
      `| p99 | ${baselineMetrics.p99Ms.toFixed(2)} ms | ${k6Metrics.p99Ms.toFixed(2)} ms |`,
      `| Error rate | ${baselineMetrics.errorRatePct.toFixed(2)}% | ${k6Metrics.errorRatePct.toFixed(2)}% |`,
      `| Throughput | ${baselineMetrics.throughputRps.toFixed(2)} req/s | ${k6Metrics.throughputRps.toFixed(2)} req/s |`,
      ""
    );
  } else {
    lines.push("Baseline comparison unavailable or disabled.", "");
  }

  lines.push("## JMeter Results", "");

  if (jmeter) {
    const m = jmeter.overall;

    lines.push(
      `- Total samples: ${m.totalRequests}`,
      `- Average response time: ${m.avgMs.toFixed(2)} ms`,
      `- p95 response time: ${m.p95Ms.toFixed(2)} ms`,
      `- p99 response time: ${m.p99Ms.toFixed(2)} ms`,
      `- Error rate: ${m.errorRatePct.toFixed(2)}%`,
      `- Approximate throughput: ${m.throughputRps.toFixed(2)} req/s`,
      "",
      "### Endpoint Breakdown",
      "",
      "| Endpoint / Label | Requests | Average | p95 | p99 | Error rate |",
      "|---|---:|---:|---:|---:|---:|"
    );

    for (const endpoint of jmeter.endpoints.slice(
      0,
      config.analysis.topSlowEndpoints
    )) {
      lines.push(
        `| ${endpoint.label} | ${endpoint.requests} | ${endpoint.avgMs.toFixed(2)} ms | ${endpoint.p95Ms.toFixed(2)} ms | ${endpoint.p99Ms.toFixed(2)} ms | ${endpoint.errorRatePct.toFixed(2)}% |`
      );
    }

    lines.push("");
  } else {
    lines.push("No JMeter CSV/JTL file was analyzed.", "");
  }

  lines.push("## Deterministic Findings", "");

  if (findings.length === 0) {
    lines.push("No threshold breaches or baseline regressions detected.");
  } else {
    lines.push(
      "| Severity | Category | Metric | Observed | Threshold | Finding |",
      "|---|---|---|---:|---:|---|"
    );

    for (const finding of findings) {
      lines.push(
        `| ${finding.severity} | ${finding.category} | ${finding.metric} | ${finding.observed} | ${finding.threshold} | ${finding.message} |`
      );
    }
  }

  lines.push(
    "",
    "## AI Engineering Recommendations",
    "",
    aiRecommendations,
    "",
    "## Interpretation and Limitations",
    "",
    "- Percentiles from JMeter are calculated from the samples in the supplied CSV; small sample sets do not provide statistically reliable tail percentiles.",
    "- JMeter throughput is approximated from the timestamp span and sample count. Use a full test-result export for production analysis.",
    "- k6 baseline comparison is performed only when both current and baseline summaries are available.",
    "- This report identifies correlation and performance risk; it does not establish root cause.",
    "- Release risk is a deterministic summary of configured threshold and regression findings, not a substitute for your release policy."
  );

  return lines.join("\n");
}

async function main() {
  console.log("\n========================================");
  console.log(" QE PERFORMANCE INTELLIGENCE AGENT");
  console.log("========================================\n");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const config = readJson<ThresholdConfig>(CONFIG_FILE);

  let k6Metrics: MetricSet | null = null;
  let baselineMetrics: MetricSet | null = null;
  let jmeterResult: ReturnType<typeof analyzeJMeter> = null;

  if (config.analysis.analyzeK6 && fs.existsSync(K6_FILE)) {
    console.log("[1/5] Analyzing current k6 summary...");
    k6Metrics = parseK6Summary(readJson<K6Summary>(K6_FILE));
    evaluateThresholds(k6Metrics, config.thresholds, "k6");
  } else {
    console.log("[1/5] Current k6 summary not found or disabled.");
  }

  if (
    config.analysis.compareBaseline &&
    config.analysis.analyzeK6 &&
    fs.existsSync(BASELINE_FILE) &&
    k6Metrics
  ) {
    console.log("[2/5] Comparing k6 results against baseline...");

    baselineMetrics = parseK6Summary(
      readJson<K6Summary>(BASELINE_FILE)
    );

    compareK6WithBaseline(
      k6Metrics,
      baselineMetrics,
      config.thresholds
    );
  } else {
    console.log("[2/5] Baseline comparison skipped.");
  }

  if (config.analysis.analyzeJMeter && fs.existsSync(JMETER_FILE)) {
    console.log("[3/5] Analyzing JMeter results...");

    const samples = parseJMeterCsv(JMETER_FILE);

    jmeterResult = analyzeJMeter(samples);

    if (jmeterResult) {
      evaluateThresholds(
        jmeterResult.overall,
        config.thresholds,
        "JMeter"
      );

      evaluateJMeterEndpoints(
        jmeterResult.endpoints,
        config.thresholds
      );
    }
  } else {
    console.log("[3/5] JMeter results not found or disabled.");
  }

  if (!k6Metrics && !jmeterResult) {
    throw new Error(
      "No performance results found. Supply a k6 summary or JMeter CSV file."
    );
  }

  const releaseRisk = determineReleaseRisk();

  const deterministicSummary = JSON.stringify(
    {
      releaseRisk,
      findings,
      k6Metrics,
      baselineMetrics,
      jmeterResult
    },
    null,
    2
  );

  console.log("[4/5] Requesting AI recommendations from Ollama...");

  const aiRecommendations =
    await getAIRecommendations(deterministicSummary);

  const report = {
    generatedAt: new Date().toISOString(),
    releaseRisk,
    summary: {
      totalFindings: findings.length,
      critical: findings.filter(f => f.severity === "CRITICAL").length,
      high: findings.filter(f => f.severity === "HIGH").length,
      medium: findings.filter(f => f.severity === "MEDIUM").length,
      low: findings.filter(f => f.severity === "LOW").length
    },
    k6: k6Metrics,
    baseline: baselineMetrics,
    jmeter: jmeterResult,
    findings,
    aiRecommendations,
    configuration: config
  };

  console.log("[5/5] Writing reports...");

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  fs.writeFileSync(
    REPORT_MD,
    buildMarkdown(
      k6Metrics,
      baselineMetrics,
      jmeterResult,
      config,
      aiRecommendations,
      releaseRisk
    )
  );

  console.log("\n========================================");
  console.log(" PERFORMANCE ANALYSIS SUMMARY");
  console.log("========================================");
  console.log(`Release risk: ${releaseRisk}`);
  console.log(`Total findings: ${findings.length}`);
  console.log(`Critical: ${report.summary.critical}`);
  console.log(`High: ${report.summary.high}`);
  console.log(`Medium: ${report.summary.medium}`);

  console.log("\nGenerated files:");
  console.log(`- ${REPORT_MD}`);
  console.log(`- ${REPORT_JSON}`);

  console.log("\nAgent execution completed.\n");
}

main().catch(error => {
  console.error("\nPerformance Intelligence Agent failed:");
  console.error(error);
  process.exitCode = 1;
});