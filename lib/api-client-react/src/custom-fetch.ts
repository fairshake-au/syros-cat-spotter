export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  /**
   * SYC-211: abort the request (and its body read) after this many ms.
   * Overrides the per-route default below; 0 or a negative value disables it.
   */
  timeoutMs?: number;
};

/**
 * SYC-211: transport timeout for the username claim, read and availability
 * calls. React Native's Android fetch (OkHttp) has no connect/read timeout at
 * all, so a stalled connection never settles. These calls are small JSON
 * requests, so a hard limit is safe. It is scoped to these routes on purpose:
 * a global default could cut off photo uploads on slow links.
 *
 * The UI's own, shorter waits (lib/usernameClaim.ts) only stop the screen
 * waiting; this is what actually ends the request.
 */
export const USERNAME_REQUEST_TIMEOUT_MS = 30_000;
const USERNAME_ROUTE = /\/api\/profiles\/(?:username-availability|[^/?#]+\/username)(?:[?#]|$)/;

function defaultTimeoutMs(url: string): number | undefined {
  return USERNAME_ROUTE.test(url) ? USERNAME_REQUEST_TIMEOUT_MS : undefined;
}

/** Thrown when a request is abandoned by its transport timeout. No HTTP status: the outcome is unknown. */
export class RequestTimeoutError extends Error {
  readonly name = "RequestTimeoutError";
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    Object.setPrototypeOf(this, new.target.prototype);
    this.timeoutMs = timeoutMs;
  }
}

/** An AbortSignal that fires on the caller's signal or after `ms`, without AbortSignal.any (missing on Hermes). */
function withTimeoutSignal(callerSignal: AbortSignal | null | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  else callerSignal?.addEventListener("abort", onCallerAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

let _deviceSecretGetter: AuthTokenGetter | null = null;

/**
 * Register a getter that supplies the device's private secret. Before every
 * fetch the getter is invoked; when it returns a non-null string, an
 * `X-Device-Secret` header is attached to the request. The API uses it to
 * verify ownership of the device id on owner-only endpoints.
 *
 * Pass `null` to clear the getter.
 */
export function setDeviceSecretGetter(getter: AuthTokenGetter | null): void {
  _deviceSecretGetter = getter;
}

let _deviceMovedListener: (() => void) | null = null;

/**
 * SYC-3: called whenever the API answers `403 {"error":"device_moved"}`: this
 * phone's spotter was moved to a new phone with "Get your spots back", and the
 * secret it holds no longer works. The app shows "Your spots moved to a new
 * phone" and stops sending. The request still fails as usual.
 *
 * Pass `null` to clear it.
 */
export function setDeviceMovedListener(listener: (() => void) | null): void {
  _deviceMovedListener = listener;
}

/** True for the API's `device_moved` refusal (SYC-3). */
export function isDeviceMovedError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const data = error.data as { error?: unknown } | null;
  return data?.error === "device_moved";
}

let _prelaunchKey: string | null = null;

/**
 * SYC-113: set the pre-launch tester key built into TestFlight and Play test
 * builds. When set, every request carries `X-Prelaunch-Key` unless that
 * header was explicitly provided. The web build never sets it (the website
 * uses its password cookie instead).
 *
 * Pass `null` to clear it.
 */
export function setPrelaunchKey(key: string | null): void {
  _prelaunchKey = key ? key : null;
}

/**
 * True for a relative path (same origin; "//host" is another site, so no) or
 * a URL under the configured base URL (the app sets it to apiOrigin()).
 */
function isOurApi(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return _baseUrl !== null && url.startsWith(`${_baseUrl}/`);
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, timeoutMs: explicitTimeoutMs, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  // Attach the device secret when a getter is configured and the header
  // has not been explicitly provided.
  if (_deviceSecretGetter && !headers.has("x-device-secret")) {
    const secret = await _deviceSecretGetter();
    if (secret) {
      headers.set("x-device-secret", secret);
    }
  }

  // SYC-113: the tester key, unless the header was explicitly provided, and
  // only to our own API (the same rule as photoSource in the app).
  if (_prelaunchKey && !headers.has("x-prelaunch-key") && isOurApi(resolveUrl(input))) {
    headers.set("x-prelaunch-key", _prelaunchKey);
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const timeoutMs = explicitTimeoutMs ?? defaultTimeoutMs(requestInfo.url);
  if (!timeoutMs || timeoutMs <= 0) {
    return send<T>(input, { ...init, method, headers }, responseType, requestInfo);
  }

  const timeout = withTimeoutSignal(init.signal, timeoutMs);
  try {
    // Race as well as abort: a runtime that ignores the signal (or stalls
    // reading the body) must still settle.
    return await Promise.race([
      send<T>(input, { ...init, method, headers, signal: timeout.signal }, responseType, requestInfo),
      new Promise<never>((_, reject) => {
        timeout.signal.addEventListener("abort", () => reject(timeout.signal.reason));
      }),
    ]);
  } catch (error) {
    if (timeout.timedOut()) throw new RequestTimeoutError(requestInfo.url, timeoutMs);
    throw error;
  } finally {
    timeout.dispose();
  }
}

async function send<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    const errorData = await parseErrorBody(response, requestInfo.method);
    const error = new ApiError(response, errorData, requestInfo);
    if (_deviceMovedListener && isDeviceMovedError(error)) _deviceMovedListener();
    throw error;
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
