import { describe, it, expect, vi, beforeEach } from "vitest";
import { LikeService } from "../../../../src/modules/likes/services/like.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../../src/infrastructure/queue/outbox";
import * as cacheModule from "../../../../src/infrastructure/redis/cache";
import {
  ValidationError,
  NotFoundError,
} from "../../../../src/shared/errors/problem-details";

describe("LikeService", () => {
  let service: LikeService;
  let mockTx: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockTx = {
      quote: {
        findFirst: vi.fn(),
      },
      like: {
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      $executeRaw: vi.fn(),
      outboxEvent: {
        create: vi.fn(),
      },
    };

    // When prisma.$transaction is invoked, route callback with mockTx
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      return callback(mockTx);
    });

    service = new LikeService(prisma as any);
  });

  describe("Self-Like Guard", () => {
    it("should throw ValidationError if user attempts to like their own quote", async () => {
      // Mock getQuoteOwner returning quote with matching userId
      vi.spyOn(service as any, "getQuoteOwner").mockResolvedValueOnce("user-1");

      const errorPromise = service.likeQuote("user-1", "quote-abc");

      await expect(errorPromise).rejects.toThrow("Users cannot like their own quote");
      await expect(errorPromise).rejects.toBeInstanceOf(ValidationError);
      await expect(errorPromise).rejects.toMatchObject({
        code: "CANNOT_LIKE_OWN_QUOTE",
        status: 400,
      });
    });
  });

  describe("getQuoteOwner helper", () => {
    it("should return userId when active quote exists", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: "author-123" });

      const owner = await (service as any).getQuoteOwner("quote-123", mockTx);
      expect(owner).toBe("author-123");
      expect(mockTx.quote.findFirst).toHaveBeenCalledWith({
        where: { id: "quote-123", deletedAt: null },
        select: { userId: true },
      });
    });

    it("should throw NotFoundError when quote does not exist", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce(null);

      await expect(
        (service as any).getQuoteOwner("missing-quote", mockTx)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("likeQuote", () => {
    it("should throw NotFoundError if quote does not exist", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce(null);

      await expect(service.likeQuote("user-2", "missing-quote")).rejects.toThrow(
        "Quote not found"
      );
      expect(mockTx.like.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it("should successfully like quote, increment like_count atomically, and stage LikeCreated outbox event", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: authorId });
      mockTx.like.findUnique.mockResolvedValueOnce(null);
      mockTx.like.create.mockResolvedValueOnce({
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });
      mockTx.$executeRaw.mockResolvedValueOnce(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.likeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: true, quoteId });

      // 1. Like record inserted
      expect(mockTx.like.create).toHaveBeenCalledWith({
        data: { userId: actorId, quoteId },
      });

      // 2. Atomic counter update
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);

      // 3. Outbox event staged with recipientId = quote author
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "LikeCreated",
        "Quote",
        quoteId,
        {
          actorId,
          quoteId,
          recipientId: authorId,
        }
      );
    });

    it("should idempotently handle duplicate like without double-incrementing or staging duplicate event", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: authorId });
      mockTx.like.findUnique.mockResolvedValueOnce({
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.likeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: true, quoteId });
      expect(mockTx.like.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle concurrent P2002 unique constraint race condition during like creation", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      // Both concurrent requests see no like initially
      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: authorId });
      mockTx.like.findUnique.mockResolvedValueOnce(null);

      // tx.like.create throws P2002 unique constraint violation
      const p2002Error = new Error("Unique constraint failed on the fields: (`user_id`,`quote_id`)");
      (p2002Error as any).code = "P2002";
      mockTx.like.create.mockRejectedValueOnce(p2002Error);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.likeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: true, quoteId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("unlikeQuote", () => {
    it("should throw NotFoundError if quote does not exist", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce(null);

      await expect(service.unlikeQuote("user-1", "missing-quote")).rejects.toThrow(
        "Quote not found"
      );
      expect(mockTx.like.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it("should successfully unlike quote, decrement like_count with GREATEST, and stage LikeRemoved outbox event", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: authorId });
      mockTx.like.findUnique.mockResolvedValueOnce({
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });
      mockTx.like.delete.mockResolvedValueOnce({
        userId: actorId,
        quoteId,
      });
      mockTx.$executeRaw.mockResolvedValueOnce(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unlikeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: false, quoteId });

      // 1. Physically delete Like record
      expect(mockTx.like.delete).toHaveBeenCalledWith({
        where: {
          userId_quoteId: {
            userId: actorId,
            quoteId,
          },
        },
      });

      // 2. Decrement counter with GREATEST(like_count - 1, 0)
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);

      // 3. Outbox event staged
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "LikeRemoved",
        "Quote",
        quoteId,
        {
          actorId,
          quoteId,
        }
      );
    });

    it("should idempotently handle unlike when relationship did not exist without counter decrement", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: authorId });
      mockTx.like.findUnique.mockResolvedValueOnce(null);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unlikeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: false, quoteId });
      expect(mockTx.like.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle concurrent P2025 error during unlike deletion without counter decrement", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: authorId });
      mockTx.like.findUnique.mockResolvedValueOnce({
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });
      const p2025Error = new Error("Record to delete does not exist");
      (p2025Error as any).code = "P2025";
      mockTx.like.delete.mockRejectedValueOnce(p2025Error);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unlikeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: false, quoteId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle P2025 error when transaction bubbles it up", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      const p2025Error = new Error("Record to delete does not exist");
      (p2025Error as any).code = "P2025";
      vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(p2025Error);

      const result = await service.unlikeQuote(actorId, quoteId);

      expect(result).toEqual({ liked: false, quoteId });
    });

    it("should invalidate quote cache only after transaction successfully commits", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";
      const ownerId = "01925b6a-9321-789a-b456-owner0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ userId: ownerId });
      mockTx.like.create.mockResolvedValueOnce({});
      mockTx.$executeRaw.mockResolvedValueOnce(1);

      const callOrder: string[] = [];
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        callOrder.push("tx-start");
        const res = await callback(mockTx);
        callOrder.push("tx-commit");
        return res;
      });
      const invalidateSpy = vi.spyOn(cacheModule, "invalidateCache").mockImplementation(async () => {
        callOrder.push("invalidate");
      });

      await service.likeQuote(actorId, quoteId);

      expect(callOrder).toEqual(["tx-start", "tx-commit", "invalidate"]);
      expect(invalidateSpy).toHaveBeenCalledWith(`cache:quote:${quoteId}`);
    });
  });
});
