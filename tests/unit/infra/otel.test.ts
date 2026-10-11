import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initTelemetry,
  shutdownTelemetry,
  SensitiveDataFilterSpanProcessor,
  sanitizeSpanAttributes,
  createInstrumentations,
  getOtlpTraceEndpoint,
} from "../../../src/infrastructure/telemetry/otel";
import { tracing } from "@opentelemetry/sdk-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { PrismaInstrumentation } from "@prisma/instrumentation";

describe("OpenTelemetry Instrumentation", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    await shutdownTelemetry();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await shutdownTelemetry();
  });

  describe("Lifecycle", () => {
    it("should initialize and shutdown telemetry without errors", async () => {
      await expect(initTelemetry()).resolves.toBeUndefined();
      await expect(shutdownTelemetry()).resolves.toBeUndefined();
    });

    it("should safely handle consecutive calls to initTelemetry", async () => {
      await expect(initTelemetry()).resolves.toBeUndefined();
      await expect(initTelemetry()).resolves.toBeUndefined();
      await expect(shutdownTelemetry()).resolves.toBeUndefined();
    });

    it("should safely handle consecutive calls to shutdownTelemetry", async () => {
      await expect(shutdownTelemetry()).resolves.toBeUndefined();
      await expect(shutdownTelemetry()).resolves.toBeUndefined();
    });

    it("should allow re-initializing after shutdown", async () => {
      await expect(initTelemetry()).resolves.toBeUndefined();
      await expect(shutdownTelemetry()).resolves.toBeUndefined();
      await expect(initTelemetry()).resolves.toBeUndefined();
      await expect(shutdownTelemetry()).resolves.toBeUndefined();
    });
  });

  describe("Sensitive Data Redaction", () => {
    it("should redact sensitive keys in span attributes", () => {
      const attributes: Record<string, any> = {
        "user.password": "super-secret-password",
        "auth.token": "jwt-token-value",
        "authorization": "Bearer secret-token",
        "req.headers.authorization": "Bearer test-token",
        "req.headers.cookie": "session_id=12345",
        "cookie": "connect.sid=xyz",
        "apiKey": "api-key-123",
        "api_secret": "my-secret",
        "normal.attribute": "safe-value",
        "http.status_code": 200,
      };

      sanitizeSpanAttributes(attributes);

      expect(attributes["user.password"]).toBe("[REDACTED]");
      expect(attributes["auth.token"]).toBe("[REDACTED]");
      expect(attributes["authorization"]).toBe("[REDACTED]");
      expect(attributes["req.headers.authorization"]).toBe("[REDACTED]");
      expect(attributes["req.headers.cookie"]).toBe("[REDACTED]");
      expect(attributes["cookie"]).toBe("[REDACTED]");
      expect(attributes["apiKey"]).toBe("[REDACTED]");
      expect(attributes["api_secret"]).toBe("[REDACTED]");
      expect(attributes["normal.attribute"]).toBe("safe-value");
      expect(attributes["http.status_code"]).toBe(200);
    });

    it("should redact Bearer tokens and sensitive query parameters in string values", () => {
      const attributes: Record<string, any> = {
        "http.url": "https://api.quotehub.com/v1/auth/callback?token=secret123&code=456",
        "http.target": "/quotes?password=mypassword&limit=10",
        "custom.log": "User requested with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "http.route": "/api/v1/quotes",
      };

      sanitizeSpanAttributes(attributes);

      expect(attributes["http.url"]).toContain("token=[REDACTED]");
      expect(attributes["http.url"]).toContain("code=456");
      expect(attributes["http.target"]).toContain("password=[REDACTED]");
      expect(attributes["http.target"]).toContain("limit=10");
      expect(attributes["custom.log"]).toBe("User requested with Bearer [REDACTED]");
      expect(attributes["http.route"]).toBe("/api/v1/quotes");
    });

    it("should completely redact Bearer tokens containing Base64 characters (+, /, =)", () => {
      const attributes: Record<string, any> = {
        "header.auth": "Bearer abc+def/ghi==123",
        "header.auth.quoted": "\"Bearer secret+token/with/slashes==\"",
        "header.auth.csv": "Bearer abc+123/xyz==, next-token",
      };

      sanitizeSpanAttributes(attributes);

      expect(attributes["header.auth"]).toBe("Bearer [REDACTED]");
      expect(attributes["header.auth.quoted"]).toBe("\"Bearer [REDACTED]\"");
      expect(attributes["header.auth.csv"]).toBe("Bearer [REDACTED], next-token");
    });

    it("should sanitize span attributes in SensitiveDataFilterSpanProcessor onEnd", () => {
      const memoryExporter = new tracing.InMemorySpanExporter();
      const simpleProcessor = new tracing.SimpleSpanProcessor(memoryExporter);
      const filteringProcessor = new SensitiveDataFilterSpanProcessor(simpleProcessor);

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceFlags: 1 }),
        attributes: {
          "password": "secret",
          "service.name": "quote-hub-api",
        },
        events: [
          {
            name: "exception",
            attributes: {
              "auth.token": "token-in-event",
              "error.message": "Something happened",
            },
          },
        ],
      } as unknown as ReadableSpan;

      filteringProcessor.onEnd(mockSpan);

      expect(mockSpan.attributes["password"]).toBe("[REDACTED]");
      expect(mockSpan.attributes["service.name"]).toBe("quote-hub-api");
      expect(mockSpan.events[0].attributes?.["auth.token"]).toBe("[REDACTED]");
      expect(mockSpan.events[0].attributes?.["error.message"]).toBe("Something happened");
    });
  });

  describe("Configuration & Instrumentations", () => {
    it("should include PrismaInstrumentation alongside auto-instrumentations", () => {
      const instrumentations = createInstrumentations().flat();
      const hasPrisma = instrumentations.some(
        (inst) => inst instanceof PrismaInstrumentation || inst.instrumentationName === "@prisma/instrumentation"
      );
      expect(hasPrisma).toBe(true);
    });

    it("should resolve OTLP endpoint and prevent duplicate /v1/traces", () => {
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      expect(getOtlpTraceEndpoint()).toBeNull();

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
      expect(getOtlpTraceEndpoint()).toBe("http://collector:4318/v1/traces");

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318/v1/traces";
      expect(getOtlpTraceEndpoint()).toBe("http://collector:4318/v1/traces");

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318/v1/traces/";
      expect(getOtlpTraceEndpoint()).toBe("http://collector:4318/v1/traces");

      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://custom-traces:4318/custom";
      expect(getOtlpTraceEndpoint()).toBe("http://custom-traces:4318/custom");
    });
  });
});
