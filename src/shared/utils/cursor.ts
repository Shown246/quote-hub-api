/**
 * Decoded cursor payload containing composite keys for feed pagination.
 */
export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

/**
 * Standard RFC 4122 / 9562 UUID regex (hex 8-4-4-4-12 representation).
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valid base64url character set regex (RFC 4648 Section 5).
 */
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Encodes a composite cursor `(createdAt, id)` into an opaque base64url string.
 *
 * @param createdAt - The chronological event timestamp.
 * @param id - The unique identifier (UUID) acting as tiebreaker.
 * @returns An opaque base64url encoded cursor string.
 * @throws Error if `createdAt` is an invalid Date or `id` is invalid.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    throw new Error("Invalid createdAt date for cursor encoding");
  }

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Invalid id string for cursor encoding");
  }

  const payload = JSON.stringify({
    t: createdAt.toISOString(),
    i: id,
  });

  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodes and validates an opaque base64url cursor string back into its composite components.
 *
 * Catches any JSON parsing or decoding exceptions, verifies the base64url encoding,
 * validates that the timestamp is a valid ISO date string (or defensive epoch number),
 * and ensures the ID matches standard UUID format.
 *
 * @param cursorStr - The base64url cursor string received from an API client.
 * @returns The decoded cursor object `{ createdAt, id }` or `null` if malformed/tampered.
 */
export function decodeCursor(cursorStr: string): DecodedCursor | null {
  if (
    typeof cursorStr !== "string" ||
    cursorStr.length === 0 ||
    cursorStr.length > 512
  ) {
    return null;
  }

  if (!BASE64URL_REGEX.test(cursorStr)) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(cursorStr, "base64url").toString("utf8");
    const parsed = JSON.parse(jsonStr);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const { t, i } = parsed;

    let createdAt: Date;
    if (typeof t === "string" && !isNaN(Date.parse(t))) {
      createdAt = new Date(t);
    } else if (
      typeof t === "number" &&
      Number.isFinite(t) &&
      !Number.isNaN(t) &&
      t > 0
    ) {
      createdAt = new Date(t);
    } else {
      return null;
    }

    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }

    if (typeof i !== "string" || !UUID_REGEX.test(i)) {
      return null;
    }

    return {
      createdAt,
      id: i,
    };
  } catch {
    return null;
  }
}
