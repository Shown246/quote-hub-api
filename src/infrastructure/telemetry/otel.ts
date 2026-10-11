import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import type { SpanProcessor, ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";
import type { Context } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { logger } from "../logging/logger";

const SENSITIVE_KEY_REGEX = /(password|token|authorization|cookie|secret|api[-_]?key|bearer|credential)/i;
const BEARER_TOKEN_REGEX = /bearer\s+[^\s,;"]+/gi;
const QUERY_SENSITIVE_REGEX = /(password|token|secret|api[-_]?key)=([^&\s]+)/gi;

/**
 * Redacts sensitive credentials, tokens, and authorization info from span attributes.
 */
export function sanitizeSpanAttributes(attributes?: Record<string, unknown> | null): void {
  if (!attributes || typeof attributes !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      attributes[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      let sanitized = value;
      sanitized = sanitized.replace(BEARER_TOKEN_REGEX, "Bearer [REDACTED]");
      sanitized = sanitized.replace(QUERY_SENSITIVE_REGEX, "$1=[REDACTED]");
      attributes[key] = sanitized;
    }
  }
}

/**
 * SpanProcessor that ensures sensitive data (passwords, tokens, authorization headers)
 * is not captured in spans before downstream processors/exporters handle them.
 */
export class SensitiveDataFilterSpanProcessor implements SpanProcessor {
  constructor(private readonly downstreamProcessor?: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    if (this.downstreamProcessor) {
      this.downstreamProcessor.onStart(span, parentContext);
    }
  }

  onEnd(span: ReadableSpan): void {
    if (span.attributes) {
      sanitizeSpanAttributes(span.attributes as Record<string, unknown>);
    }

    if (span.events && Array.isArray(span.events)) {
      for (const event of span.events) {
        if (event.attributes) {
          sanitizeSpanAttributes(event.attributes as Record<string, unknown>);
        }
      }
    }

    if (this.downstreamProcessor) {
      this.downstreamProcessor.onEnd(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.downstreamProcessor ? this.downstreamProcessor.forceFlush() : Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.downstreamProcessor ? this.downstreamProcessor.shutdown() : Promise.resolve();
  }
}

let sdkInstance: NodeSDK | null = null;
let isInitialized = false;

/**
 * Resolves configured OTLP traces exporter endpoint, if any.
 */
export function getOtlpTraceEndpoint(): string | null {
  if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "");
    return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
  }
  return null;
}

/**
 * Creates auto and third-party instrumentations including Prisma.
 */
export function createInstrumentations() {
  return [
    getNodeAutoInstrumentations({
      // Disable noisy non-critical instrumentations
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
    }),
    new PrismaInstrumentation(),
  ];
}

/**
 * Builds span processors list based on environment and collector configuration.
 */
function createSpanProcessors(): SpanProcessor[] {
  const isTest = process.env.NODE_ENV === "test";
  const otlpEndpoint = getOtlpTraceEndpoint();

  // In test environments or when no collector endpoint is set, avoid external network exports
  if (isTest || !otlpEndpoint) {
    return [new SensitiveDataFilterSpanProcessor()];
  }

  const exporter = new OTLPTraceExporter({ url: otlpEndpoint });
  const batchProcessor = new tracing.BatchSpanProcessor(exporter);
  return [new SensitiveDataFilterSpanProcessor(batchProcessor)];
}

/**
 * Initializes OpenTelemetry NodeSDK with auto-instrumentations,
 * batch span processor, and sensitive data filtering.
 */
export async function initTelemetry(): Promise<void> {
  if (isInitialized) {
    logger.warn("OpenTelemetry SDK is already initialized");
    return;
  }

  try {
    const spanProcessors = createSpanProcessors();
    const isTest = process.env.NODE_ENV === "test";
    const otlpEndpoint = getOtlpTraceEndpoint();

    sdkInstance = new NodeSDK({
      instrumentations: createInstrumentations(),
      spanProcessors,
      // In test or when no exporter endpoint is configured, avoid default network metric/log exports
      ...(isTest || !otlpEndpoint
        ? {
            metricReaders: [],
            logRecordProcessors: [],
          }
        : {}),
    });

    sdkInstance.start();
    isInitialized = true;
    logger.info("OpenTelemetry SDK initialized");
  } catch (err) {
    logger.error({ err }, "Failed to initialize OpenTelemetry SDK");
    throw err;
  }
}

/**
 * Gracefully shuts down OpenTelemetry SDK and flushes pending spans.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!isInitialized || !sdkInstance) {
    return;
  }

  try {
    await sdkInstance.shutdown();
    logger.info("OpenTelemetry SDK shut down successfully");
  } catch (err) {
    logger.error({ err }, "Error shutting down OpenTelemetry SDK");
    throw err;
  } finally {
    sdkInstance = null;
    isInitialized = false;
  }
}
