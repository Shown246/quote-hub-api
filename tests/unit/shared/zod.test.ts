import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatZodErrors } from "../../../src/shared/utils/zod";

describe("formatZodErrors", () => {
  it("should format standard field path errors into an array of messages", () => {
    const schema = z.object({
      username: z.string().min(3, "Too short"),
      age: z.number().int().min(18, "Must be an adult"),
    });

    const result = schema.safeParse({ username: "a", age: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodErrors(result.error);
      expect(formatted).toEqual({
        username: ["Too short"],
        age: ["Must be an adult"],
      });
    }
  });

  it("should format nested path errors with dot notation", () => {
    const schema = z.object({
      profile: z.object({
        bio: z.string().max(10, "Bio too long"),
      }),
    });

    const result = schema.safeParse({ profile: { bio: "This bio is way too long" } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodErrors(result.error);
      expect(formatted).toEqual({
        "profile.bio": ["Bio too long"],
      });
    }
  });

  it("should map top-level refinement error without path to '_general'", () => {
    const schema = z
      .object({
        a: z.string().optional(),
        b: z.string().optional(),
      })
      .refine((data) => Boolean(data.a || data.b), {
        message: "At least one property must be provided",
      });

    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodErrors(result.error);
      expect(formatted).toEqual({
        _general: ["At least one property must be provided"],
      });
    }
  });

  it("should map unrecognized keys issue to issue.keys joined by dot if path is empty", () => {
    const schema = z.object({ a: z.string() }).strict();
    const result = schema.safeParse({ a: "valid", extraKey: "surprise" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodErrors(result.error);
      expect(formatted.extraKey).toBeDefined();
    }
  });
});
