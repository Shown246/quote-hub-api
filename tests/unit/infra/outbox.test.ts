import { describe, it, expect, vi } from "vitest";
import { stageOutboxEvent } from "../../../src/infrastructure/queue/outbox";
import { isValidUuidV7 } from "../../../src/shared/utils/uuidv7";

describe("stageOutboxEvent", () => {
  it("should insert PENDING outbox event into tx client with UUIDv7 id", async () => {
    const mockTx = {
      outboxEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-1" }),
      },
    };

    await stageOutboxEvent(
      mockTx as any,
      "LikeCreated",
      "Quote",
      "quote-123",
      { actorId: "user-1", recipientId: "user-2" },
    );

    expect(mockTx.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(mockTx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "LikeCreated",
          aggregateType: "Quote",
          aggregateId: "quote-123",
          payload: { actorId: "user-1", recipientId: "user-2" },
          status: "PENDING",
        }),
      }),
    );

    const callArgs = mockTx.outboxEvent.create.mock.calls[0][0];
    expect(isValidUuidV7(callArgs.data.id)).toBe(true);
  });

  it("should propagate errors if tx.outboxEvent.create fails", async () => {
    const dbError = new Error("Database connection lost");
    const mockTx = {
      outboxEvent: {
        create: vi.fn().mockRejectedValue(dbError),
      },
    };

    await expect(
      stageOutboxEvent(
        mockTx as any,
        "LikeCreated",
        "Quote",
        "quote-123",
        { actorId: "user-1" },
      ),
    ).rejects.toThrow("Database connection lost");
  });
});
