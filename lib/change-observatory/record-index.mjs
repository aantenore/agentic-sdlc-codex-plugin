const EMPTY_BUCKET = Object.freeze([]);

/**
 * Describe one deterministic index entry.
 *
 * Selectors return arrays of these entries so a record can contribute zero,
 * one, or many keys without the index needing to understand record shapes.
 */
export function recordIndexEntry(key, value, options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError("Record index entry options must be an object");
  }
  const priority = options.priority ?? 0;
  if (!Number.isSafeInteger(priority) || priority < 0) {
    throw new TypeError("Record index entry priority must be a non-negative safe integer");
  }
  return priority === 0 ? { key, value } : { key, value, priority };
}

/**
 * Build multiple immutable lookup tables in one pass over canonical records.
 * Bucket order is exactly the input order, including the order of multiple
 * entries emitted by a selector for the same record.
 */
export function createRecordIndex(records, definitions, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("Record index input must be an array");
  }
  if (!isPlainObject(definitions)) {
    throw new TypeError("Record index definitions must be an object");
  }
  if (!isPlainObject(options)) {
    throw new TypeError("Record index options must be an object");
  }

  const selectors = Object.entries(definitions);
  for (const [name, selector] of selectors) {
    if (typeof selector !== "function") {
      throw new TypeError(`Record index selector '${name}' must be a function`);
    }
  }
  const defaultMaxEntries = normalizeEntryLimit(options.maxEntries, "maxEntries");
  const maxEntriesByIndex = options.maxEntriesByIndex ?? {};
  if (!isPlainObject(maxEntriesByIndex)) {
    throw new TypeError("Record index maxEntriesByIndex must be an object");
  }
  for (const name of Object.keys(maxEntriesByIndex)) {
    if (!Object.hasOwn(definitions, name)) {
      throw new RangeError(`Unknown record index entry limit '${name}'`);
    }
  }
  const directIndexes = normalizeDirectIndexes(options.directIndexes, definitions);
  const entryLimits = new Map(selectors.map(([name]) => [
    name,
    normalizeEntryLimit(maxEntriesByIndex[name], `maxEntriesByIndex.${name}`, defaultMaxEntries),
  ]));

  const builders = new Map(selectors.map(([name]) => [
    name,
    directIndexes.has(name)
      ? new DirectIndexBuilder(entryLimits.get(name), records.length)
      : new BoundedIndexBuilder(entryLimits.get(name)),
  ]));
  const truncatedIndexes = new Set();
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    for (const [name, selector] of selectors) {
      const entries = selector(record, recordIndex);
      if (entries === undefined || entries === null) continue;
      if (!Array.isArray(entries)) {
        throw new TypeError(`Record index selector '${name}' must return an array`);
      }
      if (directIndexes.has(name) && entries.length > 1) {
        throw new TypeError(
          `Direct record index selector '${name}' must return at most one entry`,
        );
      }
      const builder = builders.get(name);
      for (const entry of entries) {
        if (!isPlainObject(entry) || !("key" in entry)) {
          throw new TypeError(`Record index selector '${name}' returned an invalid entry`);
        }
        if (entry.key === undefined || entry.key === null || entry.key === "") continue;
        const priority = entry.priority ?? 0;
        if (!Number.isSafeInteger(priority) || priority < 0) {
          throw new TypeError(
            `Record index selector '${name}' returned an invalid entry priority`,
          );
        }
        builder.add(
          entry.key,
          entry.value === undefined ? record : entry.value,
          priority,
        );
      }
    }
  }

  const indexes = new Map();
  const entryCounts = new Map();
  for (const [name, builder] of builders) {
    const built = builder.finish();
    indexes.set(name, built.index);
    entryCounts.set(name, built.entryCount);
    if (built.truncated) truncatedIndexes.add(name);
  }

  const requireIndex = (name) => {
    const index = indexes.get(name);
    if (!index) throw new RangeError(`Unknown record index '${name}'`);
    return index;
  };

  return Object.freeze({
    get(name, key) {
      return requireIndex(name).get(key) ?? EMPTY_BUCKET;
    },
    has(name, key) {
      return requireIndex(name).has(key);
    },
    entries(name) {
      return requireIndex(name).entries();
    },
    keys(name) {
      return requireIndex(name).keys();
    },
    size(name) {
      return requireIndex(name).size;
    },
    entryCount(name) {
      requireIndex(name);
      return entryCounts.get(name);
    },
    truncated(name) {
      requireIndex(name);
      return truncatedIndexes.has(name);
    },
  });
}

/**
 * Build buckets directly when a selector is declared as emitting at most one
 * entry per input record and the configured budget cannot be exceeded. The
 * bounded builder remains the exact fallback for smaller budgets, including
 * its priority-aware retention semantics.
 */
class DirectIndexBuilder {
  constructor(limit, recordCount) {
    this.fallback = limit < recordCount ? new BoundedIndexBuilder(limit) : null;
    this.index = this.fallback ? null : new Map();
    this.count = 0;
  }

  add(key, value, priority) {
    if (this.fallback) {
      this.fallback.add(key, value, priority);
      return;
    }
    const existing = this.index.get(key);
    if (existing) {
      existing.push(value);
    } else {
      this.index.set(key, [value]);
    }
    this.count += 1;
  }

  finish() {
    if (this.fallback) return this.fallback.finish();
    const index = this.index;
    this.index = null;
    for (const [key, bucket] of index) index.set(key, Object.freeze(bucket));
    return {
      index,
      entryCount: this.count,
      truncated: false,
    };
  }
}

class BoundedIndexBuilder {
  constructor(limit) {
    this.limit = limit;
    this.heap = [];
    this.sequence = 0;
    this.truncated = false;
  }

  add(key, value, priority) {
    const candidate = { key, value, priority, sequence: this.sequence++ };
    if (this.heap.length < this.limit) {
      pushWorstFirst(this.heap, candidate);
      return;
    }

    this.truncated = true;
    const worst = this.heap[0];
    if (candidate.priority <= worst.priority) return;
    this.heap[0] = candidate;
    restoreWorstFirst(this.heap, 0);
  }

  finish() {
    const retained = this.heap;
    this.heap = [];
    retained.sort((left, right) => left.sequence - right.sequence);
    const index = new Map();
    for (const entry of retained) {
      const bucket = index.get(entry.key) ?? [];
      bucket.push(entry.value);
      if (!index.has(entry.key)) index.set(entry.key, bucket);
    }
    for (const [key, bucket] of index) index.set(key, Object.freeze(bucket));
    return {
      index,
      entryCount: retained.length,
      truncated: this.truncated,
    };
  }
}

function normalizeDirectIndexes(value, definitions) {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) {
    throw new TypeError("Record index directIndexes must be an array");
  }
  const indexes = new Set();
  for (const name of value) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Record index directIndexes must contain non-empty strings");
    }
    if (!Object.hasOwn(definitions, name)) {
      throw new RangeError(`Unknown direct record index '${name}'`);
    }
    indexes.add(name);
  }
  return indexes;
}

function pushWorstFirst(heap, candidate) {
  heap.push(candidate);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >>> 1;
    if (!isWorseCandidate(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function restoreWorstFirst(heap, startIndex) {
  let index = startIndex;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorseCandidate(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorseCandidate(heap[right], heap[worst])) worst = right;
    if (worst === index) return;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

function isWorseCandidate(left, right) {
  if (left.priority !== right.priority) return left.priority < right.priority;
  return left.sequence > right.sequence;
}

function normalizeEntryLimit(value, label, fallback = Number.POSITIVE_INFINITY) {
  if (value === undefined) return fallback;
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Record index ${label} must be a positive safe integer`);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
