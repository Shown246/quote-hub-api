import { Prisma, OutboxStatus } from "@prisma/client";
import { generateUuidV7 } from "../../shared/utils/uuidv7";

/**
 * Stages an outbox event within an existing PostgreSQL transaction boundary.
 *
 * Background workers process pending outbox events asynchronously to trigger
 * notifications, cache updates, and analytics without coupling HTTP requests
 * to background worker processing.
 *
 * @param tx - The active Prisma transaction client
 * @param eventType - The domain event identifier (e.g., "LikeCreated", "FollowCreated")
 * @param aggregateType - The primary entity/aggregate name (e.g., "Quote", "User")
 * @param aggregateId - The unique UUID identifier of the aggregate
 * @param payload - Arbitrary JSON-serializable event payload
 */
export async function stageOutboxEvent(
  tx: Prisma.TransactionClient,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Prisma.InputJsonValue | Record<string, unknown>,
): Promise<void> {
  const id = generateUuidV7();

  await tx.outboxEvent.create({
    data: {
      id,
      eventType,
      aggregateType,
      aggregateId,
      payload: payload as Prisma.InputJsonValue,
      status: OutboxStatus.PENDING,
    },
  });
}
