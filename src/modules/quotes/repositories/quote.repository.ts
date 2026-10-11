import { Prisma, PrismaClient, Quote } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";

export interface CreateQuoteData {
  id?: string;
  userId: string;
  text: string;
  isOriginal: boolean;
  authorName?: string | null;
  themeId: string;
}

export interface UpdateQuoteData {
  text?: string;
  themeId?: string;
}

import { encodeCursor } from "../../../shared/utils/cursor";

export interface IQuoteRepository {
  findById(id: string, includeDeleted?: boolean): Promise<Quote | null>;
  create(data: CreateQuoteData): Promise<Quote>;
  update(id: string, data: UpdateQuoteData): Promise<Quote>;
  softDelete(id: string): Promise<Quote>;
  findManyWithPagination(options: {
    limit: number;
    cursor?: { createdAt: Date; id: string };
    userId?: string;
    themeId?: string;
  }): Promise<{ items: Quote[]; hasMore: boolean; nextCursor: string | null }>;
}

export class QuoteRepository implements IQuoteRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Finds a quote by its UUID.
   * By default, soft-deleted quotes (deletedAt !== null) are excluded.
   *
   * @param id The quote UUID
   * @param includeDeleted If true, returns quote even if soft-deleted
   */
  async findById(
    id: string,
    includeDeleted: boolean = false
  ): Promise<Quote | null> {
    if (includeDeleted) {
      return this.db.quote.findUnique({ where: { id } });
    }
    return this.db.quote.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  /**
   * Creates a new quote record.
   * Generates a UUIDv7 for id if not provided.
   *
   * @param data Quote creation data
   */
  async create(data: CreateQuoteData): Promise<Quote> {
    const id = data.id ?? generateUuidV7();

    return this.db.quote.create({
      data: {
        id,
        userId: data.userId,
        text: data.text,
        isOriginal: data.isOriginal,
        authorName: data.authorName ?? null,
        themeId: data.themeId,
      },
    });
  }

  /**
   * Updates an existing quote's text and/or themeId.
   * Identity (id, userId, isOriginal, authorName, createdAt) is strictly preserved.
   *
   * @param id The UUID of the quote to update
   * @param data Fields to update
   */
  async update(id: string, data: UpdateQuoteData): Promise<Quote> {
    const updateData: Prisma.QuoteUncheckedUpdateInput = {};

    if (data.text !== undefined) {
      updateData.text = data.text;
    }
    if (data.themeId !== undefined) {
      updateData.themeId = data.themeId;
    }

    return this.db.quote.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Soft-deletes a quote by setting deletedAt to the current timestamp.
   *
   * @param id The UUID of the quote to soft-delete
   */
  async softDelete(id: string): Promise<Quote> {
    return this.db.quote.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves quotes with cursor pagination, optional author or theme filters,
   * excluding soft-deleted quotes.
   */
  async findManyWithPagination(options: {
    limit: number;
    cursor?: { createdAt: Date; id: string };
    userId?: string;
    themeId?: string;
  }): Promise<{ items: Quote[]; hasMore: boolean; nextCursor: string | null }> {
    const take = options.limit;
    const where: Prisma.QuoteWhereInput = {
      deletedAt: null,
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.themeId ? { themeId: options.themeId } : {}),
    };

    if (options.cursor) {
      where.OR = [
        { createdAt: { lt: options.cursor.createdAt } },
        { createdAt: options.cursor.createdAt, id: { lt: options.cursor.id } },
      ];
    }

    const rows = await this.db.quote.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profileImageUrl: true,
          },
        },
        theme: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor(last.createdAt, last.id);
    }

    return { items, hasMore, nextCursor };
  }
}
