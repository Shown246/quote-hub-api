import { describe, it, expect } from "vitest";
import { openApiDoc, serveSwagger } from "../../../src/infrastructure/docs/openapi";

describe("OpenAPI Base Specification", () => {
  it("should contain OpenAPI 3.1.0 version and info block", () => {
    expect(openApiDoc.openapi).toBe("3.1.0");
    expect(openApiDoc.info.title).toBe("Quote-Hub REST API");
    expect(openApiDoc.info.version).toBe("1.0.0");
    expect(openApiDoc.info.description).toBe(
      "Quote-Hub modular monolith backend REST API"
    );
    expect(openApiDoc.paths["/health/live"]).toBeDefined();
    expect(openApiDoc.paths["/health/ready"]).toBeDefined();
    expect(openApiDoc.components.schemas.ProblemDetails).toBeDefined();
  });

  it("should define /health/live operation metadata", () => {
    const liveEndpoint = openApiDoc.paths["/health/live"];
    expect(liveEndpoint.get).toBeDefined();
    expect(liveEndpoint.get.responses["200"]).toBeDefined();
  });

  it("should define /health/ready operation metadata", () => {
    const readyEndpoint = openApiDoc.paths["/health/ready"];
    expect(readyEndpoint.get).toBeDefined();
    expect(readyEndpoint.get.responses["200"]).toBeDefined();
    expect(readyEndpoint.get.responses["503"]).toBeDefined();
  });

  it("should define ProblemDetails schema matching RFC 9457", () => {
    const schema = openApiDoc.components.schemas.ProblemDetails;
    expect(schema.type).toBe("object");
    expect(schema.properties.type).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.status).toBeDefined();
    expect(schema.properties.detail).toBeDefined();
    expect(schema.properties.code).toBeDefined();
    expect(schema.required).toContain("type");
    expect(schema.required).toContain("title");
    expect(schema.required).toContain("status");
    expect(schema.required).toContain("detail");
    expect(schema.required).toContain("code");
  });

  it("should export serveSwagger middleware array", () => {
    const handlers = serveSwagger();
    expect(Array.isArray(handlers)).toBe(true);
    expect(handlers.length).toBeGreaterThan(0);
    handlers.forEach((handler) => {
      expect(typeof handler).toBe("function");
    });
  });

  it("should define paths for all core domain resources", () => {
    const paths = Object.keys(openApiDoc.paths);
    // Quotes
    expect(paths).toContain("/api/v1/quotes");
    expect(paths).toContain("/api/v1/quotes/{quoteId}");
    expect(paths).toContain("/api/v1/quotes/{quoteId}/like");
    expect(paths).toContain("/api/v1/quotes/{quoteId}/repost");
    expect(paths).toContain("/api/v1/quotes/{quoteId}/bookmark");
    // Users
    expect(paths).toContain("/api/v1/users/me");
    expect(paths).toContain("/api/v1/users/me/bookmarks");
    expect(paths).toContain("/api/v1/users/me/profile-image");
    expect(paths).toContain("/api/v1/users/me/profile-image/confirm");
    expect(paths).toContain("/api/v1/users/{username}");
    expect(paths).toContain("/api/v1/users/{userId}/follow");
    // Feeds, Trending & Search
    expect(paths).toContain("/api/v1/feed/for-you");
    expect(paths).toContain("/api/v1/feed/following");
    expect(paths).toContain("/api/v1/trending");
    expect(paths).toContain("/api/v1/search");
    // Notifications
    expect(paths).toContain("/api/v1/notifications");
    expect(paths).toContain("/api/v1/notifications/{notificationId}/read");
    expect(paths).toContain("/api/v1/notifications/read-all");
    // Admin
    expect(paths).toContain("/api/v1/admin/users");
    expect(paths).toContain("/api/v1/admin/users/{userId}");
    expect(paths).toContain("/api/v1/admin/users/{userId}/status");
    expect(paths).toContain("/api/v1/admin/quotes");
    expect(paths).toContain("/api/v1/admin/quotes/{quoteId}");
    expect(paths).toContain("/api/v1/admin/analytics");
    expect(paths).toContain("/api/v1/admin/audit-logs");
    // Themes
    expect(paths).toContain("/api/v1/themes");
    expect(paths).toContain("/api/v1/themes/{themeId}");
  });

  it("should define core data model schemas in components.schemas", () => {
    const schemas = openApiDoc.components.schemas;
    expect(schemas.Quote).toBeDefined();
    expect(schemas.UserProfile).toBeDefined();
    expect(schemas.Theme).toBeDefined();
    expect(schemas.Notification).toBeDefined();
    expect(schemas.DailyMetric).toBeDefined();
    expect(schemas.AuditLog).toBeDefined();
  });
});
