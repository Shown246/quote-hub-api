import { AuditLog, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { logger } from "../../../infrastructure/logging/logger";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";

export interface ListAuditLogsOptions {
  limit?: number;
  offset?: number;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
}

export type AuditLogWithActor = AuditLog & {
  actorUser: {
    id: string;
    username: string;
    displayName: string;
  };
};

export interface ListAuditLogsResult {
  logs: AuditLogWithActor[];
  total: number;
}

export class AuditService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Records an immutable administrative audit log entry.
   *
   * @param actorId The user ID of the admin performing the action
   * @param action Identifier of the performed action (e.g. 'ADMIN_SUSPENDED_USER')
   * @param resourceType The target entity type (e.g. 'USER', 'QUOTE')
   * @param resourceId The target entity identifier
   * @param metadata Optional arbitrary structured JSON metadata
   * @param tx Optional ongoing Prisma transaction client
   */
  async recordAction(
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown> | null,
    tx?: Prisma.TransactionClient | PrismaClient
  ): Promise<AuditLog> {
    const client = tx ?? this.db;
    const id = generateUuidV7();

    const data: Prisma.AuditLogUncheckedCreateInput = {
      id,
      actorUserId: actorId,
      action,
      resourceType,
      resourceId,
      ...(metadata !== undefined
        ? { metadata: metadata === null ? Prisma.DbNull : (metadata as Prisma.InputJsonValue) }
        : {}),
    };

    const log = await client.auditLog.create({
      data,
    });

    logger.info(
      {
        event: "audit.action_recorded",
        auditLogId: id,
        actorId,
        action,
        resourceType,
        resourceId,
        metadata,
      },
      `Audit action recorded: ${action} on ${resourceType}:${resourceId} by ${actorId}`
    );

    return log;
  }

  /**
   * Retrieves a paginated list of administrative audit logs with associated actor information.
   *
   * Supports both an options object or positional limit/offset arguments.
   *
   * @param optionsOrLimit Pagination and filter options object, or numeric limit
   * @param offsetParam Numeric offset when limit is provided as first argument
   */
  async listLogs(options?: ListAuditLogsOptions): Promise<ListAuditLogsResult>;
  async listLogs(limit?: number, offset?: number): Promise<ListAuditLogsResult>;
  async listLogs(
    optionsOrLimit?: ListAuditLogsOptions | number,
    offsetParam?: number
  ): Promise<ListAuditLogsResult> {
    let options: ListAuditLogsOptions = {};

    if (typeof optionsOrLimit === "number") {
      options = {
        limit: optionsOrLimit,
        offset: offsetParam,
      };
    } else if (optionsOrLimit && typeof optionsOrLimit === "object") {
      options = optionsOrLimit;
    }

    const rawLimit = typeof options.limit === "number" ? options.limit : 50;
    const clampedLimit = Math.max(1, Math.min(rawLimit, 100));

    const rawOffset = typeof options.offset === "number" ? options.offset : 0;
    const clampedOffset = Math.max(0, rawOffset);

    const where: Prisma.AuditLogWhereInput = {};
    if (options.actorId) {
      where.actorUserId = options.actorId;
    }
    if (options.resourceType) {
      where.resourceType = options.resourceType;
    }
    if (options.resourceId) {
      where.resourceId = options.resourceId;
    }

    const [logs, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: clampedLimit,
        skip: clampedOffset,
        include: {
          actorUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return {
      logs: logs as AuditLogWithActor[],
      total,
    };
  }
}

export const auditService = new AuditService();
