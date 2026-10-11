import { describe, it, expect, vi } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { errorHandler } from "../../../src/middleware/error-handler";
import {
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors/problem-details";
import * as sentryModule from "../../../src/infrastructure/logging/sentry";

describe("errorHandler middleware", () => {
  it("should serialize NotFoundError to 404 application/problem+json", async () => {
    const app = express();
    app.get("/test", () => {
      throw new NotFoundError("Quote not found");
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.code).toBe("NOT_FOUND");
    expect(res.body.title).toBe("Resource not found");
  });

  it("should serialize ValidationError with errors map to 400", async () => {
    const app = express();
    app.get("/test", () => {
      throw new ValidationError({
        content: ["Content is required"],
        author: ["Author must be at least 2 characters"],
      });
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.title).toBe("Validation failed");
    expect(res.body.errors).toEqual({
      content: ["Content is required"],
      author: ["Author must be at least 2 characters"],
    });
  });

  it("should serialize unexpected Error to 500 without leaking message or stack", async () => {
    const app = express();
    app.get("/test", () => {
      throw new Error("Sensitive database connection failure at db.internal:5432");
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(res.body.title).toBe("Internal server error");
    expect(res.body.detail).toBe("An unexpected internal error occurred.");
    expect(res.body.detail).not.toContain("Sensitive database");
    expect(res.body.stack).toBeUndefined();
  });

  it("should extract requestId from x-request-id header", async () => {
    const app = express();
    app.get("/test", () => {
      throw new NotFoundError("Quote not found");
    });
    app.use(errorHandler);

    const res = await request(app)
      .get("/test")
      .set("x-request-id", "req-test-uuidv7");

    expect(res.status).toBe(404);
    expect(res.body.instance).toBe("req-test-uuidv7");
  });

  it("should extract requestId from (req as any).id if x-request-id header is absent", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { id: string }).id = "req-from-pino-id";
      next();
    });
    app.get("/test", () => {
      throw new NotFoundError("Quote not found");
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(404);
    expect(res.body.instance).toBe("req-from-pino-id");
  });

  it("should extract requestId from first item if x-request-id is an array", async () => {
    const mockReq = {
      headers: { "x-request-id": ["req-first", "req-second"] },
    } as unknown as Request;
    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      headersSent: false,
    } as unknown as Response;
    const mockNext = vi.fn();

    errorHandler(new NotFoundError(), mockReq, mockRes, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/problem+json"
    );
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        instance: "req-first",
      })
    );
  });

  it("should log 500 server errors via req.log if logger exists", async () => {
    const logError = vi.fn();
    const app = express();
    const serverError = new Error("Database dead");
    app.use((req, _res, next) => {
      (req as unknown as { log: { error: typeof logError } }).log = {
        error: logError,
      };
      next();
    });
    app.get("/test", () => {
      throw serverError;
    });
    app.use(errorHandler);

    const res = await request(app).get("/test").set("x-request-id", "req-log-1");
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      { err: serverError, requestId: "req-log-1" },
      "Unhandled server error"
    );
  });

  it("should not log 4xx client errors via req.log", async () => {
    const logError = vi.fn();
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { log: { error: typeof logError } }).log = {
        error: logError,
      };
      next();
    });
    app.get("/test", () => {
      throw new NotFoundError("Not found");
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("should fallback to req.logger if req.log is undefined for 500 errors", async () => {
    const logError = vi.fn();
    const app = express();
    const serverError = new Error("Fatal system failure");
    app.use((req, _res, next) => {
      (req as unknown as { logger: { error: typeof logError } }).logger = {
        error: logError,
      };
      next();
    });
    app.get("/test", () => {
      throw serverError;
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("should handle cleanly without throwing if logger.error throws", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { log: { error: () => void } }).log = {
        error: () => {
          throw new Error("Logger write stream closed");
        },
      };
      next();
    });
    app.get("/test", () => {
      throw new Error("Internal crash");
    });
    app.use(errorHandler);

    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("should delegate to next(err) if res.headersSent is true", () => {
    const mockReq = { headers: {} } as unknown as Request;
    const mockRes = {
      headersSent: true,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const mockNext = vi.fn();
    const testErr = new Error("Late error after headers");

    errorHandler(testErr, mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(testErr);
    expect(mockRes.setHeader).not.toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.json).not.toHaveBeenCalled();
  });

  describe("Sentry integration", () => {
    it("should call captureExceptionWithContext on 500 errors", async () => {
      const captureSpy = vi.spyOn(sentryModule, "captureExceptionWithContext").mockImplementation(() => {});
      const app = express();
      const serverErr = new Error("Database dead");
      app.get("/test", () => {
        throw serverErr;
      });
      app.use(errorHandler);

      const res = await request(app).get("/test");
      expect(res.status).toBe(500);
      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(captureSpy).toHaveBeenCalledWith(serverErr, expect.anything());

      captureSpy.mockRestore();
    });

    it("should not call captureExceptionWithContext on 4xx client errors", async () => {
      const captureSpy = vi.spyOn(sentryModule, "captureExceptionWithContext").mockImplementation(() => {});
      const app = express();
      app.get("/test", () => {
        throw new NotFoundError("Quote not found");
      });
      app.use(errorHandler);

      const res = await request(app).get("/test");
      expect(res.status).toBe(404);
      expect(captureSpy).not.toHaveBeenCalled();

      captureSpy.mockRestore();
    });

    it("should handle gracefully when captureExceptionWithContext throws", async () => {
      const captureSpy = vi.spyOn(sentryModule, "captureExceptionWithContext").mockImplementation(() => {
        throw new Error("Sentry transport failure");
      });
      const app = express();
      app.get("/test", () => {
        throw new Error("Server failure");
      });
      app.use(errorHandler);

      const res = await request(app).get("/test");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");

      captureSpy.mockRestore();
    });
  });
});
