import fs from "node:fs";
import path from "node:path";

/**
 * Small, dependency-free JSON Schema validator for the schema vocabulary used
 * by this package. It intentionally reports every deterministic error instead
 * of coercing data or applying defaults.
 */
export function validateAgainstSchema(value, schemaName, options = {}) {
  const schemaDir = path.resolve(options.schemaDir || path.join(process.cwd(), "schemas"));
  const cache = options.cache || new Map();
  const schemaPath = resolveSchemaPath(schemaDir, schemaName);
  const schema = loadSchema(schemaPath, cache);
  const errors = [];
  validateNode(value, schema, {
    instancePath: "$",
    schemaPath,
    rootSchema: schema,
    schemaDir,
    cache,
    errors,
    refStack: [],
  });
  return { valid: errors.length === 0, errors };
}

export function assertAgainstSchema(value, schemaName, options = {}) {
  const result = validateAgainstSchema(value, schemaName, options);
  if (!result.valid) {
    const error = new Error(formatSchemaErrors(schemaName, result.errors));
    error.name = "JsonSchemaValidationError";
    error.schema = schemaName;
    error.validationErrors = result.errors;
    throw error;
  }
  return value;
}

export function formatSchemaErrors(schemaName, errors, limit = 12) {
  const shown = errors.slice(0, limit).map((item) => `${item.instance_path}: ${item.message}`);
  const suffix = errors.length > limit ? `; ${errors.length - limit} more error(s)` : "";
  return `${schemaName} validation failed: ${shown.join("; ")}${suffix}`;
}

function resolveSchemaPath(schemaDir, schemaName) {
  const requested = String(schemaName || "").trim();
  if (!requested || path.isAbsolute(requested) || requested.includes("..") || requested.includes("\\")) {
    throw new Error(`Unsafe schema name '${schemaName}'`);
  }
  const name = requested.endsWith(".json") ? requested : `${requested}.schema.json`;
  const resolved = path.resolve(schemaDir, name);
  if (path.dirname(resolved) !== schemaDir) {
    throw new Error(`Schema must be a direct child of ${schemaDir}`);
  }
  return resolved;
}

function loadSchema(schemaPath, cache) {
  if (cache.has(schemaPath)) {
    return cache.get(schemaPath);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  cache.set(schemaPath, schema);
  return schema;
}

function validateNode(value, schema, state) {
  if (schema === true) {
    return;
  }
  if (schema === false) {
    addError(state, "value is forbidden by the schema", "falseSchema");
    return;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    addError(state, "invalid schema node", "schema");
    return;
  }

  if (schema.$ref) {
    validateReference(value, schema.$ref, state);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      validateNode(value, branch, state);
    }
  }
  if (Array.isArray(schema.anyOf)) {
    validateAlternatives(value, schema.anyOf, state, "anyOf", 1, Number.POSITIVE_INFINITY);
  }
  if (Array.isArray(schema.oneOf)) {
    validateAlternatives(value, schema.oneOf, state, "oneOf", 1, 1);
  }
  if (schema.not !== undefined && branchIsValid(value, schema.not, state)) {
    addError(state, "value matches a forbidden schema", "not");
  }
  if (schema.if !== undefined) {
    const selected = branchIsValid(value, schema.if, state) ? schema.then : schema.else;
    if (selected !== undefined) {
      validateNode(value, selected, state);
    }
  }

  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    addError(state, `must equal ${JSON.stringify(schema.const)}`, "const");
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(value, item))) {
    addError(state, `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`, "enum");
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    const expected = Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type;
    addError(state, `must be ${expected}; found ${jsonType(value)}`, "type");
    return;
  }

  if (typeof value === "string") {
    validateString(value, schema, state);
  } else if (typeof value === "number") {
    validateNumber(value, schema, state);
  } else if (Array.isArray(value)) {
    validateArray(value, schema, state);
  } else if (value && typeof value === "object") {
    validateObject(value, schema, state);
  }
}

function validateReference(value, reference, state) {
  const [filePart, fragment = ""] = String(reference).split("#", 2);
  const targetPath = filePart
    ? resolveExternalReference(state.schemaDir, state.schemaPath, filePart)
    : state.schemaPath;
  const targetRoot = filePart ? loadSchema(targetPath, state.cache) : state.rootSchema;
  const target = resolveJsonPointer(targetRoot, fragment);
  const refKey = `${targetPath}#${fragment}`;
  if (state.refStack.includes(refKey)) {
    addError(state, `cyclic schema reference ${reference}`, "$ref");
    return;
  }
  validateNode(value, target, {
    ...state,
    schemaPath: targetPath,
    rootSchema: targetRoot,
    refStack: [...state.refStack, refKey],
  });
}

function resolveExternalReference(schemaDir, currentSchemaPath, filePart) {
  if (path.isAbsolute(filePart) || filePart.includes("..") || filePart.includes("\\")) {
    throw new Error(`Unsafe schema reference '${filePart}'`);
  }
  const resolved = path.resolve(path.dirname(currentSchemaPath), filePart);
  if (path.dirname(resolved) !== schemaDir) {
    throw new Error(`External schema reference escapes ${schemaDir}: ${filePart}`);
  }
  return resolved;
}

function resolveJsonPointer(root, fragment) {
  if (!fragment) {
    return root;
  }
  if (!fragment.startsWith("/")) {
    throw new Error(`Only JSON Pointer fragments are supported, received '#${fragment}'`);
  }
  return fragment
    .slice(1)
    .split("/")
    .map((part) => decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((node, key) => {
      if (!node || typeof node !== "object" || !(key in node)) {
        throw new Error(`Unresolved JSON Schema pointer '#${fragment}'`);
      }
      return node[key];
    }, root);
}

function validateAlternatives(value, alternatives, state, keyword, minimum, maximum) {
  const results = alternatives.map((branch) => branchErrors(value, branch, state));
  const matches = results.filter((errors) => errors.length === 0).length;
  if (matches < minimum || matches > maximum) {
    const best = results.sort((left, right) => left.length - right.length)[0] || [];
    addError(state, `${keyword} requires ${minimum === maximum ? "exactly" : "at least"} ${minimum} matching branch; found ${matches}`, keyword, {
      branch_errors: best.slice(0, 4),
    });
  }
}

function branchIsValid(value, schema, state) {
  return branchErrors(value, schema, state).length === 0;
}

function branchErrors(value, schema, state) {
  const errors = [];
  validateNode(value, schema, { ...state, errors });
  return errors;
}

function validateString(value, schema, state) {
  if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
    addError(state, `must contain at least ${schema.minLength} character(s)`, "minLength");
  }
  if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
    addError(state, `must contain at most ${schema.maxLength} character(s)`, "maxLength");
  }
  if (schema.pattern !== undefined) {
    let pattern;
    try {
      pattern = new RegExp(schema.pattern, "u");
    } catch (error) {
      throw new Error(`Invalid JSON Schema pattern '${schema.pattern}': ${error.message}`);
    }
    if (!pattern.test(value)) {
      addError(state, `must match pattern ${schema.pattern}`, "pattern");
    }
  }
  if (schema.format && !matchesFormat(value, schema.format)) {
    addError(state, `must match format ${schema.format}`, "format");
  }
}

function validateNumber(value, schema, state) {
  if (schema.type === "integer" && !Number.isInteger(value)) {
    addError(state, "must be an integer", "type");
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    addError(state, `must be >= ${schema.minimum}`, "minimum");
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    addError(state, `must be <= ${schema.maximum}`, "maximum");
  }
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    addError(state, `must be > ${schema.exclusiveMinimum}`, "exclusiveMinimum");
  }
  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
    addError(state, `must be < ${schema.exclusiveMaximum}`, "exclusiveMaximum");
  }
  if (schema.multipleOf !== undefined && !Number.isInteger(value / schema.multipleOf)) {
    addError(state, `must be a multiple of ${schema.multipleOf}`, "multipleOf");
  }
}

function validateArray(value, schema, state) {
  if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
    addError(state, `must contain at least ${schema.minItems} item(s)`, "minItems");
  }
  if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
    addError(state, `must contain at most ${schema.maxItems} item(s)`, "maxItems");
  }
  if (schema.uniqueItems) {
    const seen = new Set();
    for (const item of value) {
      const key = canonicalJson(item);
      if (seen.has(key)) {
        addError(state, "must not contain duplicate items", "uniqueItems");
        break;
      }
      seen.add(key);
    }
  }
  if (schema.items && !Array.isArray(schema.items)) {
    value.forEach((item, index) => validateNode(item, schema.items, childState(state, index)));
  }
  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((itemSchema, index) => {
      if (index < value.length) {
        validateNode(value[index], itemSchema, childState(state, index));
      }
    });
  }
  if (schema.contains !== undefined && !value.some((item, index) => branchIsValid(item, schema.contains, childState(state, index)))) {
    addError(state, "must contain an item matching the contains schema", "contains");
  }
}

function validateObject(value, schema, state) {
  const keys = Object.keys(value);
  if (Number.isInteger(schema.minProperties) && keys.length < schema.minProperties) {
    addError(state, `must contain at least ${schema.minProperties} properties`, "minProperties");
  }
  if (Number.isInteger(schema.maxProperties) && keys.length > schema.maxProperties) {
    addError(state, `must contain at most ${schema.maxProperties} properties`, "maxProperties");
  }
  for (const required of schema.required || []) {
    if (!(required in value)) {
      addError(childState(state, required), "is required", "required");
    }
  }
  const properties = schema.properties || {};
  const patternProperties = schema.patternProperties || {};
  for (const [key, propertyValue] of Object.entries(value)) {
    const matchedPatterns = Object.entries(patternProperties).filter(([pattern]) => new RegExp(pattern, "u").test(key));
    if (key in properties) {
      validateNode(propertyValue, properties[key], childState(state, key));
    }
    for (const [, propertySchema] of matchedPatterns) {
      validateNode(propertyValue, propertySchema, childState(state, key));
    }
    if (!(key in properties) && matchedPatterns.length === 0) {
      if (schema.additionalProperties === false) {
        addError(childState(state, key), "additional property is not allowed", "additionalProperties");
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateNode(propertyValue, schema.additionalProperties, childState(state, key));
      }
    }
  }
  for (const [key, dependencies] of Object.entries(schema.dependentRequired || {})) {
    if (!(key in value)) {
      continue;
    }
    for (const dependency of dependencies) {
      if (!(dependency in value)) {
        addError(childState(state, dependency), `is required when ${key} is present`, "dependentRequired");
      }
    }
  }
}

function childState(state, key) {
  const segment = typeof key === "number" || /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(String(key))
    ? `.${key}`
    : `[${JSON.stringify(String(key))}]`;
  return { ...state, instancePath: `${state.instancePath}${segment}` };
}

function addError(state, message, keyword, extra = {}) {
  state.errors.push({ instance_path: state.instancePath, keyword, message, ...extra });
}

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === type;
  });
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesFormat(value, format) {
  if (format === "date-time") {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  if (format === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
  }
  if (format === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  if (format === "uri") {
    try {
      return Boolean(new URL(value));
    } catch {
      return false;
    }
  }
  return true;
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
