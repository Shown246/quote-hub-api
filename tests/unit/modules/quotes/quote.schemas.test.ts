import { describe, it, expect } from "vitest";
import {
  createQuoteSchema,
  updateQuoteSchema,
  quoteQuerySchema,
  quoteTextSchema,
} from "../../../../src/modules/quotes/schemas/quote.schemas";

describe("quote validation schemas", () => {
  const validThemeId = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
  const validUserId = "018f972b-5b3a-7d4e-8fa1-9876543210fe";

  describe("quoteTextSchema", () => {
    it("should pass for single character text", () => {
      expect(quoteTextSchema.parse("A")).toBe("A");
    });

    it("should pass for 280 ASCII characters", () => {
      const text = "a".repeat(280);
      expect(quoteTextSchema.parse(text)).toBe(text);
    });

    it("should reject 281 ASCII characters", () => {
      const text = "a".repeat(281);
      expect(() => quoteTextSchema.parse(text)).toThrow(
        "Quote text must not exceed 280 characters"
      );
    });

    it("should pass for exactly 280 multibyte Unicode characters (emojis)", () => {
      // Each '🌟' is 2 UTF-16 code units (560 in standard .length) but 1 Unicode code point
      const emojiText = "🌟".repeat(280);
      expect(quoteTextSchema.parse(emojiText)).toBe(emojiText);
    });

    it("should reject 281 multibyte Unicode characters (emojis)", () => {
      const emojiText = "🌟".repeat(281);
      expect(() => quoteTextSchema.parse(emojiText)).toThrow(
        "Quote text must not exceed 280 characters"
      );
    });

    it("should reject empty text", () => {
      expect(() => quoteTextSchema.parse("")).toThrow(
        "Quote text must not be empty"
      );
    });

    it("should reject whitespace-only text", () => {
      expect(() => quoteTextSchema.parse("   \t\n  ")).toThrow(
        "Quote text must not be empty"
      );
    });
  });

  describe("createQuoteSchema validation", () => {
    it("should pass for valid original quote without author", () => {
      const input = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        themeId: validThemeId,
      };
      const parsed = createQuoteSchema.parse(input);
      expect(parsed.text).toBe(input.text);
      expect(parsed.isOriginal).toBe(true);
      expect(parsed.authorName).toBeUndefined();
      expect(parsed.themeId).toBe(validThemeId);
    });

    it("should pass for valid original quote with authorName explicitly null", () => {
      const input = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        authorName: null,
        themeId: validThemeId,
      };
      const parsed = createQuoteSchema.parse(input);
      expect(parsed.isOriginal).toBe(true);
      expect(parsed.authorName).toBeNull();
    });

    it("should reject original quote with authorName provided", () => {
      const input = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        authorName: "Edsger W. Dijkstra",
        themeId: validThemeId,
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Original quotes must not specify an author name"
      );
    });

    it("should reject original quote with empty string authorName", () => {
      const input = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        authorName: "",
        themeId: validThemeId,
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Author name must not be empty"
      );
    });

    it("should reject original quote with whitespace-only authorName", () => {
      const input = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        authorName: "   ",
        themeId: validThemeId,
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Author name must not be empty"
      );
    });

    it("should pass for valid non-original quote with manual authorName", () => {
      const input = {
        text: "Programs must be written for people to read, and only incidentally for machines to execute.",
        isOriginal: false,
        authorName: "Harold Abelson",
        themeId: validThemeId,
      };
      const parsed = createQuoteSchema.parse(input);
      expect(parsed.isOriginal).toBe(false);
      expect(parsed.authorName).toBe("Harold Abelson");
    });

    it("should pass for valid non-original quote without authorName", () => {
      const input = {
        text: "Unknown wisdom.",
        isOriginal: false,
        themeId: validThemeId,
      };
      const parsed = createQuoteSchema.parse(input);
      expect(parsed.isOriginal).toBe(false);
      expect(parsed.authorName).toBeUndefined();
    });

    it("should pass for valid non-original quote with authorName null", () => {
      const input = {
        text: "Anonymous proverb.",
        isOriginal: false,
        authorName: null,
        themeId: validThemeId,
      };
      const parsed = createQuoteSchema.parse(input);
      expect(parsed.isOriginal).toBe(false);
      expect(parsed.authorName).toBeNull();
    });

    it("should reject authorName exceeding 100 characters", () => {
      const input = {
        text: "Some quote",
        isOriginal: false,
        authorName: "A".repeat(101),
        themeId: validThemeId,
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Author name must not exceed 100 characters"
      );
    });

    it("should reject non-original quote with empty string authorName", () => {
      const input = {
        text: "Programs must be written for people to read.",
        isOriginal: false,
        authorName: "",
        themeId: validThemeId,
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Author name must not be empty"
      );
    });

    it("should reject non-original quote with whitespace-only authorName", () => {
      const input = {
        text: "Programs must be written for people to read.",
        isOriginal: false,
        authorName: "   ",
        themeId: validThemeId,
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Author name must not be empty"
      );
    });

    it("should trim manual authorName on non-original quote", () => {
      const input = {
        text: "Programs must be written for people to read.",
        isOriginal: false,
        authorName: "  Harold Abelson  ",
        themeId: validThemeId,
      };
      const parsed = createQuoteSchema.parse(input);
      expect(parsed.authorName).toBe("Harold Abelson");
    });

    it("should reject invalid themeId format", () => {
      const input = {
        text: "Valid text",
        isOriginal: true,
        themeId: "not-a-uuid",
      };
      expect(() => createQuoteSchema.parse(input)).toThrow(
        "Invalid theme ID format"
      );
    });

    it("should reject unexpected fields due to strict mode", () => {
      const input = {
        text: "Valid text",
        isOriginal: true,
        themeId: validThemeId,
        extraField: "malicious",
      };
      expect(() => createQuoteSchema.parse(input)).toThrow();
    });
  });

  describe("updateQuoteSchema validation", () => {
    it("should pass when updating text only", () => {
      const input = { text: "Updated quote text" };
      const parsed = updateQuoteSchema.parse(input);
      expect(parsed.text).toBe("Updated quote text");
      expect(parsed.themeId).toBeUndefined();
    });

    it("should pass when updating themeId only", () => {
      const input = { themeId: validThemeId };
      const parsed = updateQuoteSchema.parse(input);
      expect(parsed.themeId).toBe(validThemeId);
      expect(parsed.text).toBeUndefined();
    });

    it("should pass when updating both text and themeId", () => {
      const input = {
        text: "Updated text with 🚀 emoji",
        themeId: validThemeId,
      };
      const parsed = updateQuoteSchema.parse(input);
      expect(parsed.text).toBe("Updated text with 🚀 emoji");
      expect(parsed.themeId).toBe(validThemeId);
    });

    it("should reject empty update payload", () => {
      expect(() => updateQuoteSchema.parse({})).toThrow(
        "At least one field must be provided to update"
      );
    });

    it("should reject updating text exceeding 280 characters", () => {
      expect(() =>
        updateQuoteSchema.parse({ text: "x".repeat(281) })
      ).toThrow("Quote text must not exceed 280 characters");
    });

    it("should reject updating text with empty or whitespace-only string", () => {
      expect(() => updateQuoteSchema.parse({ text: "   " })).toThrow(
        "Quote text must not be empty"
      );
    });

    it("should reject invalid UUID themeId", () => {
      expect(() => updateQuoteSchema.parse({ themeId: "bad-uuid" })).toThrow(
        "Invalid theme ID format"
      );
    });

    it("should reject attempts to update protected fields (isOriginal, authorName, userId)", () => {
      expect(() =>
        updateQuoteSchema.parse({
          text: "Valid",
          isOriginal: false,
        })
      ).toThrow();

      expect(() =>
        updateQuoteSchema.parse({
          text: "Valid",
          authorName: "Hacked",
        })
      ).toThrow();

      expect(() =>
        updateQuoteSchema.parse({
          text: "Valid",
          userId: validUserId,
        })
      ).toThrow();
    });
  });

  describe("quoteQuerySchema validation", () => {
    it("should pass with empty query", () => {
      const parsed = quoteQuerySchema.parse({});
      expect(parsed).toEqual({});
    });

    it("should coerce string limit to number", () => {
      const parsed = quoteQuerySchema.parse({ limit: "25" });
      expect(parsed.limit).toBe(25);
    });

    it("should pass with numeric limit", () => {
      const parsed = quoteQuerySchema.parse({ limit: 50 });
      expect(parsed.limit).toBe(50);
    });

    it("should reject limit less than 1", () => {
      expect(() => quoteQuerySchema.parse({ limit: 0 })).toThrow(
        "Limit must be at least 1"
      );
      expect(() => quoteQuerySchema.parse({ limit: "-1" })).toThrow(
        "Limit must be at least 1"
      );
    });

    it("should reject limit greater than 100", () => {
      expect(() => quoteQuerySchema.parse({ limit: 101 })).toThrow(
        "Limit cannot exceed 100"
      );
      expect(() => quoteQuerySchema.parse({ limit: "150" })).toThrow(
        "Limit cannot exceed 100"
      );
    });

    it("should reject non-numeric limit", () => {
      expect(() => quoteQuerySchema.parse({ limit: "not-a-number" })).toThrow();
    });

    it("should pass with valid cursor string", () => {
      const parsed = quoteQuerySchema.parse({ cursor: "cursor_eyJpZCI6MTIzfQ" });
      expect(parsed.cursor).toBe("cursor_eyJpZCI6MTIzfQ");
    });

    it("should reject empty cursor string", () => {
      expect(() => quoteQuerySchema.parse({ cursor: "" })).toThrow(
        "Cursor must not be empty"
      );
    });

    it("should pass with valid userId and themeId UUIDs", () => {
      const parsed = quoteQuerySchema.parse({
        userId: validUserId,
        themeId: validThemeId,
      });
      expect(parsed.userId).toBe(validUserId);
      expect(parsed.themeId).toBe(validThemeId);
    });

    it("should reject invalid userId UUID", () => {
      expect(() => quoteQuerySchema.parse({ userId: "invalid-uuid" })).toThrow(
        "Invalid user ID format"
      );
    });

    it("should reject invalid themeId UUID", () => {
      expect(() =>
        quoteQuerySchema.parse({ themeId: "invalid-theme-uuid" })
      ).toThrow("Invalid theme ID format");
    });

    it("should reject unexpected query parameters due to strict mode", () => {
      expect(() =>
        quoteQuerySchema.parse({
          limit: 10,
          unexpectedParam: "value",
        })
      ).toThrow();
    });
  });
});
