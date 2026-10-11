import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { BookmarkService } from "../../../../src/modules/bookmarks/services/bookmark.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { NotFoundError } from "../../../../src/shared/errors/problem-details";

describe("BookmarkService", () => {
  let service: BookmarkService;
  let mockDb: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockDb = {
      quote: {
        findFirst: vi.fn(),
      },
      bookmark: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    };

    service = new BookmarkService(mockDb as any);
  });

  describe("listBookmarks delegation", () => {
    it("listBookmarks should query bookmarks strictly for requesting user", async () => {
      const spy = vi
        .spyOn(service as any, "queryUserBookmarks")
        .mockResolvedValueOnce({ data: [], items: [], nextCursor: null });

      await service.listBookmarks("user-owner", undefined, 20);

      expect(spy).toHaveBeenCalledWith("user-owner", undefined, 20);
    });

    it("listBookmarks should forward cursor and limit parameters", async () => {
      const spy = vi
        .spyOn(service as any, "queryUserBookmarks")
        .mockResolvedValueOnce({ data: [], items: [], nextCursor: null });

      await service.listBookmarks("user-owner", "quote-cursor-123", 15);

      expect(spy).toHaveBeenCalledWith("user-owner", "quote-cursor-123", 15);
    });
  });

  describe("queryUserBookmarks helper", () => {
    it("should query bookmarks filtering deleted quotes and ordering by createdAt DESC", async () => {
      const mockBookmarks = [
        {
          userId: "user-1",
          quoteId: "quote-1",
          createdAt: new Date("2026-03-01T00:00:00Z"),
          quote: { id: "quote-1", text: "Quote 1", deletedAt: null },
        },
      ];
      mockDb.bookmark.findMany.mockResolvedValueOnce(mockBookmarks);

      const result = await (service as any).queryUserBookmarks("user-1", undefined, 20);

      expect(mockDb.bookmark.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          quote: { deletedAt: null },
        },
        include: {
          quote: {
            include: {
              theme: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  profileImageUrl: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { quoteId: "desc" }],
        take: 21,
      });

      expect(result.data).toEqual(mockBookmarks);
      expect(result.items).toEqual(mockBookmarks);
      expect(result.nextCursor).toBeNull();
    });

    it("should handle cursor pagination and return nextCursor when hasMore is true", async () => {
      const mockBookmarks = [
        {
          userId: "user-1",
          quoteId: "quote-1",
          createdAt: new Date("2026-03-02T00:00:00Z"),
          quote: { id: "quote-1" },
        },
        {
          userId: "user-1",
          quoteId: "quote-2",
          createdAt: new Date("2026-03-01T00:00:00Z"),
          quote: { id: "quote-2" },
        },
        {
          userId: "user-1",
          quoteId: "quote-3",
          createdAt: new Date("2026-02-28T00:00:00Z"),
          quote: { id: "quote-3" },
        },
      ];

      // Request limit 2, returns 3 items (limit + 1)
      mockDb.bookmark.findMany.mockResolvedValueOnce(mockBookmarks);

      const result = await (service as any).queryUserBookmarks("user-1", undefined, 2);

      expect(result.data).toHaveLength(2);
      expect(result.items).toHaveLength(2);
      expect(result.data[0].quoteId).toBe("quote-1");
      expect(result.data[1].quoteId).toBe("quote-2");
      expect(result.nextCursor).toBe("quote-2");
    });

    it("should pass cursor and skip 1 when cursor is supplied", async () => {
      mockDb.bookmark.findMany.mockResolvedValueOnce([]);

      await (service as any).queryUserBookmarks("user-1", "cursor-quote-99", 10);

      expect(mockDb.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: {
            userId_quoteId: {
              userId: "user-1",
              quoteId: "cursor-quote-99",
            },
          },
          skip: 1,
          take: 11,
        })
      );
    });

    it("should clamp limit between 1 and 100", async () => {
      mockDb.bookmark.findMany.mockResolvedValueOnce([]);
      await (service as any).queryUserBookmarks("user-1", undefined, -5);
      expect(mockDb.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }) // take = 1 + 1
      );

      mockDb.bookmark.findMany.mockResolvedValueOnce([]);
      await (service as any).queryUserBookmarks("user-1", undefined, 500);
      expect(mockDb.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 101 }) // take = 100 + 1
      );
    });

    it("should gracefully handle P2025 error when cursor target is missing", async () => {
      const p2025Error = new Prisma.PrismaClientKnownRequestError(
        "Record to use for cursor not found",
        { code: "P2025", clientVersion: "5.0.0" }
      );
      mockDb.bookmark.findMany.mockRejectedValueOnce(p2025Error);

      const result = await (service as any).queryUserBookmarks("user-1", "missing-quote", 20);

      expect(result).toEqual({
        data: [],
        items: [],
        nextCursor: null,
      });
    });

    it("should re-throw unexpected error from findMany", async () => {
      mockDb.bookmark.findMany.mockRejectedValueOnce(new Error("Database connection error"));

      await expect(
        (service as any).queryUserBookmarks("user-1", undefined, 20)
      ).rejects.toThrow("Database connection error");
    });
  });

  describe("bookmark method", () => {
    it("should throw NotFoundError if quote does not exist or is soft-deleted", async () => {
      mockDb.quote.findFirst.mockResolvedValueOnce(null);

      await expect(service.bookmark("user-1", "nonexistent-quote")).rejects.toThrow(
        NotFoundError
      );
      await expect(
        service.bookmark("user-1", "nonexistent-quote")
      ).rejects.toThrow("Quote not found");
      expect(mockDb.bookmark.create).not.toHaveBeenCalled();
    });

    it("should create bookmark and return { bookmarked: true, quoteId } on success", async () => {
      mockDb.quote.findFirst.mockResolvedValueOnce({ id: "quote-123" });
      mockDb.bookmark.findUnique.mockResolvedValueOnce(null);
      mockDb.bookmark.create.mockResolvedValueOnce({
        userId: "user-1",
        quoteId: "quote-123",
        createdAt: new Date(),
      });

      const result = await service.bookmark("user-1", "quote-123");

      expect(result).toEqual({ bookmarked: true, quoteId: "quote-123" });
      expect(mockDb.bookmark.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          quoteId: "quote-123",
        },
      });
    });

    it("should idempotently return { bookmarked: true, quoteId } if already bookmarked", async () => {
      mockDb.quote.findFirst.mockResolvedValueOnce({ id: "quote-123" });
      mockDb.bookmark.findUnique.mockResolvedValueOnce({
        userId: "user-1",
        quoteId: "quote-123",
      });

      const result = await service.bookmark("user-1", "quote-123");

      expect(result).toEqual({ bookmarked: true, quoteId: "quote-123" });
      expect(mockDb.bookmark.create).not.toHaveBeenCalled();
    });

    it("should idempotently return { bookmarked: true, quoteId } on concurrent P2002 error", async () => {
      mockDb.quote.findFirst.mockResolvedValueOnce({ id: "quote-123" });
      mockDb.bookmark.findUnique.mockResolvedValueOnce(null);
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "5.0.0" }
      );
      mockDb.bookmark.create.mockRejectedValueOnce(p2002Error);

      const result = await service.bookmark("user-1", "quote-123");

      expect(result).toEqual({ bookmarked: true, quoteId: "quote-123" });
    });

    it("should re-throw unexpected database errors during creation", async () => {
      mockDb.quote.findFirst.mockResolvedValueOnce({ id: "quote-123" });
      mockDb.bookmark.findUnique.mockResolvedValueOnce(null);
      mockDb.bookmark.create.mockRejectedValueOnce(new Error("Disk full"));

      await expect(service.bookmark("user-1", "quote-123")).rejects.toThrow("Disk full");
    });
  });

  describe("unbookmark method", () => {
    it("should delete bookmark and return { bookmarked: false, quoteId } on success", async () => {
      mockDb.bookmark.delete.mockResolvedValueOnce({
        userId: "user-1",
        quoteId: "quote-123",
      });

      const result = await service.unbookmark("user-1", "quote-123");

      expect(result).toEqual({ bookmarked: false, quoteId: "quote-123" });
      expect(mockDb.bookmark.delete).toHaveBeenCalledWith({
        where: {
          userId_quoteId: {
            userId: "user-1",
            quoteId: "quote-123",
          },
        },
      });
    });

    it("should idempotently return { bookmarked: false, quoteId } when bookmark does not exist (P2025)", async () => {
      const p2025Error = new Prisma.PrismaClientKnownRequestError(
        "Record to delete does not exist",
        { code: "P2025", clientVersion: "5.0.0" }
      );
      mockDb.bookmark.delete.mockRejectedValueOnce(p2025Error);

      const result = await service.unbookmark("user-1", "quote-123");

      expect(result).toEqual({ bookmarked: false, quoteId: "quote-123" });
    });

    it("should re-throw unexpected database errors during deletion", async () => {
      mockDb.bookmark.delete.mockRejectedValueOnce(new Error("Database unavailable"));

      await expect(service.unbookmark("user-1", "quote-123")).rejects.toThrow(
        "Database unavailable"
      );
    });
  });
});
