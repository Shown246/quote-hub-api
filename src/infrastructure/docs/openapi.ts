import { RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";

export const openApiDoc: Record<string, any> = {
  openapi: "3.1.0",
  info: {
    title: "Quote-Hub REST API",
    version: "1.0.0",
    description: "Quote-Hub modular monolith backend REST API",
  },
  servers: [
    {
      url: "http://localhost:4000",
      description: "Local development server",
    },
  ],
  paths: {
    "/health/live": {
      get: {
        summary: "Liveness probe",
        description: "Returns 200 if the server process is responsive.",
        tags: ["Health"],
        responses: {
          "200": {
            description: "Process is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "alive" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                  required: ["status", "timestamp"],
                },
              },
            },
          },
        },
      },
    },
    "/health/ready": {
      get: {
        summary: "Readiness probe",
        description: "Returns 200 if the server and downstream dependencies are ready to handle traffic.",
        tags: ["Health"],
        responses: {
          "200": {
            description: "Service is ready",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ready" },
                    timestamp: { type: "string", format: "date-time" },
                    services: {
                      type: "object",
                      properties: {
                        database: { type: "string", example: "healthy" },
                      },
                      required: ["database"],
                    },
                  },
                  required: ["status", "timestamp", "services"],
                },
              },
            },
          },
          "503": {
            description: "Service is unavailable or degraded",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "degraded" },
                    timestamp: { type: "string", format: "date-time" },
                    services: {
                      type: "object",
                      properties: {
                        database: { type: "string", example: "unhealthy" },
                      },
                      required: ["database"],
                    },
                  },
                  required: ["status", "timestamp", "services"],
                },
              },
            },
          },
        },
      },
    },

    // Quotes
    "/api/v1/quotes": {
      get: {
        summary: "List quotes with cursor pagination",
        tags: ["Quotes"],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Base64 cursor" },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 }, description: "Page limit (1-50)" },
          { name: "userId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filter by author UUID" },
          { name: "themeId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filter by theme UUID" },
        ],
        responses: {
          "200": {
            description: "Paginated list of quotes",
            content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteListResponse" } } },
          },
        },
      },
      post: {
        summary: "Create a new quote",
        tags: ["Quotes"],
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  text: { type: "string", minLength: 1, maxLength: 1000 },
                  isOriginal: { type: "boolean" },
                  authorName: { type: "string", maxLength: 255 },
                  themeId: { type: "string", format: "uuid" },
                },
                required: ["text", "isOriginal", "themeId"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Quote created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Quote" } } },
          },
          "400": { $ref: "#/components/responses/ProblemDetails" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/quotes/{quoteId}": {
      get: {
        summary: "Get quote by ID",
        tags: ["Quotes"],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Quote found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Quote" } } },
          },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      patch: {
        summary: "Update quote",
        tags: ["Quotes"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  text: { type: "string", minLength: 1, maxLength: 1000 },
                  themeId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Quote updated",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Quote" } } },
          },
          "403": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      delete: {
        summary: "Soft delete quote",
        tags: ["Quotes"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Quote soft-deleted" },
          "403": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/quotes/{quoteId}/like": {
      post: {
        summary: "Like a quote",
        tags: ["Quotes", "Likes"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Quote liked" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      delete: {
        summary: "Unlike a quote",
        tags: ["Quotes", "Likes"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Quote unliked" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/quotes/{quoteId}/repost": {
      post: {
        summary: "Repost a quote",
        tags: ["Quotes", "Reposts"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Quote reposted" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      delete: {
        summary: "Unrepost a quote",
        tags: ["Quotes", "Reposts"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Quote unreposted" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/quotes/{quoteId}/bookmark": {
      post: {
        summary: "Bookmark a quote",
        tags: ["Quotes", "Bookmarks"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Quote bookmarked" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      delete: {
        summary: "Remove bookmark",
        tags: ["Quotes", "Bookmarks"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Bookmark removed" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },

    // Users
    "/api/v1/users/me": {
      get: {
        summary: "Get current authenticated user profile",
        tags: ["Users"],
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } } },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      patch: {
        summary: "Update current user profile",
        tags: ["Users"],
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  displayName: { type: "string", maxLength: 50 },
                  bio: { type: "string", maxLength: 200 },
                },
              },
            },
          },
        },
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } } },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      delete: {
        summary: "Schedule authenticated user account deletion",
        tags: ["Users"],
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "Account deletion scheduled" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/users/me/bookmarks": {
      get: {
        summary: "List current user bookmarked quotes",
        tags: ["Users", "Bookmarks"],
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteListResponse" } } } },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/users/me/profile-image": {
      post: {
        summary: "Obtain presigned PUT URL for avatar upload",
        tags: ["Users", "Media"],
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  contentType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp"] },
                  fileSize: { type: "integer", maximum: 2097152 },
                },
                required: ["contentType", "fileSize"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Presigned upload URL generated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    uploadUrl: { type: "string", format: "uri" },
                    key: { type: "string" },
                  },
                  required: ["uploadUrl", "key"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/users/me/profile-image/confirm": {
      post: {
        summary: "Confirm uploaded profile image to queue background resizing",
        tags: ["Users", "Media"],
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  key: { type: "string" },
                },
                required: ["key"],
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Avatar upload confirmed and queued for processing",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    key: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ProblemDetails" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/users/{username}": {
      get: {
        summary: "Get public profile by username",
        tags: ["Users"],
        parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } } },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/users/{userId}/follow": {
      post: {
        summary: "Follow user",
        tags: ["Users", "Follows"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "User followed" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      delete: {
        summary: "Unfollow user",
        tags: ["Users", "Follows"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "User unfollowed" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },

    // Feeds, Trending & Search
    "/api/v1/feed/for-you": {
      get: {
        summary: "Public global discovery algorithmic feed",
        tags: ["Feeds"],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteListResponse" } } } },
        },
      },
    },
    "/api/v1/feed/following": {
      get: {
        summary: "Chronological follow-graph activity feed",
        tags: ["Feeds"],
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteListResponse" } } } },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/trending": {
      get: {
        summary: "Top trending quotes within 24-hour window",
        tags: ["Trending"],
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
        responses: {
          "200": {
            description: "List of top trending quotes",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Quote" },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/search": {
      get: {
        summary: "Full-text search over quotes and user profiles",
        tags: ["Search"],
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 1 } },
          { name: "type", in: "query", schema: { type: "string", enum: ["quotes", "users", "all"], default: "all" } },
        ],
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    quotes: { type: "array", items: { $ref: "#/components/schemas/Quote" } },
                    users: { type: "array", items: { $ref: "#/components/schemas/UserProfile" } },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Notifications
    "/api/v1/notifications": {
      get: {
        summary: "List notifications for authenticated user",
        tags: ["Notifications"],
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
                    pagination: {
                      type: "object",
                      properties: { nextCursor: { type: ["string", "null"] }, hasMore: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/notifications/{notificationId}/read": {
      patch: {
        summary: "Mark notification as read",
        tags: ["Notifications"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "notificationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Notification marked read" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/notifications/read-all": {
      patch: {
        summary: "Mark all notifications as read",
        tags: ["Notifications"],
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "All notifications marked read" },
          "401": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },

    // Admin
    "/api/v1/admin/users": {
      get: {
        summary: "Admin list users with status filters",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "SUSPENDED", "PENDING_DELETION"] } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/UserProfile" },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/admin/users/{userId}": {
      get: {
        summary: "Admin get user details",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } } },
          "403": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/admin/users/{userId}/status": {
      patch: {
        summary: "Admin suspend or reinstate user account",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] },
                  reason: { type: "string", minLength: 1 },
                },
                required: ["status", "reason"],
              },
            },
          },
        },
        responses: {
          "200": { description: "User status updated" },
          "403": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/admin/quotes": {
      get: {
        summary: "Admin list quotes",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Quote" },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/admin/quotes/{quoteId}": {
      delete: {
        summary: "Admin soft-delete quote with audit reason",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "quoteId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { reason: { type: "string", minLength: 1 } },
                required: ["reason"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Quote removed by admin" },
          "403": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/admin/analytics": {
      get: {
        summary: "Get system aggregated daily metrics",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/DailyMetric" },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/admin/audit-logs": {
      get: {
        summary: "Query administrative audit logs",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AuditLog" },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },

    // Themes
    "/api/v1/themes": {
      get: {
        summary: "List all active quote rendering themes",
        tags: ["Themes"],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Theme" },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Create custom theme (Admin)",
        tags: ["Themes", "Admin"],
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  fontFamily: { type: "string" },
                  fontSize: { type: "integer" },
                  lineHeight: { type: "number" },
                  colorPalette: { type: "object" },
                  aspectRatio: { type: "string" },
                },
                required: ["name", "fontFamily", "fontSize", "lineHeight", "colorPalette", "aspectRatio"],
              },
            },
          },
        },
        responses: {
          "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Theme" } } } },
          "403": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
    "/api/v1/themes/{themeId}": {
      get: {
        summary: "Get theme by ID",
        tags: ["Themes"],
        parameters: [{ name: "themeId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Theme" } } } },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
      patch: {
        summary: "Update theme (Admin)",
        tags: ["Themes", "Admin"],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "themeId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Theme" } } } },
          "403": { $ref: "#/components/responses/ProblemDetails" },
          "404": { $ref: "#/components/responses/ProblemDetails" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
      },
    },
    responses: {
      ProblemDetails: {
        description: "RFC 9457 Problem Details error payload",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ProblemDetails",
            },
          },
        },
      },
    },
    schemas: {
      ProblemDetails: {
        type: "object",
        description: "RFC 9457 Problem Details error payload",
        properties: {
          type: {
            type: "string",
            description: "URI reference that identifies the problem type",
            example: "about:blank",
          },
          title: {
            type: "string",
            description: "Short human-readable summary of problem type",
            example: "Resource not found",
          },
          status: {
            type: "integer",
            description: "HTTP status code generated by the origin server",
            example: 404,
          },
          detail: {
            type: "string",
            description: "Human-readable explanation specific to this occurrence",
            example: "The requested resource was not found",
          },
          code: {
            type: "string",
            description: "Application-specific machine-readable error code",
            example: "NOT_FOUND",
          },
          instance: {
            type: "string",
            description: "Request correlation ID or URI identifying occurrence",
            example: "018f3a2c-1234-7000-8000-000000000001",
          },
          errors: {
            type: "object",
            description: "Detailed validation errors grouped by field name",
            additionalProperties: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
        },
        required: ["type", "title", "status", "detail", "code"],
      },
      Quote: {
        type: "object",
        description: "Core Quote model",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          text: { type: "string" },
          isOriginal: { type: "boolean" },
          authorName: { type: ["string", "null"] },
          themeId: { type: "string", format: "uuid" },
          likeCount: { type: "integer" },
          repostCount: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          deletedAt: { type: ["string", "null"], format: "date-time" },
        },
        required: ["id", "userId", "text", "isOriginal", "themeId", "likeCount", "repostCount", "createdAt", "updatedAt"],
      },
      QuoteListResponse: {
        type: "object",
        description: "Standard paginated quotes envelope",
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/Quote" },
          },
          pagination: {
            type: "object",
            properties: {
              nextCursor: { type: ["string", "null"] },
              hasMore: { type: "boolean" },
            },
            required: ["nextCursor", "hasMore"],
          },
        },
        required: ["data", "pagination"],
      },
      UserProfile: {
        type: "object",
        description: "User profile representation",
        properties: {
          id: { type: "string", format: "uuid" },
          username: { type: "string" },
          displayName: { type: "string" },
          bio: { type: ["string", "null"] },
          avatarUrl: { type: ["string", "null"] },
          followerCount: { type: "integer" },
          followingCount: { type: "integer" },
          quoteCount: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "username", "displayName", "followerCount", "followingCount", "quoteCount", "createdAt"],
      },
      Theme: {
        type: "object",
        description: "Quote typography and card styling theme",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          fontFamily: { type: "string" },
          fontSize: { type: "integer" },
          lineHeight: { type: "number" },
          colorPalette: { type: "object" },
          aspectRatio: { type: "string" },
          isActive: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "name", "fontFamily", "fontSize", "lineHeight", "colorPalette", "aspectRatio", "isActive", "createdAt"],
      },
      Notification: {
        type: "object",
        description: "In-app social activity notification",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          actorId: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["LIKE", "REPOST", "FOLLOW"] },
          resourceId: { type: "string", format: "uuid" },
          isRead: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "userId", "actorId", "type", "resourceId", "isRead", "createdAt"],
      },
      DailyMetric: {
        type: "object",
        description: "Daily aggregated platform operational metrics",
        properties: {
          id: { type: "string", format: "uuid" },
          date: { type: "string", format: "date" },
          activeUsers: { type: "integer" },
          quotesCreated: { type: "integer" },
          likesCount: { type: "integer" },
          repostsCount: { type: "integer" },
          calculatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "date", "activeUsers", "quotesCreated", "likesCount", "repostsCount", "calculatedAt"],
      },
      AuditLog: {
        type: "object",
        description: "Administrative moderation and mutation audit log",
        properties: {
          id: { type: "string", format: "uuid" },
          adminId: { type: "string", format: "uuid" },
          action: { type: "string" },
          targetType: { type: "string" },
          targetId: { type: "string", format: "uuid" },
          reason: { type: "string" },
          metadata: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "adminId", "action", "targetType", "targetId", "reason", "createdAt"],
      },
    },
  },
};

export const serveSwagger = (): RequestHandler[] => [
  ...swaggerUi.serve,
  swaggerUi.setup(openApiDoc),
];
