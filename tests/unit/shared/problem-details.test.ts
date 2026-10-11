import { describe, it, expect } from "vitest";
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  toProblemDetails,
} from "../../../src/shared/errors/problem-details";

describe("Problem Details RFC 9457", () => {
  it("should format ValidationError with field errors", () => {
    const err = new ValidationError("Validation failed", {
      text: ["Quote must not exceed 280 characters."],
    });
    const problem = toProblemDetails(err, "req-123");
    expect(problem.status).toBe(400);
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.title).toBe("Validation failed");
    expect(problem.errors?.text).toContain("Quote must not exceed 280 characters.");
    expect(problem.instance).toBe("req-123");
    expect(problem.type).toBe("about:blank");
  });

  it("should format unexpected errors as 500 without leaking stack", () => {
    const err = new Error("Database crashed secret connection string");
    const problem = toProblemDetails(err, "req-456");
    expect(problem.status).toBe(500);
    expect(problem.code).toBe("INTERNAL_SERVER_ERROR");
    expect(problem.title).toBe("Internal server error");
    expect(problem.detail).toBe("An unexpected internal error occurred.");
    expect(problem.detail).not.toContain("secret");
    expect(problem.instance).toBe("req-456");
    expect(problem.type).toBe("about:blank");
  });

  describe("Subclass error defaults and properties", () => {
    it("should create AuthenticationError with status 401 and default properties", () => {
      const err = new AuthenticationError();
      expect(err.status).toBe(401);
      expect(err.code).toBe("AUTHENTICATION_ERROR");
      expect(err.title).toBe("Authentication required");
      expect(err.detail).toBe("Authentication required");
      expect(err.message).toBe("Authentication required");
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(401);
      expect(problem.code).toBe("AUTHENTICATION_ERROR");
      expect(problem.title).toBe("Authentication required");
      expect(problem.instance).toBeUndefined();
    });

    it("should allow AuthenticationError with custom error code", () => {
      const err = new AuthenticationError("Authentication required", "AUTHENTICATION_REQUIRED");
      expect(err.status).toBe(401);
      expect(err.code).toBe("AUTHENTICATION_REQUIRED");
      expect(err.detail).toBe("Authentication required");

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(401);
      expect(problem.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should create AuthorizationError with status 403 and default properties", () => {
      const err = new AuthorizationError("You cannot modify this quote");
      expect(err.status).toBe(403);
      expect(err.code).toBe("AUTHORIZATION_ERROR");
      expect(err.title).toBe("Access denied");
      expect(err.detail).toBe("You cannot modify this quote");
      expect(err).toBeInstanceOf(AppError);

      const problem = toProblemDetails(err, "req-authz");
      expect(problem.status).toBe(403);
      expect(problem.code).toBe("AUTHORIZATION_ERROR");
      expect(problem.title).toBe("Access denied");
      expect(problem.detail).toBe("You cannot modify this quote");
      expect(problem.instance).toBe("req-authz");
    });

    it("should allow AuthorizationError with custom error code", () => {
      const err = new AuthorizationError("Account suspended", "ACCOUNT_SUSPENDED");
      expect(err.status).toBe(403);
      expect(err.code).toBe("ACCOUNT_SUSPENDED");
      expect(err.detail).toBe("Account suspended");

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(403);
      expect(problem.code).toBe("ACCOUNT_SUSPENDED");
    });

    it("should create NotFoundError with status 404 and default title", () => {
      const err = new NotFoundError("Quote not found");
      expect(err.status).toBe(404);
      expect(err.code).toBe("NOT_FOUND");
      expect(err.title).toBe("Resource not found");
      expect(err.detail).toBe("Quote not found");
      expect(err).toBeInstanceOf(AppError);

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(404);
      expect(problem.code).toBe("NOT_FOUND");
      expect(problem.title).toBe("Resource not found");
      expect(problem.detail).toBe("Quote not found");
      expect(problem.instance).toBeUndefined();
    });

    it("should create ConflictError with status 409 and default properties", () => {
      const err = new ConflictError("Quote with this slug already exists");
      expect(err.status).toBe(409);
      expect(err.code).toBe("CONFLICT");
      expect(err.title).toBe("Conflict");
      expect(err.detail).toBe("Quote with this slug already exists");
      expect(err).toBeInstanceOf(AppError);

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(409);
      expect(problem.code).toBe("CONFLICT");
      expect(problem.title).toBe("Conflict");
      expect(problem.detail).toBe("Quote with this slug already exists");
    });

    it("should create RateLimitError with status 429 and default properties", () => {
      const err = new RateLimitError("Rate limit exceeded. Try again in 60s.");
      expect(err.status).toBe(429);
      expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(err.title).toBe("Too many requests");
      expect(err.detail).toBe("Rate limit exceeded. Try again in 60s.");
      expect(err).toBeInstanceOf(AppError);

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(429);
      expect(problem.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(problem.title).toBe("Too many requests");
      expect(problem.detail).toBe("Rate limit exceeded. Try again in 60s.");
    });

    it("should support ValidationError initialized with errors object directly", () => {
      const fieldErrors = { author: ["Author is required"] };
      const err = new ValidationError(fieldErrors);
      expect(err.status).toBe(400);
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.title).toBe("Validation failed");
      expect(err.errors).toEqual(fieldErrors);

      const problem = toProblemDetails(err);
      expect(problem.status).toBe(400);
      expect(problem.errors).toEqual(fieldErrors);
    });
  });

  describe("toProblemDetails fallback and edge cases", () => {
    it("should handle null or undefined error as 500", () => {
      const problemFromNull = toProblemDetails(null);
      expect(problemFromNull.status).toBe(500);
      expect(problemFromNull.code).toBe("INTERNAL_SERVER_ERROR");
      expect(problemFromNull.detail).toBe("An unexpected internal error occurred.");

      const problemFromUndefined = toProblemDetails(undefined);
      expect(problemFromUndefined.status).toBe(500);
      expect(problemFromUndefined.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("should handle non-Error primitives as 500", () => {
      const problemFromString = toProblemDetails("string error message");
      expect(problemFromString.status).toBe(500);
      expect(problemFromString.code).toBe("INTERNAL_SERVER_ERROR");
      expect(problemFromString.detail).toBe("An unexpected internal error occurred.");

      const problemFromNumber = toProblemDetails(42);
      expect(problemFromNumber.status).toBe(500);
    });
  });
});
