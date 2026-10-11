import { uuidv7 } from "uuidv7";

const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates an RFC 9562-compliant UUIDv7 string.
 * UUIDv7 values are monotonically time-ordered, millisecond-precision UUIDs.
 */
export function generateUuidV7(): string {
  return uuidv7();
}

/**
 * Validates whether a given string is a valid UUIDv7 format.
 *
 * @param id The string identifier to validate.
 * @returns True if `id` is a valid UUIDv7, false otherwise.
 */
export function isValidUuidV7(id: string): boolean {
  if (typeof id !== "string") {
    return false;
  }
  return UUIDV7_REGEX.test(id);
}

/**
 * Extracts the chronological timestamp from a valid UUIDv7 string.
 *
 * @param id The UUIDv7 string from which to extract the timestamp.
 * @returns A Date object representing the millisecond-precision timestamp.
 * @throws Error if the supplied id is not a valid UUIDv7.
 */
export function getUuidV7Timestamp(id: string): Date {
  if (!isValidUuidV7(id)) {
    throw new Error(`Invalid UUIDv7: "${id}"`);
  }

  // UUIDv7 stores unix_ts_ms in the leading 48 bits (first 12 hex digits: 8 hex + 4 hex).
  const hexTimestamp = id.slice(0, 8) + id.slice(9, 13);
  const timestampMs = parseInt(hexTimestamp, 16);

  return new Date(timestampMs);
}
