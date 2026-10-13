import { Quote } from "@prisma/client";
import { QuoteRepository } from "../repositories/quote.repository";
import { ThemeRepository } from "../../themes/repositories/theme.repository";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { CreateQuoteDto, UpdateQuoteDto, QuoteQueryDto } from "../schemas/quote.schemas";
import { decodeCursor } from "../../../shared/utils/cursor";
import { safeRedisCall } from "../../../infrastructure/redis/redis";
import { getOrSetCache, invalidateCache } from "../../../infrastructure/redis/cache";
import { TRENDING_REDIS_KEY } from "../../trending/services/trending.service";

export class QuoteService {
  constructor(
    private readonly quoteRepo: QuoteRepository = new QuoteRepository(),
    private readonly themeRepo: ThemeRepository = new ThemeRepository(),
    private readonly safeCall: typeof safeRedisCall = safeRedisCall
  ) {}

  /**
   * Creates a new quote.
   * Generates a UUIDv7 for quote identity, verifies the target theme exists and is active,
   * and enforces author attribution invariants.
   *
   * @param userId The ID of the authenticated author
   * @param dto Validated quote creation data
   */
  async createQuote(userId: string, dto: CreateQuoteDto): Promise<Quote> {
    const theme = await this.themeRepo.findById(dto.themeId);
    if (!theme) {
      throw new NotFoundError("Theme not found");
    }
    if (!theme.isActive) {
      throw new ValidationError("Theme is inactive");
    }

    if (dto.isOriginal && dto.authorName) {
      throw new ValidationError("Original quotes must not specify an author name");
    }

    const id = generateUuidV7();

    return this.quoteRepo.create({
      id,
      userId,
      text: dto.text,
      isOriginal: dto.isOriginal,
      authorName: dto.isOriginal ? null : (dto.authorName ?? null),
      themeId: dto.themeId,
    });
  }

  /**
   * Retrieves an active quote by its unique UUID.
   * Soft-deleted quotes are excluded and result in a NotFoundError.
   *
   * @param id The quote UUID
   * @throws NotFoundError if the quote does not exist or has been soft-deleted
   */
  async getQuoteById(id: string): Promise<Quote> {
    const quote = await getOrSetCache(`cache:quote:${id}`, 600, async () => {
      const q = await this.quoteRepo.findById(id);
      if (!q || q.deletedAt !== null) {
        throw new NotFoundError("Quote not found");
      }
      return q;
    });

    if (quote) {
      if (quote.createdAt) quote.createdAt = new Date(quote.createdAt);
      if (quote.updatedAt) quote.updatedAt = new Date(quote.updatedAt);
      if (quote.deletedAt) quote.deletedAt = new Date(quote.deletedAt);
    }

    return quote;
  }

  /**
   * Updates an existing quote's text and/or visual theme.
   * Strictly verifies that the requesting user is the quote's author.
   * Preserves immutable identity fields (id, userId, isOriginal, authorName, createdAt).
   *
   * @param userId The ID of the requesting user
   * @param id The UUID of the quote to update
   * @param dto Validated update data
   * @throws NotFoundError if the quote does not exist or is soft-deleted
   * @throws AuthorizationError if the requesting user is not the owner
   * @throws NotFoundError if the updated themeId does not exist
   * @throws ValidationError if the updated theme is inactive
   */
  async updateQuote(
    userId: string,
    id: string,
    dto: UpdateQuoteDto
  ): Promise<Quote> {
    const quote = await this.quoteRepo.findById(id);
    if (!quote || quote.deletedAt !== null) {
      throw new NotFoundError("Quote not found");
    }

    if (quote.userId !== userId) {
      throw new AuthorizationError(
        "Forbidden: You do not have permission to modify this quote",
        "FORBIDDEN"
      );
    }

    if (dto.themeId !== undefined) {
      const theme = await this.themeRepo.findById(dto.themeId);
      if (!theme) {
        throw new NotFoundError("Theme not found");
      }
      if (!theme.isActive) {
        throw new ValidationError("Theme is inactive");
      }
    }

    const updated = await this.quoteRepo.update(id, {
      text: dto.text,
      themeId: dto.themeId,
    });

    await invalidateCache(`cache:quote:${id}`);

    return updated;
  }

  /**
   * Soft-deletes an existing quote by recording the deletedAt timestamp.
   * Strictly verifies that the requesting user is the quote's author.
   *
   * @param userId The ID of the requesting user
   * @param id The UUID of the quote to delete
   * @throws NotFoundError if the quote does not exist or is soft-deleted
   * @throws AuthorizationError if the requesting user is not the owner
   */
  async deleteQuote(userId: string, id: string): Promise<Quote> {
    const quote = await this.quoteRepo.findById(id);
    if (!quote || quote.deletedAt !== null) {
      throw new NotFoundError("Quote not found");
    }

    if (quote.userId !== userId) {
      throw new AuthorizationError(
        "Forbidden: You do not have permission to modify this quote",
        "FORBIDDEN"
      );
    }

    const deleted = await this.quoteRepo.softDelete(id);

    await invalidateCache(`cache:quote:${id}`);

    // Invalidate Redis trending sorted set cache per TDD § 101
    await this.safeCall(
      async (client) => {
        if (client) {
          await client.zrem(TRENDING_REDIS_KEY, id);
        }
      },
      async () => {}
    );

    return deleted;
  }

  /**
   * Retrieves quotes with cursor pagination, optional author or theme filters.
   * Conforms to TDD §§ 13, 74, 91, 92.
   */
  async listQuotes(query: QuoteQueryDto): Promise<{
    data: Quote[];
    pagination: { nextCursor: string | null; hasMore: boolean };
  }> {
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded) {
        throw new ValidationError("Invalid pagination cursor");
      }
      decodedCursor = decoded;
    }

    const { items, hasMore, nextCursor } = await this.quoteRepo.findManyWithPagination({
      limit,
      cursor: decodedCursor,
      userId: query.userId,
      themeId: query.themeId,
    });

    return {
      data: items,
      pagination: { nextCursor, hasMore },
    };
  }
}
