/* JevBench uses its own aggregate report; existing comparisons are unchanged. */
(() => {
  "use strict";
  const status = document.querySelector("#jevbench-status");
  const content = document.querySelector("#jevbench-content");
  const cell = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const percent = (value) => `${(100 * value).toFixed(2)}%`;

  async function loadJevBench() {
    try {
      const response = await fetch("./jevbench.json");
      if (!response.ok) throw new Error("JevBench report unavailable");
      const report = await response.json();
      if (report.publication_ready !== true) {
        status.textContent = "Results are awaiting completion and independent audits for all five model streams.";
        return;
      }
      if (report.schema_version !== 1 || report.benchmark.public_tasks !== 231 ||
          report.required_streams.length !== 5 || report.results.length !== 5 ||
          new Set(report.results.map((row) => row.id)).size !== 5 ||
          !report.results.every((row) => report.required_streams.includes(row.id) &&
            row.status === "complete" && row.audit_status === "passed" &&
            row.metrics.n_planned === 231 && row.metrics.n_attempted === 231 &&
            row.metrics.n_scorable === 231 && Number.isInteger(row.metrics.n_correct) &&
            row.metrics.n_correct >= 0 && row.metrics.n_correct <= 231 &&
            row.metrics.accuracy === row.metrics.n_correct / 231 &&
            Number.isFinite(row.metrics.latency.p50_ms) && Number.isFinite(row.metrics.latency.p95_ms))) {
        throw new Error("JevBench publication checks incomplete");
      }
      const rows = report.results.map((result) => {
        const row = document.createElement("tr");
        const name = cell("th", result.label);
        name.scope = "row";
        name.append(cell("small", result.probability_source === "native" ? "Native probabilities" : "Verbalized probabilities"));
        const metric = result.metrics;
        row.append(name,
          cell("td", `${metric.n_correct} / 231 · ${percent(metric.accuracy)}`),
          cell("td", `${metric.n_strict_valid} / 231`),
          cell("td", metric.n_renormalized),
          cell("td", `${metric.latency.p50_ms.toFixed(1)} ms`),
          cell("td", `${metric.latency.p95_ms.toFixed(1)} ms`));
        return row;
      });
      const tiers = report.results.map((result) => {
        const row = document.createElement("tr");
        const name = cell("th", result.label);
        name.scope = "row";
        row.append(name, ...["original", "easy", "hard"].map((tier) => {
          const metric = result.per_public_tier[tier];
          return cell("td", `${metric.n_correct} / ${metric.n_planned}`);
        }));
        return row;
      });
      document.querySelector("#jevbench-rows").replaceChildren(...rows);
      document.querySelector("#jevbench-tier-rows").replaceChildren(...tiers);
      status.textContent = "All five model streams complete and independently audited · 231 public tasks per model.";
      content.hidden = false;
    } catch {
      content.hidden = true;
      status.textContent = "JevBench results are unavailable. See the linked method and aggregate report.";
    }
  }
  loadJevBench();
})();
