import { z } from "zod";

/**
 * Validates quote text:
 * - Must not be empty or contain only whitespace (char_length(trim(text)) >= 1)
 * - Must not exceed 280 Unicode characters (char_length(text) <= 280)
 * - Multibyte Unicode sequences (emojis, code points) are counted accurately
 *   using array spreading `[...val].length` to match PostgreSQL `char_length`.
 */
export const quoteTextSchema = z
  .string({ required_error: "Quote text is required" })
  .refine((val) => [...val.trim()].length >= 1, {
    message: "Quote text must not be empty",
  })
  .refine((val) => [...val].length <= 280, {
    message: "Quote text must not exceed 280 characters",
  });

/**
 * Validates quote creation payloads:
 * - text: 1 to 280 Unicode characters
 * - isOriginal: boolean indicating if quote is by the posting user
 * - authorName: optional manual author text (max 100 characters) or null
 * - themeId: UUID of the visual theme
 * - Attribution Invariant: if `isOriginal: true`, `authorName` must be null or undefined.
 * - .strict() prevents unexpected fields from being passed.
 */
export const createQuoteSchema = z
  .object({
    text: quoteTextSchema,
    isOriginal: z.boolean({ required_error: "isOriginal is required" }),
    authorName: z
      .string()
      .trim()
      .min(1, "Author name must not be empty")
      .max(100, "Author name must not exceed 100 characters")
      .nullable()
      .optional(),
    themeId: z.string().uuid("Invalid theme ID format"),
  })
  .strict()
  .refine((data) => !data.isOriginal || data.authorName == null, {
    message: "Original quotes must not specify an author name",
    path: ["authorName"],
  });

export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;

/**
 * Validates quote update payloads:
 * - text: optional, 1 to 280 Unicode characters
 * - themeId: optional UUID
 * - .strict() ensures fields like isOriginal, authorName, or userId cannot be modified.
 */
export const updateQuoteSchema = z
  .object({
    text: quoteTextSchema.optional(),
    themeId: z.string().uuid("Invalid theme ID format").optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided to update",
  });

export type UpdateQuoteDto = z.infer<typeof updateQuoteSchema>;

/**
 * Validates quote query / feed parameters:
 * - limit: optional integer between 1 and 100
 * - cursor: optional opaque pagination cursor string
 * - userId: optional UUID filter for quotes by specific author
 * - themeId: optional UUID filter for quotes by theme
 */
export const quoteQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1, "Limit must be at least 1")
      .max(100, "Limit cannot exceed 100")
      .optional(),
    cursor: z.string().min(1, "Cursor must not be empty").optional(),
    userId: z.string().uuid("Invalid user ID format").optional(),
    themeId: z.string().uuid("Invalid theme ID format").optional(),
    type: z.enum(["quotes", "reposts"]).optional(),
  })
  .strict();

export type QuoteQueryDto = z.infer<typeof quoteQuerySchema>;
