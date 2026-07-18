const METRIC_NAME_PATTERN = /^[a-z][a-z0-9_]{0,127}$/u;
const LABEL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const METRIC_TYPES = new Set(["counter", "gauge", "distribution"]);
const DEFAULT_MAX_DEFINITIONS = 128;
const DEFAULT_MAX_SERIES_PER_METRIC = 10_000;

export class MetricDefinitionError extends TypeError {
  constructor(message, code = "metric_definition_invalid") {
    super(message);
    this.name = "MetricDefinitionError";
    this.code = code;
  }
}

export class MetricRecordingError extends Error {
  constructor(message, code = "metric_recording_invalid") {
    super(message);
    this.name = "MetricRecordingError";
    this.code = code;
  }
}

export function createMetricRegistry(options = {}) {
  if (!isPlainRecord(options)) {
    throw new MetricDefinitionError("metric registry options must be a plain object");
  }
  const maxDefinitions = normalizePositiveInteger(
    options.maxDefinitions ?? DEFAULT_MAX_DEFINITIONS,
    "maxDefinitions",
  );
  const maxSeriesPerMetric = normalizePositiveInteger(
    options.maxSeriesPerMetric ?? DEFAULT_MAX_SERIES_PER_METRIC,
    "maxSeriesPerMetric",
  );
  if (!Array.isArray(options.definitions) || options.definitions.length === 0) {
    throw new MetricDefinitionError("definitions must be a non-empty array");
  }
  if (options.definitions.length > maxDefinitions) {
    throw new MetricDefinitionError(`definitions exceed maxDefinitions (${maxDefinitions})`);
  }

  const definitions = new Map();
  const series = new Map();
  for (const [index, candidate] of options.definitions.entries()) {
    const definition = normalizeDefinition(candidate, index, maxSeriesPerMetric);
    if (definitions.has(definition.name)) {
      throw new MetricDefinitionError(`metric '${definition.name}' is defined more than once`);
    }
    definitions.set(definition.name, definition);
    series.set(definition.name, new Map());
  }

  const registry = {
    increment(name, labels = {}, amount = 1) {
      const definition = requireDefinition(definitions, name, "counter");
      const delta = normalizeFiniteNumber(amount, "counter amount");
      if (delta < 0) {
        throw new MetricRecordingError("counter amount must not be negative");
      }
      const entry = getOrCreateSeries(definition, series.get(name), labels, () => ({ value: 0 }));
      const next = entry.value + delta;
      if (!Number.isFinite(next)) {
        throw new MetricRecordingError("counter value exceeds the finite numeric range", "metric_value_overflow");
      }
      entry.value = next;
      return entry.value;
    },
    set(name, labels = {}, value) {
      const definition = requireDefinition(definitions, name, "gauge");
      const normalized = normalizeFiniteNumber(value, "gauge value");
      const entry = getOrCreateSeries(definition, series.get(name), labels, () => ({ value: 0 }));
      entry.value = normalized;
      return entry.value;
    },
    observe(name, labels = {}, value) {
      const definition = requireDefinition(definitions, name, "distribution");
      const normalized = normalizeFiniteNumber(value, "distribution value");
      const entry = getOrCreateSeries(definition, series.get(name), labels, () => ({
        count: 0,
        sum: 0,
        min: null,
        max: null,
      }));
      const nextSum = entry.sum + normalized;
      if (!Number.isFinite(nextSum)) {
        throw new MetricRecordingError(
          "distribution sum exceeds the finite numeric range",
          "metric_value_overflow",
        );
      }
      entry.count += 1;
      entry.sum = nextSum;
      entry.min = entry.min === null ? normalized : Math.min(entry.min, normalized);
      entry.max = entry.max === null ? normalized : Math.max(entry.max, normalized);
      return entry.count;
    },
    snapshot() {
      return createSnapshot(definitions, series);
    },
  };
  return Object.freeze(registry);
}

export function evaluateSlo(input) {
  if (!isPlainRecord(input)) {
    throw new MetricDefinitionError("SLO input must be a plain object", "slo_definition_invalid");
  }
  const name = normalizeName(input.name ?? "unnamed_slo", "SLO name");
  const good = normalizeNonNegativeNumber(input.good, "good");
  const total = normalizeNonNegativeNumber(input.total, "total");
  const target = normalizeRatio(input.target, "target");
  const minimumSamples = normalizeNonNegativeNumber(input.minimumSamples ?? 1, "minimumSamples");
  if (good > total) {
    throw new MetricDefinitionError("good must not exceed total", "slo_definition_invalid");
  }
  const ratio = total === 0 ? null : good / total;
  const status = total < minimumSamples || total === 0
    ? "insufficient_data"
    : ratio >= target
      ? "met"
      : "breached";
  return deepFreeze({
    schema_version: "agentic-sdlc-slo-evaluation:v1",
    name,
    status,
    sli: {
      good,
      total,
      ratio,
    },
    objective: {
      target,
      minimum_samples: minimumSamples,
      comparison: "at_least",
    },
  });
}

function normalizeDefinition(input, index, maxSeriesPerMetric) {
  if (!isPlainRecord(input)) {
    throw new MetricDefinitionError(`definitions[${index}] must be a plain object`);
  }
  const name = normalizeName(input.name, `definitions[${index}].name`);
  const type = input.type;
  if (!METRIC_TYPES.has(type)) {
    throw new MetricDefinitionError(
      `definitions[${index}].type must be counter, gauge, or distribution`,
    );
  }
  const labels = normalizeLabels(input.labels, `definitions[${index}].labels`);
  let maximumSeries = 1;
  for (const values of Object.values(labels)) {
    maximumSeries *= values.length;
    if (!Number.isSafeInteger(maximumSeries) || maximumSeries > maxSeriesPerMetric) {
      throw new MetricDefinitionError(
        `metric '${name}' can create more than ${maxSeriesPerMetric} series`,
        "metric_cardinality_exceeded",
      );
    }
  }
  return deepFreeze({ name, type, labels, maximum_series: maximumSeries });
}

function normalizeLabels(input, label) {
  if (input === undefined) return Object.freeze({});
  if (!isPlainRecord(input)) {
    throw new MetricDefinitionError(`${label} must be a plain object`);
  }
  const result = {};
  for (const name of Object.keys(input).sort()) {
    if (!LABEL_NAME_PATTERN.test(name)) {
      throw new MetricDefinitionError(`${label}.${name} has an invalid label name`);
    }
    const values = input[name];
    if (!Array.isArray(values) || values.length === 0) {
      throw new MetricDefinitionError(`${label}.${name} must be a non-empty array`);
    }
    const normalized = values.map((value, index) => {
      if (typeof value !== "string" || value.length === 0 || value.length > 128) {
        throw new MetricDefinitionError(`${label}.${name}[${index}] must be a short non-empty string`);
      }
      return value;
    });
    if (new Set(normalized).size !== normalized.length) {
      throw new MetricDefinitionError(`${label}.${name} contains duplicate values`);
    }
    result[name] = Object.freeze([...normalized].sort());
  }
  return Object.freeze(result);
}

function getOrCreateSeries(definition, metricSeries, rawLabels, factory) {
  const labels = normalizeRecordedLabels(definition, rawLabels);
  const key = JSON.stringify(labels);
  let entry = metricSeries.get(key);
  if (!entry) {
    if (metricSeries.size >= definition.maximum_series) {
      throw new MetricRecordingError(
        `metric '${definition.name}' reached its closed cardinality bound`,
        "metric_cardinality_exceeded",
      );
    }
    entry = { labels, ...factory() };
    metricSeries.set(key, entry);
  }
  return entry;
}

function normalizeRecordedLabels(definition, input) {
  if (!isPlainRecord(input)) {
    throw new MetricRecordingError(`labels for '${definition.name}' must be a plain object`);
  }
  const expected = Object.keys(definition.labels);
  const actual = Object.keys(input).sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new MetricRecordingError(
      `labels for '${definition.name}' must be exactly: ${expected.join(", ") || "(none)"}`,
      "metric_labels_not_closed",
    );
  }
  const result = {};
  for (const name of expected) {
    if (!definition.labels[name].includes(input[name])) {
      throw new MetricRecordingError(
        `label '${name}' for '${definition.name}' is outside its configured values`,
        "metric_label_value_not_allowed",
      );
    }
    result[name] = input[name];
  }
  return Object.freeze(result);
}

function requireDefinition(definitions, name, expectedType) {
  const definition = definitions.get(name);
  if (!definition) {
    throw new MetricRecordingError(`metric '${name}' is not defined`, "metric_not_defined");
  }
  if (definition.type !== expectedType) {
    throw new MetricRecordingError(
      `metric '${name}' is ${definition.type}, not ${expectedType}`,
      "metric_type_mismatch",
    );
  }
  return definition;
}

function createSnapshot(definitions, allSeries) {
  const metrics = [];
  for (const definition of [...definitions.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const entries = [...allSeries.get(definition.name).entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => ({
        labels: entry.labels,
        value: definition.type === "distribution"
          ? {
              count: entry.count,
              sum: entry.sum,
              min: entry.min,
              max: entry.max,
              average: entry.count === 0 ? null : entry.sum / entry.count,
            }
          : entry.value,
      }));
    metrics.push({
      name: definition.name,
      type: definition.type,
      maximum_series: definition.maximum_series,
      series: entries,
    });
  }
  return deepFreeze({
    schema_version: "agentic-sdlc-metrics-snapshot:v1",
    metrics,
  });
}

function normalizeName(value, label) {
  if (typeof value !== "string" || !METRIC_NAME_PATTERN.test(value)) {
    throw new MetricDefinitionError(`${label} must match ${METRIC_NAME_PATTERN}`);
  }
  return value;
}

function normalizePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MetricDefinitionError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizeFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MetricRecordingError(`${label} must be a finite number`);
  }
  return value;
}

function normalizeNonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MetricDefinitionError(`${label} must be a non-negative finite number`, "slo_definition_invalid");
  }
  return value;
}

function normalizeRatio(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MetricDefinitionError(`${label} must be between 0 and 1`, "slo_definition_invalid");
  }
  return value;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}
