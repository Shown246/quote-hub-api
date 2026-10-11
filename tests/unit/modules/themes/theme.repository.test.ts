import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeRepository } from "../../../../src/modules/themes/repositories/theme.repository";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { Theme } from "@prisma/client";

describe("ThemeRepository", () => {
  const repo = new ThemeRepository();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockTheme: Theme = {
    id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    key: "classic-serif",
    name: "Classic Serif",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  describe("findActiveThemes", () => {
    it("should query Prisma for active themes ordered by name asc", async () => {
      const spy = vi.spyOn(prisma.theme, "findMany").mockResolvedValueOnce([mockTheme]);

      const result = await repo.findActiveThemes();

      expect(spy).toHaveBeenCalledWith({
        where: {
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      });
      expect(result).toEqual([mockTheme]);
    });
  });

  describe("findById", () => {
    it("should query Prisma for theme by unique ID", async () => {
      const spy = vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(mockTheme);

      const result = await repo.findById("018f972b-5b3a-7d4e-8fa1-0123456789ab");

      expect(spy).toHaveBeenCalledWith({
        where: {
          id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
        },
      });
      expect(result).toEqual(mockTheme);
    });

    it("should return null if theme not found", async () => {
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(null);

      const result = await repo.findById("non-existent-id");

      expect(result).toBeNull();
    });
  });
});
