export const PORTFOLIO_VIEW_SCHEMA_VERSION = "change-observatory:portfolio:v1";
export const MAX_PORTFOLIO_COLLECTION_CONCURRENCY = 4;
export const MAX_PORTFOLIO_PROJECT_PREVIEWS = 8;

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

export async function collectPortfolioSummary(projects, options = {}) {
  if (!Array.isArray(projects) || projects.length < 1) {
    throw new TypeError("Portfolio collection requires at least one project");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Portfolio collection options must be an object");
  }
  if (typeof options.loadProject !== "function") {
    throw new TypeError("Portfolio collection requires a project loader");
  }
  const concurrency = normalizeConcurrency(options.concurrency);
  const results = new Array(projects.length);
  let cursor = 0;

  async function worker() {
    while (cursor < projects.length) {
      const index = cursor;
      cursor += 1;
      const project = projects[index];
      validateProjectDescriptor(project);
      try {
        const model = await options.loadProject(project, index);
        results[index] = summarizeAvailableProject(project.id, model);
      } catch (error) {
        results[index] = summarizeUnavailableProject(project.id, error);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, projects.length) },
    () => worker(),
  ));

  const unavailableProjectCount = results.filter((project) => project.status === "unavailable").length;
  return Object.freeze({
    schemaVersion: PORTFOLIO_VIEW_SCHEMA_VERSION,
    generatedAt: normalizeInstant(options.clock),
    status: unavailableProjectCount === 0 ? "ready" : "degraded",
    projectCount: results.length,
    availableProjectCount: results.length - unavailableProjectCount,
    unavailableProjectCount,
    projects: Object.freeze(results),
  });
}

function summarizeAvailableProject(id, model) {
  if (!isPlainObject(model) || !isPlainObject(model.project) || !isPlainObject(model.summary)) {
    throw new TypeError("The project view is not a supported Change Observatory model");
  }
  const diagnostics = Array.isArray(model.diagnostics) ? model.diagnostics : [];
  const previews = [];
  for (const [kind, items] of [
    ["asked", model.summary.asked],
    ["changed", model.summary.changed],
    ["decided", model.summary.decided],
  ]) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (previews.length >= MAX_PORTFOLIO_PROJECT_PREVIEWS) break;
      previews.push(summarizePreview(kind, item));
    }
  }
  const hasError = diagnostics.some((item) => item?.severity === "error");
  const hasWarning = diagnostics.some((item) => item?.severity === "warning");
  return Object.freeze({
    id,
    status: "available",
    health: hasError ? "needs_attention" : hasWarning ? "review" : "ready",
    name: safeOptionalText(model.project.name) ?? safeOptionalText(model.project.id) ?? id,
    branch: safeOptionalText(model.project.branch),
    detailHref: portfolioDetailHref(id),
    counts: Object.freeze({
      asked: collectionLength(model.summary.asked),
      changed: collectionLength(model.summary.changed),
      decided: collectionLength(model.summary.decided),
      iterations: collectionLength(model.iterations),
      contracts: collectionLength(model.contracts),
      decisions: collectionLength(model.decisions),
      changes: collectionLength(model.changes),
      verification: collectionLength(model.verification),
      diagnostics: diagnostics.length,
    }),
    previews: Object.freeze(previews),
  });
}

function summarizePreview(kind, item) {
  const candidate = isPlainObject(item) ? item : {};
  return Object.freeze({
    kind,
    id: safeOptionalText(candidate.id),
    type: safeOptionalText(candidate.type),
    title: safeOptionalText(candidate.humanTitle ?? candidate.title),
    summary: safeOptionalText(candidate.humanSummary ?? candidate.summary),
    status: safeOptionalText(candidate.humanStatus ?? candidate.status),
    phase: safeOptionalText(candidate.phase),
    timestamp: safeOptionalText(candidate.timestamp),
    provenance: safeOptionalText(candidate.provenance),
  });
}

function summarizeUnavailableProject(id, error) {
  const errorCode = safeErrorCode(error);
  return Object.freeze({
    id,
    status: "unavailable",
    health: "unavailable",
    name: id,
    detailHref: portfolioDetailHref(id),
    errorCode,
    message: humanProjectError(errorCode),
    counts: Object.freeze({
      asked: 0,
      changed: 0,
      decided: 0,
      iterations: 0,
      contracts: 0,
      decisions: 0,
      changes: 0,
      verification: 0,
      diagnostics: 0,
    }),
    previews: Object.freeze([]),
  });
}

function humanProjectError(code) {
  if (code === "knowledge_base_not_found") {
    return "This project has no Agentic SDLC records to show yet.";
  }
  if (code.startsWith("observability_configuration_")) {
    return "This project cannot be shown until its Observatory privacy settings are corrected and the view is restarted.";
  }
  if (
    code === "project_boundary_changed"
    || code === "portfolio_project_root_changed"
    || code === "canonical_revision_changed"
  ) {
    return "This project's records changed while they were being read. Reload the portfolio to try again.";
  }
  if (code === "knowledge_base_symlink" || code === "symlink_forbidden") {
    return "This project's records are linked through an unsupported filesystem alias and cannot be read safely.";
  }
  if (code.endsWith("_too_large") || code === "collection_limit_exceeded") {
    return "This project contains more recorded data than the configured safe viewing limit.";
  }
  return "This project could not be read safely. Its other portfolio projects are still available.";
}

function portfolioDetailHref(id) {
  return `/api/v1/portfolio/project?project=${encodeURIComponent(id)}`;
}

function normalizeConcurrency(value = MAX_PORTFOLIO_COLLECTION_CONCURRENCY) {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_PORTFOLIO_COLLECTION_CONCURRENCY
  ) {
    throw new TypeError(
      `Portfolio collection concurrency must be between 1 and ${MAX_PORTFOLIO_COLLECTION_CONCURRENCY}`,
    );
  }
  return value;
}

function validateProjectDescriptor(project) {
  if (
    !isPlainObject(project)
    || typeof project.id !== "string"
    || !PROJECT_ID_PATTERN.test(project.id)
  ) {
    throw new TypeError("Portfolio projects must have canonical identifiers");
  }
}

function safeErrorCode(error) {
  const code = String(error?.code || "project_unavailable").toLowerCase();
  return SAFE_ERROR_CODE_PATTERN.test(code) ? code : "project_unavailable";
}

function collectionLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function safeOptionalText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeInstant(clock) {
  const value = typeof clock === "function" ? clock() : clock ?? new Date();
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new TypeError("Portfolio clock returned an invalid date");
  }
  return instant.toISOString();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
