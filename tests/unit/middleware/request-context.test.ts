import { describe, it, expect, vi } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { requestContextMiddleware } from "../../../src/middleware/request-context";
import { isValidUuidV7 } from "../../../src/shared/utils/uuidv7";
import {
  logger,
  createLogger,
  REDACTED_KEYS,
} from "../../../src/infrastructure/logging/logger";

describe("requestContextMiddleware", () => {
  it("should assign and return x-request-id header", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get("/ping", (req, res) => res.json({ id: req.id }));

    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.body.id).toBe(res.headers["x-request-id"]);
  });

  it("should generate a valid UUIDv7 when x-request-id header is missing", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get("/test", (req, res) => {
      res.json({ id: req.id });
    });

    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    const id = res.headers["x-request-id"];
    expect(id).toBeDefined();
    expect(isValidUuidV7(id)).toBe(true);
    expect(res.body.id).toBe(id);
  });

  it("should preserve client-supplied x-request-id header", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get("/test", (req, res) => {
      res.json({ id: req.id });
    });

    const customId = "client-trace-id-12345";
    const res = await request(app).get("/test").set("x-request-id", customId);
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe(customId);
    expect(res.body.id).toBe(customId);
  });

  it("should generate a new UUIDv7 if client-supplied x-request-id is empty or whitespace", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get("/test", (req, res) => {
      res.json({ id: req.id });
    });

    const res = await request(app).get("/test").set("x-request-id", "   ");
    expect(res.status).toBe(200);
    const id = res.headers["x-request-id"];
    expect(id).toBeDefined();
    expect(isValidUuidV7(id)).toBe(true);
    expect(res.body.id).toBe(id);
  });

  it("should use first item if x-request-id header is an array of strings", () => {
    const req = {
      headers: {
        "x-request-id": ["req-first-123", "req-second-456"],
      },
    } as unknown as Request;

    const setHeaderMock = vi.fn();
    const res = {
      setHeader: setHeaderMock,
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    requestContextMiddleware(req, res, next);

    expect(req.id).toBe("req-first-123");
    expect(setHeaderMock).toHaveBeenCalledWith("x-request-id", "req-first-123");
    expect(req.log).toBeDefined();
    expect(req.log.bindings().requestId).toBe("req-first-123");
    expect(next).toHaveBeenCalledOnce();
  });

  it("should generate new UUIDv7 if first item in array header is whitespace", () => {
    const req = {
      headers: {
        "x-request-id": ["   ", "req-second-456"],
      },
    } as unknown as Request;

    const setHeaderMock = vi.fn();
    const res = {
      setHeader: setHeaderMock,
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    requestContextMiddleware(req, res, next);

    expect(isValidUuidV7(req.id)).toBe(true);
    expect(setHeaderMock).toHaveBeenCalledWith("x-request-id", req.id);
    expect(req.log.bindings().requestId).toBe(req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it("should attach child logger to req.log with requestId binding", async () => {
    const app = express();
    app.use(requestContextMiddleware);

    let childLoggerBindings: Record<string, unknown> | undefined;
    let hasLogMethods = false;

    app.get("/test", (req, res) => {
      if (req.log && typeof req.log.info === "function") {
        hasLogMethods = true;
        childLoggerBindings = req.log.bindings();
      }
      res.sendStatus(200);
    });

    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(hasLogMethods).toBe(true);
    expect(childLoggerBindings?.requestId).toBe(res.headers["x-request-id"]);
  });

  it("should call next() and proceed through middleware pipeline", async () => {
    const app = express();
    const probe = vi.fn();

    app.use(requestContextMiddleware);
    app.use((req, res, next) => {
      probe();
      next();
    });
    app.get("/test", (req, res) => res.sendStatus(204));

    const res = await request(app).get("/test");
    expect(res.status).toBe(204);
    expect(probe).toHaveBeenCalledOnce();
  });
});

describe("logger infrastructure", () => {
  it("should have logger instance exported with standard log levels", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("should have default log level silent in test environment", () => {
    expect(logger.level).toBe("silent");
  });

  it("should redact sensitive fields", () => {
    let output = "";
    const mockStream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    };

    const testLogger = createLogger({ level: "info" }, mockStream);
    testLogger.info({
      password: "super-secret-password",
      authorization: "Bearer secret-token",
      cookie: "session=xyz123",
      token: "jwt-token-val",
      user: {
        password: "nested-password",
        token: "nested-token",
      },
      safeField: "safe-value",
    });

    const parsed = JSON.parse(output);
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.authorization).toBe("[REDACTED]");
    expect(parsed.cookie).toBe("[REDACTED]");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.user.password).toBe("[REDACTED]");
    expect(parsed.user.token).toBe("[REDACTED]");
    expect(parsed.safeField).toBe("safe-value");
  });

  it("should include standard redacted keys in REDACTED_KEYS list", () => {
    expect(REDACTED_KEYS).toContain("password");
    expect(REDACTED_KEYS).toContain("authorization");
    expect(REDACTED_KEYS).toContain("cookie");
    expect(REDACTED_KEYS).toContain("token");
    expect(REDACTED_KEYS).toContain("*.password");
  });
});
