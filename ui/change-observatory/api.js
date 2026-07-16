import { normalizeViewModel, safeRawHref } from "./model.js";

const DEFAULT_ENDPOINT = "/api/v1/observatory";
const MAX_RAW_CHARACTERS = 2_000_000;

export class ObservatoryApiError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ObservatoryApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? "OBSERVATORY_API_ERROR";
  }
}

export class ObservatoryApi {
  constructor({ endpoint = DEFAULT_ENDPOINT, fetchImpl = globalThis.fetch, accessToken = null } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }
    this.endpoint = endpoint;
    this.accessToken = normalizeAccessToken(accessToken);
    this.fetchImpl = (...args) => Reflect.apply(fetchImpl, globalThis, args);
  }

  async load({ signal } = {}) {
    const response = await this.#request(this.endpoint, {
      signal,
      headers: { Accept: "application/json" },
    });

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ObservatoryApiError("The observatory API returned malformed JSON.", {
        status: response.status,
        code: "MALFORMED_VIEW_MODEL",
        cause: error,
      });
    }

    try {
      return normalizeViewModel(payload);
    } catch (error) {
      throw new ObservatoryApiError(error.message, {
        status: response.status,
        code: "UNSUPPORTED_VIEW_MODEL",
        cause: error,
      });
    }
  }

  async loadRaw(href, { signal } = {}) {
    const safeHref = safeRawHref(href);
    if (!safeHref) {
      throw new ObservatoryApiError("The selected raw source is outside canonical .sdlc evidence.", {
        code: "UNSAFE_RAW_SOURCE",
      });
    }

    const response = await this.#request(safeHref, {
      signal,
      headers: { Accept: "application/json, text/plain;q=0.9" },
    });
    const text = await response.text();
    const bounded =
      text.length > MAX_RAW_CHARACTERS
        ? `${text.slice(0, MAX_RAW_CHARACTERS)}\n\n[Raw preview truncated at ${MAX_RAW_CHARACTERS.toLocaleString()} characters]`
        : text;

    if (response.headers.get("content-type")?.includes("application/json")) {
      try {
        return JSON.stringify(JSON.parse(bounded), null, 2);
      } catch {
        return bounded;
      }
    }
    return bounded;
  }

  async #request(url, options) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        headers: {
          ...options.headers,
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new ObservatoryApiError("The local Change Observatory API is unavailable.", {
        code: "API_UNAVAILABLE",
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ObservatoryApiError(`The observatory API returned HTTP ${response.status}.`, {
        status: response.status,
        code: "API_RESPONSE_ERROR",
      });
    }
    return response;
  }
}

export function accessTokenFromHash(hash) {
  if (typeof hash !== "string" || !hash.startsWith("#")) return null;
  const token = new URLSearchParams(hash.slice(1)).get("access_token");
  return normalizeAccessToken(token);
}

function normalizeAccessToken(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) return null;
  return value;
}
