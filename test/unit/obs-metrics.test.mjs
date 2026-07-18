import assert from "node:assert/strict";
import test from "node:test";

import {
  createMetricRegistry,
  evaluateSlo,
} from "../../lib/observability/metrics.mjs";

function createRegistry() {
  return createMetricRegistry({
    definitions: [
      {
        name: "operations_total",
        type: "counter",
        labels: {
          operation: ["cli", "observatory"],
          outcome: ["error", "success"],
        },
      },
      { name: "active_operations", type: "gauge" },
      {
        name: "operation_duration_ms",
        type: "distribution",
        labels: { operation: ["cli", "observatory"] },
      },
    ],
  });
}

test("metric registry records counters, gauges, and distributions deterministically", () => {
  const registry = createRegistry();
  registry.increment("operations_total", { operation: "cli", outcome: "success" });
  registry.increment("operations_total", { operation: "cli", outcome: "success" }, 2);
  registry.set("active_operations", {}, 3);
  registry.observe("operation_duration_ms", { operation: "cli" }, 10);
  registry.observe("operation_duration_ms", { operation: "cli" }, 20);

  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot, {
    schema_version: "agentic-sdlc-metrics-snapshot:v1",
    metrics: [
      {
        name: "active_operations",
        type: "gauge",
        maximum_series: 1,
        series: [{ labels: {}, value: 3 }],
      },
      {
        name: "operation_duration_ms",
        type: "distribution",
        maximum_series: 2,
        series: [{
          labels: { operation: "cli" },
          value: { count: 2, sum: 30, min: 10, max: 20, average: 15 },
        }],
      },
      {
        name: "operations_total",
        type: "counter",
        maximum_series: 4,
        series: [{ labels: { operation: "cli", outcome: "success" }, value: 3 }],
      },
    ],
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.metrics[1].series[0].value), true);
  assert.throws(() => { snapshot.metrics[0].series[0].value = 99; }, TypeError);
});

test("metric labels and series cardinality are closed by definition", () => {
  const registry = createRegistry();
  assert.throws(
    () => registry.increment("operations_total", { operation: "cli", outcome: "success", user: "alice" }),
    (error) => error?.code === "metric_labels_not_closed",
  );
  assert.throws(
    () => registry.increment("operations_total", { operation: "dynamic", outcome: "success" }),
    (error) => error?.code === "metric_label_value_not_allowed",
  );
  assert.throws(
    () => registry.increment("operations_total", { operation: "cli", outcome: "success" }, -1),
    /must not be negative/u,
  );
  registry.increment(
    "operations_total",
    { operation: "observatory", outcome: "error" },
    Number.MAX_VALUE,
  );
  assert.throws(
    () => registry.increment(
      "operations_total",
      { operation: "observatory", outcome: "error" },
      Number.MAX_VALUE,
    ),
    (error) => error?.code === "metric_value_overflow",
  );
  assert.throws(
    () => createMetricRegistry({
      maxSeriesPerMetric: 3,
      definitions: [{
        name: "too_many",
        type: "counter",
        labels: { left: ["a", "b"], right: ["a", "b"] },
      }],
    }),
    (error) => error?.code === "metric_cardinality_exceeded",
  );
});

test("SLO evaluation distinguishes insufficient data, met, and breached", () => {
  assert.equal(evaluateSlo({ name: "availability", good: 0, total: 0, target: 0.99 }).status, "insufficient_data");
  assert.equal(
    evaluateSlo({ name: "availability", good: 9, total: 10, target: 0.9, minimumSamples: 20 }).status,
    "insufficient_data",
  );
  const met = evaluateSlo({ name: "availability", good: 99, total: 100, target: 0.99 });
  assert.equal(met.status, "met");
  assert.equal(met.sli.ratio, 0.99);
  assert.equal(met.objective.comparison, "at_least");
  assert.equal(
    evaluateSlo({ name: "availability", good: 98, total: 100, target: 0.99 }).status,
    "breached",
  );
  assert.throws(
    () => evaluateSlo({ name: "availability", good: 101, total: 100, target: 0.99 }),
    /must not exceed total/u,
  );
});
