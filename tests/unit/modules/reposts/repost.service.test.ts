import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepostService } from "../../../../src/modules/reposts/services/repost.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../../src/infrastructure/queue/outbox";
import { NotFoundError } from "../../../../src/shared/errors/problem-details";

describe("RepostService", () => {
  let service: RepostService;
  let mockTx: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockTx = {
      quote: {
        findFirst: vi.fn(),
      },
      repost: {
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

    service = new RepostService(prisma as any);
  });

  describe("Target quote check (Step 1)", () => {
    it("should throw NotFoundError if target quote is soft-deleted", async () => {
      vi.spyOn(service as any, "findActiveQuote").mockResolvedValueOnce(null);
      await expect(service.repostQuote("user-1", "quote-deleted")).rejects.toThrow(
        "Resource not found"
      );
    });
  });

  describe("findActiveQuote helper", () => {
    it("should return quote when active quote exists", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce({
        id: "quote-123",
        userId: "author-123",
      });

      const quote = await (service as any).findActiveQuote("quote-123", mockTx);
      expect(quote).toEqual({ id: "quote-123", userId: "author-123" });
      expect(mockTx.quote.findFirst).toHaveBeenCalledWith({
        where: { id: "quote-123", deletedAt: null },
        select: { id: true, userId: true },
      });
    });

    it("should return null when quote does not exist or is soft-deleted", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce(null);

      const quote = await (service as any).findActiveQuote("missing-quote", mockTx);
      expect(quote).toBeNull();
    });
  });

  describe("repostQuote", () => {
    it("should throw NotFoundError if quote does not exist", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce(null);

      await expect(service.repostQuote("user-2", "missing-quote")).rejects.toThrow(
        "Resource not found"
      );
      expect(mockTx.repost.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it("should successfully repost quote, increment repost_count atomically, and stage RepostCreated outbox event", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce(null);
      mockTx.repost.create.mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-repost000000",
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });
      mockTx.$executeRaw.mockResolvedValueOnce(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.repostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: true, quoteId });

      // 1. Repost record inserted with UUIDv7 id
      expect(mockTx.repost.create).toHaveBeenCalledWith({
        data: {
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          ),
          userId: actorId,
          quoteId,
        },
      });

      // 2. Atomic counter update
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);

      // 3. Outbox event staged with recipientId = quote author
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "RepostCreated",
        "Quote",
        quoteId,
        {
          actorId,
          quoteId,
          recipientId: authorId,
        }
      );
    });

    it("should allow user to repost their own quote", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce(null);
      mockTx.repost.create.mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-repost000000",
        userId: authorId,
        quoteId,
        createdAt: new Date(),
      });
      mockTx.$executeRaw.mockResolvedValueOnce(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.repostQuote(authorId, quoteId);

      expect(result).toEqual({ reposted: true, quoteId });
      expect(mockTx.repost.create).toHaveBeenCalled();
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "RepostCreated",
        "Quote",
        quoteId,
        {
          actorId: authorId,
          quoteId,
          recipientId: authorId,
        }
      );
    });

    it("should idempotently handle duplicate repost without double-incrementing or staging duplicate event", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-repost000000",
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.repostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: true, quoteId });
      expect(mockTx.repost.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle concurrent P2002 unique constraint race condition during repost creation", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      // Both concurrent requests see no repost initially
      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce(null);

      // tx.repost.create throws P2002 unique constraint violation
      const p2002Error = new Error(
        "Unique constraint failed on the fields: (`user_id`,`quote_id`)"
      );
      (p2002Error as any).code = "P2002";
      mockTx.repost.create.mockRejectedValueOnce(p2002Error);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.repostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: true, quoteId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("unrepostQuote", () => {
    it("should throw NotFoundError if quote does not exist", async () => {
      mockTx.quote.findFirst.mockResolvedValueOnce(null);

      await expect(service.unrepostQuote("user-1", "missing-quote")).rejects.toThrow(
        "Resource not found"
      );
      expect(mockTx.repost.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it("should successfully unrepost quote, decrement repost_count with GREATEST, and stage RepostRemoved outbox event", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-repost000000",
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });
      mockTx.repost.delete.mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-repost000000",
        userId: actorId,
        quoteId,
      });
      mockTx.$executeRaw.mockResolvedValueOnce(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unrepostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: false, quoteId });

      // 1. Physically delete Repost record
      expect(mockTx.repost.delete).toHaveBeenCalledWith({
        where: {
          uq_reposts_user_quote: {
            userId: actorId,
            quoteId,
          },
        },
      });

      // 2. Decrement counter with GREATEST(repost_count - 1, 0)
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);

      // 3. Outbox event staged
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "RepostRemoved",
        "Quote",
        quoteId,
        {
          actorId,
          quoteId,
        }
      );
    });

    it("should idempotently handle unrepost when relationship did not exist without counter decrement", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce(null);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unrepostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: false, quoteId });
      expect(mockTx.repost.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle concurrent P2025 error during unrepost deletion without counter decrement", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const authorId = "01925b6a-9321-789a-b456-author000000";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      mockTx.quote.findFirst.mockResolvedValueOnce({ id: quoteId, userId: authorId });
      mockTx.repost.findUnique.mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-repost000000",
        userId: actorId,
        quoteId,
        createdAt: new Date(),
      });
      const p2025Error = new Error("Record to delete does not exist");
      (p2025Error as any).code = "P2025";
      mockTx.repost.delete.mockRejectedValueOnce(p2025Error);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unrepostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: false, quoteId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle P2025 error when transaction bubbles it up", async () => {
      const quoteId = "01925b6a-9321-789a-b456-123456789abc";
      const actorId = "01925b6a-9321-789a-b456-actor0000000";

      const p2025Error = new Error("Record to delete does not exist");
      (p2025Error as any).code = "P2025";
      vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(p2025Error);

      const result = await service.unrepostQuote(actorId, quoteId);

      expect(result).toEqual({ reposted: false, quoteId });
    });
  });
});
