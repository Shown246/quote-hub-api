import { describe, it, expect } from "vitest";
import { generateUuidV7, isValidUuidV7, getUuidV7Timestamp } from "../../../src/shared/utils/uuidv7";

describe("UUIDv7 Utilities", () => {
  it("should generate a valid UUIDv7 format", () => {
    const id = generateUuidV7();
    expect(isValidUuidV7(id)).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("should extract chronological timestamp within 5 seconds of now", () => {
    const now = Date.now();
    const id = generateUuidV7();
    const extracted = getUuidV7Timestamp(id).getTime();
    expect(Math.abs(extracted - now)).toBeLessThan(5000);
  });

  it("should generate time-ordered values", () => {
    const id1 = generateUuidV7();
    const id2 = generateUuidV7();
    expect(id1 <= id2).toBe(true);
  });

  it("should maintain monotonic ordering across sequential generations", () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(generateUuidV7());
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i - 1] <= ids[i]).toBe(true);
    }
  });

  describe("isValidUuidV7 validation", () => {
    it("should accept valid lowercase and uppercase UUIDv7 strings", () => {
      const validLower = "0189dcd5-5311-7d40-8db0-9496a2eef37b";
      const validUpper = "0189DCD5-5311-7D40-8DB0-9496A2EEF37B";
      expect(isValidUuidV7(validLower)).toBe(true);
      expect(isValidUuidV7(validUpper)).toBe(true);
    });

    it("should reject non-UUIDv7 strings", () => {
      // UUIDv4 (version 4)
      expect(isValidUuidV7("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
      // Invalid variant (c is 1100, not RFC variant 8,9,a,b)
      expect(isValidUuidV7("0189dcd5-5311-7d40-c000-9496a2eef37b")).toBe(false);
      // Malformed lengths / characters
      expect(isValidUuidV7("not-a-uuid")).toBe(false);
      expect(isValidUuidV7("")).toBe(false);
      expect(isValidUuidV7("0189dcd553117d408db09496a2eef37b")).toBe(false); // missing hyphens
      expect(isValidUuidV7("0189dcd5-5311-7d40-8db0-9496a2eef37bg")).toBe(false); // invalid hex
      expect(isValidUuidV7(null as unknown as string)).toBe(false);
      expect(isValidUuidV7(undefined as unknown as string)).toBe(false);
      expect(isValidUuidV7(12345 as unknown as string)).toBe(false);
    });
  });

  describe("getUuidV7Timestamp extraction", () => {
    it("should extract exact known timestamp from a UUIDv7", () => {
      // 0x0189dcd55311 in ms: 1700123456273
      const knownTimestampMs = 1700123456273;
      const hexTs = knownTimestampMs.toString(16).padStart(12, "0");
      const part1 = hexTs.slice(0, 8);
      const part2 = hexTs.slice(8, 12);
      const testUuid = `${part1}-${part2}-7000-8000-000000000000`;

      const date = getUuidV7Timestamp(testUuid);
      expect(date.getTime()).toBe(knownTimestampMs);
      expect(date.toISOString()).toBe(new Date(knownTimestampMs).toISOString());
    });

    it("should throw an error for invalid UUIDv7 strings", () => {
      expect(() => getUuidV7Timestamp("not-a-uuid")).toThrow(/Invalid UUIDv7/);
      expect(() => getUuidV7Timestamp("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toThrow(/Invalid UUIDv7/);
    });
  });
});
