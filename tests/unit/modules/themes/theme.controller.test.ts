import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { ThemeController } from "../../../../src/modules/themes/controllers/theme.controller";
import { ThemeService } from "../../../../src/modules/themes/services/theme.service";
import { createApp } from "../../../../src/app/app";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { Request, Response, NextFunction } from "express";

describe("ThemeController & Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockThemes = [
    {
      id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
      key: "classic-serif",
      name: "Classic Serif",
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];

  describe("ThemeController unit", () => {
    it("should return themes with 200 status", async () => {
      const mockService = {
        listActiveThemes: vi.fn().mockResolvedValue(mockThemes),
      } as unknown as ThemeService;

      const controller = new ThemeController(mockService);

      const req = {} as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await controller.list(req, res, next);

      expect(statusFn).toHaveBeenCalledWith(200);
      expect(jsonFn).toHaveBeenCalledWith(mockThemes);
      expect(next).not.toHaveBeenCalled();
    });

    it("should call next with error when service throws", async () => {
      const testError = new Error("Database connection lost");
      const mockService = {
        listActiveThemes: vi.fn().mockRejectedValue(testError),
      } as unknown as ThemeService;

      const controller = new ThemeController(mockService);

      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(testError);
    });
  });

  describe("GET /api/v1/themes integration", () => {
    const app = createApp();

    it("should return 200 with list of active themes", async () => {
      vi.spyOn(prisma.theme, "findMany").mockResolvedValueOnce(mockThemes as any);

      const res = await request(app).get("/api/v1/themes");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].key).toBe("classic-serif");
      expect(res.body[0].name).toBe("Classic Serif");
    });
  });
});
