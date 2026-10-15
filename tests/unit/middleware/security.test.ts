import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { securityMiddleware, isAllowedOrigin } from "../../../src/middleware/security";
import { env } from "../../../src/app/config/env";

describe("securityMiddleware", () => {
  let handlerCalled = false;
  const app = express();
  app.use(securityMiddleware);
  app.get("/sec-test", (_req, res) => {
    handlerCalled = true;
    res.json({ ok: true });
  });
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(500).json({ error: err.message });
    }
  );

  describe("Security Headers (Helmet)", () => {
    it("should set security headers (X-Content-Type-Options, Strict-Transport-Security, X-Frame-Options)", async () => {
      const res = await request(app).get("/sec-test");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["strict-transport-security"]).toContain("max-age=");
      expect(res.headers["strict-transport-security"]).toContain("includeSubDomains");
    });

    it("should configure Content-Security-Policy (CSP) with restrictive directives", async () => {
      const res = await request(app).get("/sec-test");
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
    });
  });

  describe("CORS Configuration", () => {
    it("should allow requests without an Origin header (server-to-server / mobile / CLI)", async () => {
      handlerCalled = false;
      const res = await request(app).get("/sec-test");
      expect(res.status).toBe(200);
      expect(handlerCalled).toBe(true);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should allow requests matching env.FRONTEND_ORIGIN with credentials", async () => {
      handlerCalled = false;
      const res = await request(app)
        .get("/sec-test")
        .set("Origin", env.FRONTEND_ORIGIN);
      expect(res.status).toBe(200);
      expect(handlerCalled).toBe(true);
      expect(res.headers["access-control-allow-origin"]).toBe(env.FRONTEND_ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("should reject requests from untrusted origins with an error and not execute handler", async () => {
      handlerCalled = false;
      const res = await request(app)
        .get("/sec-test")
        .set("Origin", "http://malicious-website.com");
      expect(handlerCalled).toBe(false);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Not allowed by CORS");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should handle CORS preflight OPTIONS requests for allowed origin", async () => {
      const res = await request(app)
        .options("/sec-test")
        .set("Origin", env.FRONTEND_ORIGIN)
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(env.FRONTEND_ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("should allow requests from Cloudflare quick tunnel subdomains with credentials", async () => {
      handlerCalled = false;
      const cfOrigin = "https://officials-ebony-where-employers.trycloudflare.com";
      const res = await request(app)
        .get("/sec-test")
        .set("Origin", cfOrigin);
      expect(res.status).toBe(200);
      expect(handlerCalled).toBe(true);
      expect(res.headers["access-control-allow-origin"]).toBe(cfOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("should allow requests from Vercel deployment and preview subdomains with credentials", async () => {
      handlerCalled = false;
      const vercelOrigin = "https://quote-hub-web-preview.vercel.app";
      const res = await request(app)
        .get("/sec-test")
        .set("Origin", vercelOrigin);
      expect(res.status).toBe(200);
      expect(handlerCalled).toBe(true);
      expect(res.headers["access-control-allow-origin"]).toBe(vercelOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("should reject CORS preflight OPTIONS requests for untrusted origin", async () => {
      const res = await request(app)
        .options("/sec-test")
        .set("Origin", "http://malicious-website.com")
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(500);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("isAllowedOrigin helper", () => {
    it("should return true for configured FRONTEND_ORIGIN, localhost, and 127.0.0.1", () => {
      expect(isAllowedOrigin(env.FRONTEND_ORIGIN)).toBe(true);
      expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
      expect(isAllowedOrigin("http://localhost:4000")).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
    });

    it("should return true for trycloudflare.com subdomains over HTTPS", () => {
      expect(isAllowedOrigin("https://abc-123.trycloudflare.com")).toBe(true);
      expect(isAllowedOrigin("https://officials-ebony-where-employers.trycloudflare.com")).toBe(true);
      // HTTP without TLS on trycloudflare is not allowed
      expect(isAllowedOrigin("http://abc-123.trycloudflare.com")).toBe(false);
    });

    it("should return true for vercel.app and vercel preview subdomains over HTTPS", () => {
      expect(isAllowedOrigin("https://vercel.app")).toBe(true);
      expect(isAllowedOrigin("https://quote-hub.vercel.app")).toBe(true);
      expect(isAllowedOrigin("https://quote-hub-git-feat.vercel.app")).toBe(true);
      expect(isAllowedOrigin("http://quote-hub.vercel.app")).toBe(false);
    });

    it("should return false for malicious spoofing origins and invalid URLs", () => {
      expect(isAllowedOrigin("http://malicious-website.com")).toBe(false);
      expect(isAllowedOrigin("https://trycloudflare.com.attacker.com")).toBe(false);
      expect(isAllowedOrigin("https://evilvercel.app.attacker.com")).toBe(false);
      expect(isAllowedOrigin("not-a-valid-url")).toBe(false);
    });
  });
});
