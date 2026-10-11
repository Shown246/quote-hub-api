import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/node";
import type { Request } from "express";
import {
  initSentry,
  captureExceptionWithContext,
  scrubEvent,
  sanitizeString,
  scrubValue,
  closeSentry,
  isSentryInitialized,
} from "../../../src/infrastructure/logging/sentry";
import { env } from "../../../src/app/config/env";

vi.mock("@sentry/node", () => {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((cb: (scope: any) => void) => {
      const scope = {
        setTag: vi.fn(),
        setExtra: vi.fn(),
      };
      cb(scope);
      return scope;
    }),
    close: vi.fn().mockResolvedValue(true),
  };
});

describe("Sentry Integration", () => {
  const originalDsn = env.SENTRY_DSN;

  beforeEach(async () => {
    await closeSentry();
    vi.clearAllMocks();
    (env as any).SENTRY_DSN = undefined;
  });

  afterEach(async () => {
    await closeSentry();
    vi.clearAllMocks();
    (env as any).SENTRY_DSN = originalDsn;
  });

  describe("Module Exports", () => {
    it("should export initSentry function", () => {
      expect(typeof initSentry).toBe("function");
    });

    it("should export captureExceptionWithContext function", () => {
      expect(typeof captureExceptionWithContext).toBe("function");
    });

    it("should export scrubEvent function", () => {
      expect(typeof scrubEvent).toBe("function");
    });
  });

  describe("No-op Behavior when SENTRY_DSN is unset", () => {
    it("should safely no-op in initSentry when SENTRY_DSN is unset", () => {
      expect(() => initSentry()).not.toThrow();
      expect(Sentry.init).not.toHaveBeenCalled();
      expect(isSentryInitialized()).toBe(false);
    });

    it("should safely no-op in captureExceptionWithContext when SENTRY_DSN is unset", () => {
      const mockReq = {
        headers: { "x-request-id": "req-123" },
      } as unknown as Request;

      expect(() =>
        captureExceptionWithContext(new Error("Test error"), mockReq)
      ).not.toThrow();
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.withScope).not.toHaveBeenCalled();
    });

    it("should safely no-op when called without request object", () => {
      expect(() =>
        captureExceptionWithContext(new Error("No request error"))
      ).not.toThrow();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe("Active Behavior when SENTRY_DSN is configured", () => {
    const testDsn = "https://public@sentry.example.com/123";

    beforeEach(() => {
      (env as any).SENTRY_DSN = testDsn;
    });

    it("should initialize Sentry with DSN and beforeSend hook", () => {
      initSentry();

      expect(Sentry.init).toHaveBeenCalledTimes(1);
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: testDsn,
          environment: env.NODE_ENV,
          beforeSend: expect.any(Function),
        })
      );
      expect(isSentryInitialized()).toBe(true);
    });

    it("should be idempotent and not re-initialize if called multiple times", () => {
      initSentry();
      initSentry();

      expect(Sentry.init).toHaveBeenCalledTimes(1);
    });

    it("should capture exception with requestId tag from x-request-id header", () => {
      let capturedScope: any;
      vi.mocked(Sentry.withScope).mockImplementationOnce((cb: (scope: any) => void) => {
        const scope = {
          setTag: vi.fn(),
          setExtra: vi.fn(),
        };
        capturedScope = scope;
        cb(scope);
        return scope;
      });

      const mockReq = {
        headers: { "x-request-id": "req-header-xyz" },
        method: "GET",
        originalUrl: "/api/v1/quotes",
      } as unknown as Request;

      const testError = new Error("Database timeout");
      captureExceptionWithContext(testError, mockReq);

      expect(capturedScope.setTag).toHaveBeenCalledWith("requestId", "req-header-xyz");
      expect(capturedScope.setExtra).toHaveBeenCalledWith("method", "GET");
      expect(capturedScope.setExtra).toHaveBeenCalledWith("url", "/api/v1/quotes");
      expect(Sentry.captureException).toHaveBeenCalledWith(testError);
    });

    it("should extract requestId from (req as any).id when header is missing", () => {
      let capturedScope: any;
      vi.mocked(Sentry.withScope).mockImplementationOnce((cb: (scope: any) => void) => {
        const scope = {
          setTag: vi.fn(),
          setExtra: vi.fn(),
        };
        capturedScope = scope;
        cb(scope);
        return scope;
      });

      const mockReq = {
        headers: {},
        id: "pino-req-id-789",
        method: "POST",
        url: "/api/v1/themes",
      } as unknown as Request;

      captureExceptionWithContext(new Error("Server error"), mockReq);

      expect(capturedScope.setTag).toHaveBeenCalledWith("requestId", "pino-req-id-789");
      expect(capturedScope.setExtra).toHaveBeenCalledWith("method", "POST");
      expect(capturedScope.setExtra).toHaveBeenCalledWith("url", "/api/v1/themes");
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it("should extract requestId from first element if x-request-id is an array", () => {
      let capturedScope: any;
      vi.mocked(Sentry.withScope).mockImplementationOnce((cb: (scope: any) => void) => {
        const scope = {
          setTag: vi.fn(),
          setExtra: vi.fn(),
        };
        capturedScope = scope;
        cb(scope);
        return scope;
      });

      const mockReq = {
        headers: { "x-request-id": ["req-array-1", "req-array-2"] },
      } as unknown as Request;

      captureExceptionWithContext(new Error("Array header error"), mockReq);

      expect(capturedScope.setTag).toHaveBeenCalledWith("requestId", "req-array-1");
    });

    it("should handle error capture when req is undefined", () => {
      let capturedScope: any;
      vi.mocked(Sentry.withScope).mockImplementationOnce((cb: (scope: any) => void) => {
        const scope = {
          setTag: vi.fn(),
          setExtra: vi.fn(),
        };
        capturedScope = scope;
        cb(scope);
        return scope;
      });

      const testError = new Error("Async background error");
      captureExceptionWithContext(testError);

      expect(capturedScope.setTag).not.toHaveBeenCalled();
      expect(Sentry.captureException).toHaveBeenCalledWith(testError);
    });

    it("should safely swallow any error thrown within Sentry.withScope", () => {
      vi.mocked(Sentry.withScope).mockImplementationOnce(() => {
        throw new Error("Sentry transport failure");
      });

      expect(() =>
        captureExceptionWithContext(new Error("Original error"))
      ).not.toThrow();
    });
  });

  describe("Sensitive Data Scrubbing", () => {
    describe("sanitizeString helper", () => {
      it("should redact Bearer tokens and sensitive query params", () => {
        const input = "Authorization: Bearer secret-jwt-token-12345&password=mysecret";
        const result = sanitizeString(input);
        expect(result).toBe("Authorization: Bearer [REDACTED]&password=[REDACTED]");
      });

      it("should leave safe strings untouched", () => {
        const input = "https://example.com/api/v1/quotes?page=1&limit=20";
        expect(sanitizeString(input)).toBe(input);
      });
    });

    describe("scrubValue helper", () => {
      it("should redact sensitive keys in nested objects", () => {
        const payload = {
          user: {
            name: "John Doe",
            password: "supersecretpassword",
            email: "john@example.com",
            api_key: "api-secret-key",
          },
          sessionToken: "session-12345",
          safeField: 42,
        };

        const result = scrubValue(payload) as any;
        expect(result.user.name).toBe("John Doe");
        expect(result.user.password).toBe("[REDACTED]");
        expect(result.user.email).toBe("john@example.com");
        expect(result.user.api_key).toBe("[REDACTED]");
        expect(result.sessionToken).toBe("[REDACTED]");
        expect(result.safeField).toBe(42);
      });

      it("should redact sensitive fields inside arrays", () => {
        const list = [
          { token: "abc" },
          { name: "normal" },
        ];
        const result = scrubValue(list) as any;
        expect(result[0].token).toBe("[REDACTED]");
        expect(result[1].name).toBe("normal");
      });

      it("should parse and redact sensitive fields inside JSON stringified payload", () => {
        const jsonStr = JSON.stringify({
          password: "plain-password",
          credential: "cred-secret",
          title: "Public Quote",
        });

        const result = scrubValue(jsonStr) as string;
        const parsed = JSON.parse(result);
        expect(parsed.password).toBe("[REDACTED]");
        expect(parsed.credential).toBe("[REDACTED]");
        expect(parsed.title).toBe("Public Quote");
      });

      it("should return null/undefined as-is", () => {
        expect(scrubValue(null)).toBeNull();
        expect(scrubValue(undefined)).toBeUndefined();
      });
    });

    describe("scrubEvent", () => {
      it("should scrub sensitive request headers (authorization, cookie, api-key)", () => {
        const event: Sentry.Event = {
          request: {
            headers: {
              authorization: "Bearer sensitive-access-token",
              cookie: "sessionId=secret123; user=alice",
              "x-api-key": "secret-api-key-999",
              "user-agent": "Mozilla/5.0",
              accept: "application/json",
            },
          },
        };

        const scrubbed = scrubEvent(event);
        expect(scrubbed.request?.headers?.authorization).toBe("[REDACTED]");
        expect(scrubbed.request?.headers?.cookie).toBe("[REDACTED]");
        expect(scrubbed.request?.headers?.["x-api-key"]).toBe("[REDACTED]");
        expect(scrubbed.request?.headers?.["user-agent"]).toBe("Mozilla/5.0");
        expect(scrubbed.request?.headers?.accept).toBe("application/json");
      });

      it("should scrub request cookies object and string", () => {
        const eventWithCookieObj: Sentry.Event = {
          request: {
            cookies: {
              session: "session-cookie-val",
              rememberMe: "true",
            },
          },
        };

        const scrubbedObj = scrubEvent(eventWithCookieObj);
        expect(scrubbedObj.request?.cookies).toEqual({
          session: "[REDACTED]",
          rememberMe: "[REDACTED]",
        });

        const eventWithCookieStr: Sentry.Event = {
          request: {
            cookies: "session=xyz123; tracking=456",
          },
        };
        const scrubbedStr = scrubEvent(eventWithCookieStr);
        expect(scrubbedStr.request?.cookies).toBe("[REDACTED]");
      });

      it("should scrub passwords and tokens from request data (body)", () => {
        const event: Sentry.Event = {
          request: {
            data: {
              email: "user@example.com",
              password: "UserPassword123!",
              token: "reset-token-xyz",
              content: "A beautiful quote about life.",
            },
          },
        };

        const scrubbed = scrubEvent(event);
        expect((scrubbed.request?.data as any).email).toBe("user@example.com");
        expect((scrubbed.request?.data as any).password).toBe("[REDACTED]");
        expect((scrubbed.request?.data as any).token).toBe("[REDACTED]");
        expect((scrubbed.request?.data as any).content).toBe("A beautiful quote about life.");
      });

      it("should scrub sensitive data and messages in breadcrumbs", () => {
        const event: Sentry.Event = {
          breadcrumbs: [
            {
              category: "auth",
              message: "User logged in with Bearer sensitive-token-here",
              data: {
                sessionId: "session-token-987",
                userId: "user-1",
              },
            },
            {
              category: "query",
              message: "Executed database query",
              data: {
                table: "quotes",
              },
            },
          ],
        };

        const scrubbed = scrubEvent(event);
        expect(scrubbed.breadcrumbs?.[0].message).toBe(
          "User logged in with Bearer [REDACTED]"
        );
        expect(scrubbed.breadcrumbs?.[0].data?.sessionId).toBe("[REDACTED]");
        expect(scrubbed.breadcrumbs?.[0].data?.userId).toBe("user-1");
        expect(scrubbed.breadcrumbs?.[1].message).toBe("Executed database query");
        expect(scrubbed.breadcrumbs?.[1].data?.table).toBe("quotes");
      });

      it("should scrub sensitive fields in event.extra", () => {
        const event: Sentry.Event = {
          extra: {
            debugInfo: "ok",
            apiKey: "hidden-key",
            nested: {
              secret: "my-secret",
            },
            credential: "my-credential",
          },
        };

        const scrubbed = scrubEvent(event);
        expect(scrubbed.extra?.debugInfo).toBe("ok");
        expect(scrubbed.extra?.apiKey).toBe("[REDACTED]");
        expect((scrubbed.extra?.nested as any).secret).toBe("[REDACTED]");
        expect(scrubbed.extra?.credential).toBe("[REDACTED]");
      });

      it("should sanitize url and query_string if present in request", () => {
        const event: Sentry.Event = {
          request: {
            url: "https://api.quotehub.com/callback?token=secret123&code=456",
            query_string: "token=secret123&code=456",
          },
        };

        const scrubbed = scrubEvent(event);
        expect(scrubbed.request?.url).toBe(
          "https://api.quotehub.com/callback?token=[REDACTED]&code=456"
        );
        expect(scrubbed.request?.query_string).toBe("token=[REDACTED]&code=456");
      });

      it("should sanitize exception messages in event.exception.values", () => {
        const event: Sentry.Event = {
          exception: {
            values: [
              {
                type: "Error",
                value: "Failed authentication for Bearer secret-bearer-token-12345",
              },
              {
                type: "DatabaseError",
                value: "Query failed with password=super-secret-password-123",
              },
            ],
          },
        };

        const scrubbed = scrubEvent(event);
        expect(scrubbed.exception?.values?.[0].value).toBe(
          "Failed authentication for Bearer [REDACTED]"
        );
        expect(scrubbed.exception?.values?.[1].value).toBe(
          "Query failed with password=[REDACTED]"
        );
      });

      it("should handle null or empty event gracefully", () => {
        expect(scrubEvent(null as any)).toBeNull();
        expect(scrubEvent(undefined as any)).toBeUndefined();
      });
    });

    describe("beforeSend integration hook", () => {
      it("should apply scrubEvent when beforeSend hook is invoked", () => {
        (env as any).SENTRY_DSN = "https://public@sentry.example.com/123";
        initSentry();

        expect(Sentry.init).toHaveBeenCalled();
        const initOptions = vi.mocked(Sentry.init).mock.calls[0][0];
        const beforeSendHook = initOptions?.beforeSend;
        expect(beforeSendHook).toBeDefined();

        const rawEvent: Sentry.Event = {
          request: {
            headers: {
              authorization: "Bearer secret-token",
            },
            data: {
              password: "my-password",
            },
          },
        };

        const processed = beforeSendHook!(rawEvent, {} as any);
        expect(processed?.request?.headers?.authorization).toBe("[REDACTED]");
        expect((processed?.request?.data as any).password).toBe("[REDACTED]");
      });
    });
  });
});
