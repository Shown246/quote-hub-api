import * as Sentry from "@sentry/node";
import type { Express, Request } from "express";
import { env } from "../../app/config/env";
import { logger } from "./logger";

const SENSITIVE_KEY_REGEX =
  /(password|token|authorization|cookie|secret|api[-_]?key|bearer|credential|session)/i;
const BEARER_TOKEN_REGEX = /bearer\s+[^\s,;"&]+/gi;
const QUERY_SENSITIVE_REGEX =
  /(password|token|secret|api[-_]?key|session)=([^&\s]+)/gi;

/**
 * Sanitizes sensitive tokens, passwords, and secrets from a string value.
 */
export function sanitizeString(val: string): string {
  let sanitized = val.replace(BEARER_TOKEN_REGEX, "Bearer [REDACTED]");
  sanitized = sanitized.replace(QUERY_SENSITIVE_REGEX, "$1=[REDACTED]");
  return sanitized;
}

/**
 * Recursively scrubs sensitive keys and values from objects, arrays, and JSON strings.
 */
export function scrubValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === "string") {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(val);
        const scrubbed = scrubValue(parsed);
        return JSON.stringify(scrubbed);
      } catch {
        // Fall back to string sanitization
      }
    }
    return sanitizeString(val);
  }

  if (Array.isArray(val)) {
    return val.map((item) => scrubValue(item));
  }

  if (typeof val === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = scrubValue(value);
      }
    }
    return result;
  }

  return val;
}

/**
 * Scrubs sensitive data (passwords, tokens, cookies, auth headers, API keys)
 * from a Sentry event before transmission.
 */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  if (!event) {
    return event;
  }

  // 1. Scrub event.request.headers
  if (event.request?.headers) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.request.headers)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        headers[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        headers[key] = sanitizeString(value);
      } else {
        headers[key] = value as string;
      }
    }
    event.request.headers = headers;
  }

  // 2. Scrub event.request.cookies
  if (event.request?.cookies) {
    if (typeof event.request.cookies === "object" && event.request.cookies !== null) {
      const cookies: Record<string, string> = {};
      for (const key of Object.keys(event.request.cookies)) {
        cookies[key] = "[REDACTED]";
      }
      event.request.cookies = cookies;
    } else if (typeof (event.request as { cookies?: unknown }).cookies === "string") {
      (event.request as { cookies?: unknown }).cookies = "[REDACTED]";
    }
  }

  // 3. Scrub event.request.data (payload/body)
  if (event.request && "data" in event.request && event.request.data !== undefined) {
    event.request.data = scrubValue(event.request.data);
  }

  // 4. Scrub event.breadcrumbs
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => {
      const breadcrumb = { ...b };
      if (breadcrumb.data && typeof breadcrumb.data === "object") {
        breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
      }
      if (typeof breadcrumb.message === "string") {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      return breadcrumb;
    });
  }

  // 5. Scrub event.extra
  if (event.extra && typeof event.extra === "object") {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  // 6. Scrub event.request.url and query_string if present
  if (typeof event.request?.url === "string") {
    event.request.url = sanitizeString(event.request.url);
  }
  if (typeof event.request?.query_string === "string") {
    event.request.query_string = sanitizeString(event.request.query_string);
  }

  // 7. Scrub event.exception.values
  if (event.exception?.values) {
    for (const val of event.exception.values) {
      if (val.value) {
        val.value = sanitizeString(val.value);
      }
    }
  }

  return event;
}

let isInitialized = false;

/**
 * Returns whether Sentry has been initialized in this process.
 */
export function isSentryInitialized(): boolean {
  return isInitialized;
}

/**
 * Initializes Sentry if SENTRY_DSN is configured.
 * Safely no-ops if SENTRY_DSN is unset.
 */
export function initSentry(_app?: Express): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  if (isInitialized) {
    return;
  }

  try {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      beforeSend(event) {
        return scrubEvent(event);
      },
    });
    isInitialized = true;
    logger.info("Sentry error tracking initialized");
  } catch (err) {
    logger.error({ err }, "Failed to initialize Sentry");
    throw err;
  }
}

/**
 * Shuts down Sentry and resets initialization state (primarily for tests).
 */
export async function closeSentry(): Promise<void> {
  if (isInitialized) {
    await Sentry.close();
    isInitialized = false;
  }
}

/**
 * Helper to extract requestId from request headers or request id property.
 */
function extractRequestId(req?: Request): string | undefined {
  if (!req) {
    return undefined;
  }

  const rawHeader = req.headers?.["x-request-id"];
  const headerId =
    typeof rawHeader === "string"
      ? rawHeader
      : Array.isArray(rawHeader)
        ? rawHeader[0]
        : undefined;

  const rawReqId = (req as { id?: unknown })?.id;
  const reqId = typeof rawReqId === "string" ? rawReqId : undefined;
  return headerId || reqId || undefined;
}

/**
 * Captures an exception with correlated request context and requestId tag.
 * Safely no-ops if SENTRY_DSN is not configured.
 */
export function captureExceptionWithContext(err: unknown, req?: Request): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  try {
    const requestId = extractRequestId(req);

    Sentry.withScope((scope) => {
      if (requestId) {
        scope.setTag("requestId", requestId);
      }
      if (req) {
        if (req.method) {
          scope.setExtra("method", req.method);
        }
        const url = req.originalUrl || req.url;
        if (url) {
          scope.setExtra("url", url);
        }
      }
      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    logger.warn({ sentryErr }, "Failed to capture exception in Sentry");
  }
}
