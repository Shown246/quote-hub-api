import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "../../../src/shared/utils/cursor";

describe("Cursor Utilities", () => {
  it("should encode and decode a composite cursor accurately", () => {
    const date = new Date("2026-10-07T12:00:00.000Z");
    const id = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    const cursor = encodeCursor(date, id);
    expect(typeof cursor).toBe("string");

    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded?.id).toBe(id);
  });

  it("should return null for malformed or tampered cursor strings", () => {
    expect(decodeCursor("invalid-base64-string!@#$")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("should preserve millisecond precision in encoded timestamps", () => {
    const date = new Date("2026-10-07T12:34:56.789Z");
    const id = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    const cursor = encodeCursor(date, id);

    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.getTime()).toBe(date.getTime());
    expect(decoded?.createdAt.toISOString()).toBe("2026-10-07T12:34:56.789Z");
  });

  it("should produce URL-safe base64 strings without +, /, or = padding", () => {
    const date = new Date("2026-10-07T12:00:00.000Z");
    const id = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    const cursor = encodeCursor(date, id);

    expect(cursor).not.toMatch(/[+/=]/);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should return null for non-string or falsy cursor inputs", () => {
    expect(decodeCursor(null as unknown as string)).toBeNull();
    expect(decodeCursor(undefined as unknown as string)).toBeNull();
    expect(decodeCursor(12345 as unknown as string)).toBeNull();
  });

  it("should return null for valid base64url that is not valid JSON", () => {
    const rawText = "plain-text-payload-not-json";
    const cursor = Buffer.from(rawText, "utf8").toString("base64url");
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("should return null for valid JSON payloads that are not composite cursor objects", () => {
    const nullPayload = Buffer.from(JSON.stringify(null), "utf8").toString("base64url");
    const primitivePayload = Buffer.from(JSON.stringify("hello"), "utf8").toString("base64url");
    const numberPayload = Buffer.from(JSON.stringify(12345), "utf8").toString("base64url");
    const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString("base64url");

    expect(decodeCursor(nullPayload)).toBeNull();
    expect(decodeCursor(primitivePayload)).toBeNull();
    expect(decodeCursor(numberPayload)).toBeNull();
    expect(decodeCursor(arrayPayload)).toBeNull();
  });

  it("should encode cursor payload with ISO string format", () => {
    const date = new Date("2026-10-07T12:00:00.000Z");
    const id = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    const cursor = encodeCursor(date, id);

    const rawPayload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    expect(rawPayload).toEqual({
      t: "2026-10-07T12:00:00.000Z",
      i: id,
    });
    expect(typeof rawPayload.t).toBe("string");
  });

  it("should defensively decode legacy epoch timestamp number in cursor payload", () => {
    const date = new Date("2026-10-07T12:00:00.000Z");
    const id = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    const legacyPayload = Buffer.from(
      JSON.stringify({ t: date.getTime(), i: id }),
      "utf8"
    ).toString("base64url");

    const decoded = decodeCursor(legacyPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded?.id).toBe(id);
  });

  it("should return null when cursor string length exceeds 512 characters", () => {
    const longCursor = "a".repeat(513);
    expect(decodeCursor(longCursor)).toBeNull();
  });

  it("should return null when timestamp or id properties are missing or of invalid type", () => {
    const idOnly = Buffer.from(
      JSON.stringify({ i: "018f972b-5b3a-7d4e-8fa1-0123456789ab" }),
      "utf8"
    ).toString("base64url");
    const timestampOnly = Buffer.from(
      JSON.stringify({ t: "2026-10-07T12:00:00.000Z" }),
      "utf8"
    ).toString("base64url");
    const invalidDateTimestamp = Buffer.from(
      JSON.stringify({ t: "not-a-valid-date", i: "018f972b-5b3a-7d4e-8fa1-0123456789ab" }),
      "utf8"
    ).toString("base64url");
    const nanTimestamp = Buffer.from(
      JSON.stringify({ t: null, i: "018f972b-5b3a-7d4e-8fa1-0123456789ab" }),
      "utf8"
    ).toString("base64url");
    const negativeTimestamp = Buffer.from(
      JSON.stringify({ t: -100, i: "018f972b-5b3a-7d4e-8fa1-0123456789ab" }),
      "utf8"
    ).toString("base64url");

    expect(decodeCursor(idOnly)).toBeNull();
    expect(decodeCursor(timestampOnly)).toBeNull();
    expect(decodeCursor(invalidDateTimestamp)).toBeNull();
    expect(decodeCursor(nanTimestamp)).toBeNull();
    expect(decodeCursor(negativeTimestamp)).toBeNull();
  });

  it("should return null when id is not a valid UUID format", () => {
    const invalidId = Buffer.from(
      JSON.stringify({ t: 1775563200000, i: "not-a-valid-uuid" }),
      "utf8"
    ).toString("base64url");
    const sqlInjectionId = Buffer.from(
      JSON.stringify({ t: 1775563200000, i: "'; DROP TABLE quotes; --" }),
      "utf8"
    ).toString("base64url");

    expect(decodeCursor(invalidId)).toBeNull();
    expect(decodeCursor(sqlInjectionId)).toBeNull();
  });

  it("should return null when cursor contains appended tampering characters", () => {
    const date = new Date("2026-10-07T12:00:00.000Z");
    const id = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    const validCursor = encodeCursor(date, id);

    expect(decodeCursor(validCursor + "!!@@##")).toBeNull();
  });

  it("should throw an error in encodeCursor if invalid date or id is provided", () => {
    const validId = "018f972b-5b3a-7d4e-8fa1-0123456789ab";
    expect(() => encodeCursor(new Date("invalid-date"), validId)).toThrow();
    expect(() => encodeCursor(null as unknown as Date, validId)).toThrow();
    expect(() => encodeCursor(new Date(), "")).toThrow();
    expect(() => encodeCursor(new Date(), null as unknown as string)).toThrow();
  });
});
