import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuoteRepository } from "../../../../src/modules/quotes/repositories/quote.repository";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { Quote } from "@prisma/client";
import { isValidUuidV7 } from "../../../../src/shared/utils/uuidv7";

describe("QuoteRepository", () => {
  const repo = new QuoteRepository();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockQuote: Quote = {
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

  describe("constructor", () => {
    it("should instantiate with default PrismaClient", () => {
      const defaultRepo = new QuoteRepository();
      expect(defaultRepo).toBeInstanceOf(QuoteRepository);
    });
  });

  describe("findById", () => {
    it("should query Prisma for active quote excluding soft-deleted records by default", async () => {
      const spy = vi
        .spyOn(prisma.quote, "findFirst")
        .mockResolvedValueOnce(mockQuote);

      const result = await repo.findById(mockQuote.id);

      expect(spy).toHaveBeenCalledWith({
        where: {
          id: mockQuote.id,
          deletedAt: null,
        },
      });
      expect(result).toEqual(mockQuote);
    });

    it("should query Prisma findUnique when includeDeleted is true", async () => {
      const spy = vi
        .spyOn(prisma.quote, "findUnique")
        .mockResolvedValueOnce(mockQuote);

      const result = await repo.findById(mockQuote.id, true);

      expect(spy).toHaveBeenCalledWith({
        where: {
          id: mockQuote.id,
        },
      });
      expect(result).toEqual(mockQuote);
    });

    it("should return null if quote is not found", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const result = await repo.findById("non-existent-id");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should generate a UUIDv7 when id is not provided", async () => {
      const spy = vi
        .spyOn(prisma.quote, "create")
        .mockImplementation(async (args) => ({
          ...mockQuote,
          ...args.data,
        } as any));

      const result = await repo.create({
        userId: mockQuote.userId,
        text: "Code never lies, comments sometimes do.",
        isOriginal: true,
        themeId: mockQuote.themeId,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const callData = spy.mock.calls[0][0].data;
      expect(isValidUuidV7(callData.id)).toBe(true);
      expect(callData.userId).toBe(mockQuote.userId);
      expect(callData.text).toBe("Code never lies, comments sometimes do.");
      expect(callData.isOriginal).toBe(true);
      expect(callData.authorName).toBeNull();
      expect(callData.themeId).toBe(mockQuote.themeId);
      expect(result.text).toBe("Code never lies, comments sometimes do.");
    });

    it("should preserve explicitly provided id", async () => {
      const explicitId = "018f972b-5b3a-7d4e-8fa1-111122223333";
      const spy = vi
        .spyOn(prisma.quote, "create")
        .mockImplementation(async (args) => ({
          ...mockQuote,
          ...args.data,
        } as any));

      await repo.create({
        id: explicitId,
        userId: mockQuote.userId,
        text: "Custom ID quote",
        isOriginal: false,
        authorName: "Ron Jeffries",
        themeId: mockQuote.themeId,
      });

      expect(spy).toHaveBeenCalledWith({
        data: {
          id: explicitId,
          userId: mockQuote.userId,
          text: "Custom ID quote",
          isOriginal: false,
          authorName: "Ron Jeffries",
          themeId: mockQuote.themeId,
        },
      });
    });
  });

  describe("update", () => {
    it("should update text and themeId", async () => {
      const spy = vi
        .spyOn(prisma.quote, "update")
        .mockResolvedValueOnce({
          ...mockQuote,
          text: "New text",
          themeId: "018f972b-5b3a-7d4e-8fa1-999999999999",
        });

      const result = await repo.update(mockQuote.id, {
        text: "New text",
        themeId: "018f972b-5b3a-7d4e-8fa1-999999999999",
      });

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockQuote.id },
        data: {
          text: "New text",
          themeId: "018f972b-5b3a-7d4e-8fa1-999999999999",
        },
      });
      expect(result.text).toBe("New text");
    });

    it("should only update text if themeId is not specified", async () => {
      const spy = vi
        .spyOn(prisma.quote, "update")
        .mockResolvedValueOnce({
          ...mockQuote,
          text: "Only text updated",
        });

      await repo.update(mockQuote.id, {
        text: "Only text updated",
      });

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockQuote.id },
        data: {
          text: "Only text updated",
        },
      });
    });
  });

  describe("softDelete", () => {
    it("should set deletedAt timestamp when soft deleting", async () => {
      const spy = vi
        .spyOn(prisma.quote, "update")
        .mockResolvedValueOnce({
          ...mockQuote,
          deletedAt: new Date(),
        });

      const result = await repo.softDelete(mockQuote.id);

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockQuote.id },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(result.deletedAt).toBeDefined();
    });
  });
});
