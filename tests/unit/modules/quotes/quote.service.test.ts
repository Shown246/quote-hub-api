import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuoteService } from "../../../../src/modules/quotes/services/quote.service";
import { QuoteRepository } from "../../../../src/modules/quotes/repositories/quote.repository";
import { ThemeRepository } from "../../../../src/modules/themes/repositories/theme.repository";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "../../../../src/shared/errors/problem-details";
import { isValidUuidV7 } from "../../../../src/shared/utils/uuidv7";
import { Quote, Theme } from "@prisma/client";

describe("QuoteService", () => {
  let mockQuoteRepo: QuoteRepository;
  let mockThemeRepo: ThemeRepository;
  let service: QuoteService;

  const validTheme: Theme = {
    id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    key: "classic-serif",
    name: "Classic Serif",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const inactiveTheme: Theme = {
    id: "018f972b-5b3a-7d4e-8fa1-0123456789ac",
    key: "archived-mono",
    name: "Archived Mono",
    isActive: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const sampleQuote: Quote = {
    id: "018f972b-5b3a-7d4e-8fa1-012345678901",
    userId: "018f972b-5b3a-7d4e-8fa1-012345678000",
    text: "Simplicity is prerequisite for reliability.",
    isOriginal: true,
    authorName: null,
    themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    likeCount: 0,
    repostCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    mockQuoteRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as QuoteRepository;

    mockThemeRepo = {
      findById: vi.fn(),
      findActiveThemes: vi.fn(),
    } as unknown as ThemeRepository;

    service = new QuoteService(mockQuoteRepo, mockThemeRepo);
  });

  describe("constructor", () => {
    it("should instantiate with default dependencies", () => {
      const defaultService = new QuoteService();
      expect(defaultService).toBeInstanceOf(QuoteService);
    });
  });

  describe("createQuote", () => {
    it("should successfully create an original quote with an active theme", async () => {
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(validTheme);
      vi.mocked(mockQuoteRepo.create).mockImplementation(async (data) => ({
        ...sampleQuote,
        id: data.id!,
        userId: data.userId,
        text: data.text,
        isOriginal: data.isOriginal,
        authorName: data.authorName ?? null,
        themeId: data.themeId,
      }));

      const result = await service.createQuote(sampleQuote.userId, {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        themeId: validTheme.id,
      });

      expect(mockThemeRepo.findById).toHaveBeenCalledWith(validTheme.id);
      expect(mockQuoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: sampleQuote.userId,
          text: "Simplicity is prerequisite for reliability.",
          isOriginal: true,
          authorName: null,
          themeId: validTheme.id,
        })
      );
      expect(isValidUuidV7(result.id)).toBe(true);
      expect(result.text).toBe("Simplicity is prerequisite for reliability.");
    });

    it("should successfully create a non-original quote with authorName", async () => {
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(validTheme);
      vi.mocked(mockQuoteRepo.create).mockImplementation(async (data) => ({
        ...sampleQuote,
        id: data.id!,
        userId: data.userId,
        text: data.text,
        isOriginal: data.isOriginal,
        authorName: data.authorName ?? null,
        themeId: data.themeId,
      }));

      const result = await service.createQuote(sampleQuote.userId, {
        text: "The impediment to action advances action.",
        isOriginal: false,
        authorName: "Marcus Aurelius",
        themeId: validTheme.id,
      });

      expect(mockQuoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isOriginal: false,
          authorName: "Marcus Aurelius",
        })
      );
      expect(result.authorName).toBe("Marcus Aurelius");
    });

    it("should throw ValidationError if original quote specifies authorName (invariant defense)", async () => {
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(validTheme);

      await expect(
        service.createQuote(sampleQuote.userId, {
          text: "Original quote",
          isOriginal: true,
          authorName: "Someone",
          themeId: validTheme.id,
        } as any)
      ).rejects.toThrow(ValidationError);
      expect(mockQuoteRepo.create).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when theme does not exist", async () => {
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(null);

      await expect(
        service.createQuote(sampleQuote.userId, {
          text: "Theme missing",
          isOriginal: true,
          themeId: "018f972b-5b3a-7d4e-8fa1-000000000000",
        })
      ).rejects.toThrow(NotFoundError);
      expect(mockQuoteRepo.create).not.toHaveBeenCalled();
    });

    it("should throw ValidationError when theme is inactive", async () => {
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(inactiveTheme);

      await expect(
        service.createQuote(sampleQuote.userId, {
          text: "Inactive theme quote",
          isOriginal: true,
          themeId: inactiveTheme.id,
        })
      ).rejects.toThrow(ValidationError);
      expect(mockQuoteRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("getQuoteById", () => {
    it("should return the quote when found and not soft-deleted", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);

      const result = await service.getQuoteById(sampleQuote.id);

      expect(result).toEqual(sampleQuote);
      expect(mockQuoteRepo.findById).toHaveBeenCalledWith(sampleQuote.id);
    });

    it("should throw NotFoundError when quote does not exist", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(null);

      await expect(service.getQuoteById("non-existent-id")).rejects.toThrow(
        NotFoundError
      );
    });

    it("should throw NotFoundError when quote is soft-deleted", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce({
        ...sampleQuote,
        deletedAt: new Date("2026-01-02T00:00:00.000Z"),
      });

      await expect(service.getQuoteById(sampleQuote.id)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("updateQuote", () => {
    it("should allow owner to update quote text preserving identity", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);
      vi.mocked(mockQuoteRepo.update).mockResolvedValueOnce({
        ...sampleQuote,
        text: "Updated text",
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      });

      const result = await service.updateQuote(
        sampleQuote.userId,
        sampleQuote.id,
        { text: "Updated text" }
      );

      expect(mockQuoteRepo.update).toHaveBeenCalledWith(sampleQuote.id, {
        text: "Updated text",
        themeId: undefined,
      });
      expect(result.text).toBe("Updated text");
    });

    it("should allow owner to update visual theme when theme exists and is active", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(validTheme);
      vi.mocked(mockQuoteRepo.update).mockResolvedValueOnce({
        ...sampleQuote,
        themeId: validTheme.id,
      });

      const result = await service.updateQuote(
        sampleQuote.userId,
        sampleQuote.id,
        { themeId: validTheme.id }
      );

      expect(mockThemeRepo.findById).toHaveBeenCalledWith(validTheme.id);
      expect(mockQuoteRepo.update).toHaveBeenCalledWith(sampleQuote.id, {
        text: undefined,
        themeId: validTheme.id,
      });
      expect(result.themeId).toBe(validTheme.id);
    });

    it("should throw AuthorizationError with 'Forbidden' and code 'FORBIDDEN' when attacker attempts update", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);

      const promise = service.updateQuote("user-attacker", sampleQuote.id, {
        text: "Hacked",
      });

      await expect(promise).rejects.toThrow(AuthorizationError);
      await expect(promise).rejects.toThrow("Forbidden");
      await expect(promise).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(mockQuoteRepo.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when updating non-existent quote", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(null);

      await expect(
        service.updateQuote(sampleQuote.userId, "non-existent-id", {
          text: "Updated",
        })
      ).rejects.toThrow(NotFoundError);
      expect(mockQuoteRepo.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when updating soft-deleted quote", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce({
        ...sampleQuote,
        deletedAt: new Date(),
      });

      await expect(
        service.updateQuote(sampleQuote.userId, sampleQuote.id, {
          text: "Updated",
        })
      ).rejects.toThrow(NotFoundError);
      expect(mockQuoteRepo.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when updating themeId to non-existent theme", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(null);

      await expect(
        service.updateQuote(sampleQuote.userId, sampleQuote.id, {
          themeId: "018f972b-5b3a-7d4e-8fa1-999999999999",
        })
      ).rejects.toThrow(NotFoundError);
      expect(mockQuoteRepo.update).not.toHaveBeenCalled();
    });

    it("should throw ValidationError when updating themeId to inactive theme", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);
      vi.mocked(mockThemeRepo.findById).mockResolvedValueOnce(inactiveTheme);

      await expect(
        service.updateQuote(sampleQuote.userId, sampleQuote.id, {
          themeId: inactiveTheme.id,
        })
      ).rejects.toThrow(ValidationError);
      expect(mockQuoteRepo.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteQuote", () => {
    it("should allow owner to soft-delete their quote", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);
      vi.mocked(mockQuoteRepo.softDelete).mockResolvedValueOnce({
        ...sampleQuote,
        deletedAt: new Date(),
      });

      const result = await service.deleteQuote(
        sampleQuote.userId,
        sampleQuote.id
      );

      expect(mockQuoteRepo.softDelete).toHaveBeenCalledWith(sampleQuote.id);
      expect(result.deletedAt).toBeInstanceOf(Date);
    });

    it("should throw AuthorizationError with 'Forbidden' and code 'FORBIDDEN' when attacker attempts delete", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(sampleQuote);

      const promise = service.deleteQuote("user-attacker", sampleQuote.id);

      await expect(promise).rejects.toThrow(AuthorizationError);
      await expect(promise).rejects.toThrow("Forbidden");
      await expect(promise).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(mockQuoteRepo.softDelete).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when deleting non-existent quote", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce(null);

      await expect(
        service.deleteQuote(sampleQuote.userId, "non-existent-id")
      ).rejects.toThrow(NotFoundError);
      expect(mockQuoteRepo.softDelete).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when deleting already soft-deleted quote", async () => {
      vi.mocked(mockQuoteRepo.findById).mockResolvedValueOnce({
        ...sampleQuote,
        deletedAt: new Date(),
      });

      await expect(
        service.deleteQuote(sampleQuote.userId, sampleQuote.id)
      ).rejects.toThrow(NotFoundError);
      expect(mockQuoteRepo.softDelete).not.toHaveBeenCalled();
    });
  });
});
