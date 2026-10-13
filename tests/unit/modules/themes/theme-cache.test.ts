import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeRepository } from "../../../../src/modules/themes/repositories/theme.repository";
import { redis } from "../../../../src/infrastructure/redis/redis";

describe("Theme Hot Path Caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleTheme = {
    id: "theme-123",
    key: "classic-light",
    name: "Classic Light",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  describe("findActiveThemes", () => {
    it("should return cached themes on cache hit without database query", async () => {
      const mockPrisma = {
        theme: {
          findMany: vi.fn(),
        },
      } as any;
      const repo = new ThemeRepository(mockPrisma);

      vi.spyOn(redis, "get").mockResolvedValueOnce(JSON.stringify([sampleTheme]));

      const result = await repo.findActiveThemes();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("theme-123");
      expect(mockPrisma.theme.findMany).not.toHaveBeenCalled();
    });

    it("should query database and cache on cache miss", async () => {
      const mockPrisma = {
        theme: {
          findMany: vi.fn().mockResolvedValueOnce([sampleTheme]),
        },
      } as any;
      const repo = new ThemeRepository(mockPrisma);

      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      const setSpy = vi.spyOn(redis, "set").mockResolvedValueOnce("OK" as any);

      const result = await repo.findActiveThemes();

      expect(result).toHaveLength(1);
      expect(mockPrisma.theme.findMany).toHaveBeenCalledOnce();
      expect(setSpy).toHaveBeenCalledWith(
        "cache:themes:active",
        expect.any(String),
        "EX",
        86400
      );
    });
  });

  describe("findById", () => {
    it("should return cached theme on cache hit without database query", async () => {
      const mockPrisma = {
        theme: {
          findUnique: vi.fn(),
        },
      } as any;
      const repo = new ThemeRepository(mockPrisma);

      vi.spyOn(redis, "get").mockResolvedValueOnce(JSON.stringify(sampleTheme));

      const result = await repo.findById("theme-123");

      expect(result?.id).toBe("theme-123");
      expect(mockPrisma.theme.findUnique).not.toHaveBeenCalled();
    });

    it("should query database and cache on cache miss", async () => {
      const mockPrisma = {
        theme: {
          findUnique: vi.fn().mockResolvedValueOnce(sampleTheme),
        },
      } as any;
      const repo = new ThemeRepository(mockPrisma);

      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      const setSpy = vi.spyOn(redis, "set").mockResolvedValueOnce("OK" as any);

      const result = await repo.findById("theme-123");

      expect(result?.id).toBe("theme-123");
      expect(mockPrisma.theme.findUnique).toHaveBeenCalledWith({ where: { id: "theme-123" } });
      expect(setSpy).toHaveBeenCalledWith(
        "cache:theme:theme-123",
        expect.any(String),
        "EX",
        86400
      );
    });
  });
});
