import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  validateAvatarContentType,
  generatePresignedUploadUrl,
  generateAvatarUploadUrl,
  normalizeToWebP,
  processAndNormalizeAvatar,
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_SIZE_BYTES,
  MIME_TO_EXTENSION_MAP,
} from "../../../../src/modules/media/services/avatar.service";
import { ValidationError } from "../../../../src/shared/errors/problem-details";

describe("Avatar Processing Service", () => {
  describe("validateAvatarContentType", () => {
    it("should accept valid image types (jpeg, png, webp)", () => {
      expect(validateAvatarContentType("image/jpeg")).toBe(true);
      expect(validateAvatarContentType("image/png")).toBe(true);
      expect(validateAvatarContentType("image/webp")).toBe(true);
    });

    it("should reject disallowed types", () => {
      expect(validateAvatarContentType("application/pdf")).toBe(false);
      expect(validateAvatarContentType("image/gif")).toBe(false);
      expect(validateAvatarContentType("image/svg+xml")).toBe(false);
      expect(validateAvatarContentType("text/plain")).toBe(false);
      expect(validateAvatarContentType("")).toBe(false);
    });

    it("should export allowed mime types, max avatar size constants, and mime to extension map", () => {
      expect(ALLOWED_AVATAR_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
      expect(MAX_AVATAR_SIZE_BYTES).toBe(5 * 1024 * 1024);
      expect(MIME_TO_EXTENSION_MAP).toEqual({
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      });
    });
  });

  describe("generatePresignedUploadUrl", () => {
    it("should throw ValidationError when invalid content type is provided", async () => {
      await expect(
        generatePresignedUploadUrl("user-123", "application/pdf")
      ).rejects.toThrow(ValidationError);
    });

    it("should throw ValidationError when contentLength exceeds 5MB limit", async () => {
      const oversizedLength = MAX_AVATAR_SIZE_BYTES + 1;
      await expect(
        generatePresignedUploadUrl("user-123", "image/png", oversizedLength)
      ).rejects.toThrow(ValidationError);

      await expect(
        generatePresignedUploadUrl("user-123", "image/png", oversizedLength)
      ).rejects.toThrow("File size exceeds 5MB limit");
    });

    it("should accept valid contentLength within 5MB limit", async () => {
      const validLength = 1024 * 1024; // 1MB
      const result = await generatePresignedUploadUrl("user-123", "image/jpeg", validLength);
      expect(result.uploadUrl).toBeDefined();
    });

    it("should generate raw upload key with matching extension based on MIME type", async () => {
      const userId = "01923456-7890-7abc-def0-123456789abc";

      const pngResult = await generatePresignedUploadUrl(userId, "image/png");
      expect(pngResult.key).toMatch(new RegExp(`^uploads/avatars/${userId}/\\d+\\.png$`));

      const jpegResult = await generatePresignedUploadUrl(userId, "image/jpeg");
      expect(jpegResult.key).toMatch(new RegExp(`^uploads/avatars/${userId}/\\d+\\.jpg$`));

      const webpResult = await generatePresignedUploadUrl(userId, "image/webp");
      expect(webpResult.key).toMatch(new RegExp(`^uploads/avatars/${userId}/\\d+\\.webp$`));
    });

    it("should export generateAvatarUploadUrl alias with identical behavior", async () => {
      const userId = "user-alias-456";
      const result = await generateAvatarUploadUrl(userId, "image/jpeg");

      expect(result.uploadUrl).toBeDefined();
      expect(result.key).toMatch(new RegExp(`^uploads/avatars/${userId}/\\d+\\.jpg$`));
    });
  });

  describe("normalizeToWebP and processAndNormalizeAvatar", () => {
    it("should throw ValidationError if sourceBuffer is empty", async () => {
      await expect(normalizeToWebP(Buffer.alloc(0))).rejects.toThrow(ValidationError);
      await expect(normalizeToWebP(Buffer.alloc(0))).rejects.toThrow("Avatar buffer cannot be empty");
    });

    it("should throw ValidationError if sourceBuffer exceeds MAX_AVATAR_SIZE_BYTES", async () => {
      const oversizedBuffer = Buffer.alloc(MAX_AVATAR_SIZE_BYTES + 1);
      await expect(normalizeToWebP(oversizedBuffer)).rejects.toThrow(ValidationError);
      await expect(normalizeToWebP(oversizedBuffer)).rejects.toThrow("File size exceeds 5MB limit");
    });

    it("should throw ValidationError if sourceBuffer is not a valid image format", async () => {
      const corruptBuffer = Buffer.from("this is not an image file");
      await expect(normalizeToWebP(corruptBuffer)).rejects.toThrow(ValidationError);
      await expect(normalizeToWebP(corruptBuffer)).rejects.toThrow(/Failed to process avatar image/);
    });

    it("should transform a valid image buffer into 400x400 WebP format", async () => {
      // Create a test 100x50 PNG image buffer
      const testBuffer = await sharp({
        create: {
          width: 100,
          height: 50,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const normalizedBuffer = await normalizeToWebP(testBuffer);
      expect(Buffer.isBuffer(normalizedBuffer)).toBe(true);

      const metadata = await sharp(normalizedBuffer).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(400);
      expect(metadata.height).toBe(400);
    });

    it("should process and normalize avatar via processAndNormalizeAvatar", async () => {
      // Create a test 200x200 JPEG image buffer
      const testBuffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 0, g: 128, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      const processedBuffer = await processAndNormalizeAvatar(testBuffer);
      expect(Buffer.isBuffer(processedBuffer)).toBe(true);

      const metadata = await sharp(processedBuffer).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(400);
      expect(metadata.height).toBe(400);
    });
  });
});
