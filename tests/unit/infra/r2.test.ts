import { describe, it, expect } from "vitest";
import { r2Client, generatePresignedUploadUrl } from "../../../src/infrastructure/storage/r2";
import { S3Client } from "@aws-sdk/client-s3";

describe("Cloudflare R2 Storage Infrastructure", () => {
  it("should instantiate an S3Client configured for R2", () => {
    expect(r2Client).toBeDefined();
    expect(r2Client).toBeInstanceOf(S3Client);
  });

  it("should generate a presigned PUT upload url with default 300s expiry", async () => {
    const key = "test/path/image.webp";
    const contentType = "image/webp";

    const presignedUrl = await generatePresignedUploadUrl(key, contentType);

    expect(typeof presignedUrl).toBe("string");
    expect(presignedUrl).toContain("https://");
    expect(presignedUrl).toContain("X-Amz-Signature");
    expect(presignedUrl).toContain("X-Amz-Expires=300");
  });

  it("should generate a presigned PUT upload url with custom expiry", async () => {
    const key = "test/path/custom.webp";
    const contentType = "image/png";

    const presignedUrl = await generatePresignedUploadUrl(key, contentType, 600);

    expect(presignedUrl).toContain("X-Amz-Expires=600");
  });
});
