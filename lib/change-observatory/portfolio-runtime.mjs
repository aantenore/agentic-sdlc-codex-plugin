import crypto from "node:crypto";

import {
  collectPortfolioSummary,
} from "./portfolio-collector.mjs";
import {
  assertPortfolioEnvelopeBoundaries,
  assertPortfolioProjectBoundary,
  loadPortfolioManifest,
} from "./portfolio-manifest.mjs";
import {
  createProjectDataRuntime,
} from "./project-runtime.mjs";
import { normalizePortableRelativePath } from "./path-safety.mjs";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export class PortfolioRuntimeError extends Error {
  constructor(code, message, statusCode, retryable = undefined) {
    super(message);
    this.name = "PortfolioRuntimeError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export async function createPortfolioRuntime(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Portfolio runtime options must be an object");
  }
  const manifest = options.manifest ?? await loadPortfolioManifest(
    options.portfolioRoot,
    options.manifestPath,
  );
  await assertPortfolioEnvelopeBoundaries(manifest);
  const projectsById = new Map(manifest.projects.map((project) => [project.id, project]));
  const runtimePromises = new Map();
  const createProjectRuntime = options.createProjectRuntime ?? createProjectDataRuntime;
  if (typeof createProjectRuntime !== "function") {
    throw new TypeError("Portfolio runtime project factory must be a function");
  }
  const generatedAt = normalizeInstant(options.clock);
  let summaryInFlight = null;

  function projectDescriptor(projectId) {
    if (
      typeof projectId !== "string"
      || projectId !== projectId.trim()
      || !PROJECT_ID_PATTERN.test(projectId)
    ) {
      throw new PortfolioRuntimeError(
        "invalid_portfolio_project",
        "A valid portfolio project identifier is required",
        400,
        false,
      );
    }
    const project = projectsById.get(projectId);
    if (!project) {
      throw new PortfolioRuntimeError(
        "portfolio_project_not_found",
        "The requested portfolio project does not exist",
        404,
        false,
      );
    }
    return project;
  }

  async function runtimeFor(project) {
    await assertPortfolioProjectBoundary(manifest, project.id);
    let pending = runtimePromises.get(project.id);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => createProjectRuntime({
          projectRoot: project.root,
          projectId: project.id,
          limits: options.limits,
          clock: options.clock,
          summaryRanking: options.summaryRanking,
          redactionPolicy: options.redactionPolicy,
          operationalPolicy: options.operationalPolicy,
        }))
        .catch((error) => {
          if (runtimePromises.get(project.id) === pending) {
            runtimePromises.delete(project.id);
          }
          throw error;
        });
      runtimePromises.set(project.id, pending);
    }
    const runtime = await pending;
    validateProjectRuntime(runtime);
    await assertPortfolioProjectBoundary(manifest, project.id);
    return runtime;
  }

  async function loadProjectModel(project) {
    const runtime = await runtimeFor(project);
    const representation = await runtime.getRepresentation();
    await assertPortfolioProjectBoundary(manifest, project.id);
    return parseProjectModel(representation);
  }

  async function buildSummaryRepresentation() {
    await assertPortfolioEnvelopeBoundaries(manifest);
    const summary = await collectPortfolioSummary(manifest.projects, {
      concurrency: options.concurrency,
      clock: () => generatedAt,
      loadProject: loadProjectModel,
    });
    await assertPortfolioEnvelopeBoundaries(manifest);
    return createJsonRepresentation(summary);
  }

  async function getSummaryRepresentation() {
    if (summaryInFlight) return summaryInFlight;
    const pending = buildSummaryRepresentation();
    summaryInFlight = pending;
    try {
      return await pending;
    } finally {
      if (summaryInFlight === pending) summaryInFlight = null;
    }
  }

  async function getProjectDetailRepresentation(projectId) {
    await assertPortfolioEnvelopeBoundaries(manifest);
    const project = projectDescriptor(projectId);
    const model = await loadProjectModel(project);
    const portfolioModel = rewritePortfolioRawHrefs(model, project.id);
    await assertPortfolioProjectBoundary(manifest, project.id);
    await assertPortfolioEnvelopeBoundaries(manifest);
    return createJsonRepresentation(portfolioModel);
  }

  async function getSourceRepresentation(projectId, relativePath) {
    await assertPortfolioEnvelopeBoundaries(manifest);
    const project = projectDescriptor(projectId);
    await assertPortfolioProjectBoundary(manifest, project.id);
    const runtime = await runtimeFor(project);
    const source = await runtime.readSource(relativePath);
    await assertPortfolioProjectBoundary(manifest, project.id);
    await assertPortfolioEnvelopeBoundaries(manifest);
    return createJsonRepresentation(source);
  }

  return Object.freeze({
    manifest,
    async assertReady() {
      await assertPortfolioEnvelopeBoundaries(manifest);
    },
    assertBoundaries() {
      return assertPortfolioEnvelopeBoundaries(manifest);
    },
    getSummaryRepresentation,
    getProjectDetailRepresentation,
    getSourceRepresentation,
    async getProjectRedactionPolicy(projectId) {
      const project = projectDescriptor(projectId);
      const runtime = await runtimeFor(project);
      return runtime.redactionPolicy;
    },
  });
}

function parseProjectModel(representation) {
  const body = representation?.body;
  if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    throw new TypeError("Project runtime returned an invalid model representation");
  }
  let model;
  try {
    model = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new TypeError("Project runtime returned malformed model JSON");
  }
  if (model?.schemaVersion !== "change-observatory:view:v1") {
    throw new TypeError("Project runtime returned an unsupported model schema");
  }
  return model;
}

function rewritePortfolioRawHrefs(model, projectId) {
  return JSON.parse(JSON.stringify(model, (key, value) => {
    if (key !== "rawHref") return value;
    return rewriteRawHref(value, projectId);
  }));
}

function rewriteRawHref(value, projectId) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value, "http://change-observatory.local");
  } catch {
    return null;
  }
  if (
    url.origin !== "http://change-observatory.local"
    || url.pathname !== "/api/v1/source"
    || url.hash !== ""
    || [...url.searchParams.keys()].some((key) => key !== "path")
    || url.searchParams.getAll("path").length !== 1
  ) {
    return null;
  }
  let sourcePath;
  try {
    sourcePath = normalizePortableRelativePath(
      url.searchParams.get("path"),
      { requiredPrefix: ".sdlc" },
    );
  } catch {
    return null;
  }
  return `/api/v1/portfolio/source?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(sourcePath)}`;
}

function createJsonRepresentation(payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const digest = crypto.createHash("sha256").update(body).digest("base64url");
  return Object.freeze({
    etag: `"sha256-${digest}"`,
    body,
  });
}

function validateProjectRuntime(runtime) {
  if (
    runtime === null
    || typeof runtime !== "object"
    || typeof runtime.getRepresentation !== "function"
    || typeof runtime.readSource !== "function"
  ) {
    throw new TypeError("Portfolio project factory returned an invalid runtime");
  }
}

function normalizeInstant(clock) {
  const value = typeof clock === "function" ? clock() : clock ?? new Date();
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new TypeError("Portfolio clock returned an invalid date");
  }
  return instant.toISOString();
}
