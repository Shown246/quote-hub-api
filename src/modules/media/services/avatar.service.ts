import sharp from "sharp";
import { generatePresignedUploadUrl as r2GeneratePresignedUploadUrl } from "../../../infrastructure/storage/r2";
import { ValidationError } from "../../../shared/errors/problem-details";

export const ALLOWED_AVATAR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedAvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const MIME_TO_EXTENSION_MAP: Record<AllowedAvatarMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validates whether the provided MIME content type is allowed for avatar uploads.
 */
export function validateAvatarContentType(contentType: string): boolean {
  return ALLOWED_AVATAR_MIME_TYPES.includes(contentType as AllowedAvatarMimeType);
}

/**
 * Generates a presigned Cloudflare R2 upload URL and raw object key for a user's avatar upload.
 * Validates MIME type and optional contentLength before generating the upload URL.
 * Keys use the raw format `uploads/avatars/${userId}/${Date.now()}.${extension}` so un-normalized
 * uploads are not saved directly as .webp files before Sharp processing.
 */
export async function generatePresignedUploadUrl(
  userId: string,
  contentType: string,
  contentLength?: number
): Promise<{ uploadUrl: string; key: string }> {
  if (!validateAvatarContentType(contentType)) {
    throw new ValidationError(
      `Unsupported content type: '${contentType}'. Allowed types: ${ALLOWED_AVATAR_MIME_TYPES.join(", ")}`
    );
  }

  if (contentLength !== undefined && contentLength > MAX_AVATAR_SIZE_BYTES) {
    throw new ValidationError("File size exceeds 5MB limit");
  }

  const extension = MIME_TO_EXTENSION_MAP[contentType as AllowedAvatarMimeType];
  const key = `uploads/avatars/${userId}/${Date.now()}.${extension}`;
  const uploadUrl = await r2GeneratePresignedUploadUrl(key, contentType, 300);

  return { uploadUrl, key };
}

/**
 * Alias for generatePresignedUploadUrl.
 */
export const generateAvatarUploadUrl = generatePresignedUploadUrl;

/**
 * Normalizes an uploaded image buffer to 400x400 WebP format with 80% quality.
 * Validates that the buffer is non-empty and does not exceed the 5MB limit.
 * Wraps any Sharp processing errors into a ValidationError.
 */
export async function normalizeToWebP(sourceBuffer: Buffer): Promise<Buffer> {
  if (!sourceBuffer || sourceBuffer.length === 0) {
    throw new ValidationError("Avatar buffer cannot be empty");
  }

  if (sourceBuffer.length > MAX_AVATAR_SIZE_BYTES) {
    throw new ValidationError("File size exceeds 5MB limit");
  }

  try {
    return await sharp(sourceBuffer)
      .resize(400, 400, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    throw new ValidationError(
      `Failed to process avatar image: ${err instanceof Error ? err.message : "Invalid image format"}`
    );
  }
}

/**
 * Delegates to normalizeToWebP for processing and normalizing avatar images.
 */
export async function processAndNormalizeAvatar(
  sourceBuffer: Buffer
): Promise<Buffer> {
  return normalizeToWebP(sourceBuffer);
}
