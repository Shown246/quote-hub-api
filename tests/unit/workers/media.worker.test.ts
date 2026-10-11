import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { UnrecoverableError } from "bullmq";
import {
  processMediaJob,
  startMediaWorker,
  stopMediaWorker,
  resolveAvatarCdnUrl,
  streamToBuffer,
  MEDIA_QUEUE_NAME,
} from "../../../src/workers/media.worker";
import { r2Client } from "../../../src/infrastructure/storage/r2";
import { prisma } from "../../../src/infrastructure/database/prisma";
import * as bullmqModule from "../../../src/infrastructure/queue/bullmq";
import { env } from "../../../src/app/config/env";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

describe("Media Worker", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await stopMediaWorker();
  });

  describe("resolveAvatarCdnUrl", () => {
    it("uses R2_PUBLIC_DOMAIN when defined", () => {
      const original = (env as any).R2_PUBLIC_DOMAIN;
      try {
        (env as any).R2_PUBLIC_DOMAIN = "cdn.example.com";
        const url = resolveAvatarCdnUrl("profiles/u1/123.webp");
        expect(url).toBe("https://cdn.example.com/profiles/u1/123.webp");
      } finally {
        (env as any).R2_PUBLIC_DOMAIN = original;
      }
    });

    it("strips protocol and trailing slashes from R2_PUBLIC_DOMAIN", () => {
      const original = (env as any).R2_PUBLIC_DOMAIN;
      try {
        (env as any).R2_PUBLIC_DOMAIN = "https://cdn.example.com/";
        const url = resolveAvatarCdnUrl("profiles/u1/123.webp");
        expect(url).toBe("https://cdn.example.com/profiles/u1/123.webp");
      } finally {
        (env as any).R2_PUBLIC_DOMAIN = original;
      }
    });

    it("uses env.R2_PUBLIC_URL when R2_PUBLIC_DOMAIN is not defined", () => {
      const originalDomain = (env as any).R2_PUBLIC_DOMAIN;
      delete (env as any).R2_PUBLIC_DOMAIN;
      const url = resolveAvatarCdnUrl("profiles/u1/123.webp");
      // env.R2_PUBLIC_URL in test defaults is 'https://media.quotehub.com'
      expect(url).toBe("https://media.quotehub.com/profiles/u1/123.webp");
      (env as any).R2_PUBLIC_DOMAIN = originalDomain;
    });

    it("falls back to media.quote-hub.local when neither domain nor public URL is present", () => {
      const originalDomain = (env as any).R2_PUBLIC_DOMAIN;
      const originalUrl = env.R2_PUBLIC_URL;
      try {
        delete (env as any).R2_PUBLIC_DOMAIN;
        (env as any).R2_PUBLIC_URL = undefined;
        const url = resolveAvatarCdnUrl("profiles/u1/123.webp");
        expect(url).toBe("https://media.quote-hub.local/profiles/u1/123.webp");
      } finally {
        (env as any).R2_PUBLIC_DOMAIN = originalDomain;
        (env as any).R2_PUBLIC_URL = originalUrl;
      }
    });
  });

  describe("streamToBuffer", () => {
    it("returns the buffer directly if input is already a Buffer", async () => {
      const buf = Buffer.from("test");
      const result = await streamToBuffer(buf);
      expect(result).toBe(buf);
    });

    it("handles objects with transformToByteArray (AWS SDK v3 Body)", async () => {
      const uint8 = new Uint8Array([1, 2, 3, 4]);
      const mockBody = {
        transformToByteArray: vi.fn().mockResolvedValue(uint8),
      };
      const result = await streamToBuffer(mockBody);
      expect(result).toEqual(Buffer.from(uint8));
    });

    it("handles async iterable streams", async () => {
      async function* generateChunks() {
        yield Buffer.from("hello ");
        yield Buffer.from("world");
      }
      const result = await streamToBuffer(generateChunks());
      expect(result.toString("utf-8")).toBe("hello world");
    });

    it("handles raw Uint8Array input", async () => {
      const uint8 = new Uint8Array([10, 20, 30]);
      const result = await streamToBuffer(uint8);
      expect(result).toEqual(Buffer.from([10, 20, 30]));
    });

    it("throws if body is empty or undefined", async () => {
      await expect(streamToBuffer(null)).rejects.toThrow("S3 object body is empty or undefined");
    });

    it("throws if body cannot be converted", async () => {
      await expect(streamToBuffer({ invalid: true })).rejects.toThrow("Unable to convert S3 response body to Buffer");
    });
  });

  describe("processMediaJob", () => {
    it("successfully processes valid avatar upload: downloads, normalizes to 400x400 webp, uploads, updates user, deletes temp", async () => {
      const userId = "01923456-7890-7abc-def0-123456789abc";
      const tempKey = `uploads/avatars/${userId}/raw-avatar.png`;

      // Generate a real sample image buffer
      const samplePng = await sharp({
        create: {
          width: 200,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const sendCalls: any[] = [];
      const sendSpy = vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        sendCalls.push(command);
        if (command instanceof GetObjectCommand) {
          return {
            Body: {
              transformToByteArray: async () => new Uint8Array(samplePng),
            },
          } as any;
        }
        if (command instanceof PutObjectCommand) {
          return {} as any;
        }
        if (command instanceof DeleteObjectCommand) {
          return {} as any;
        }
        return {} as any;
      });

      const userUpdateSpy = vi.spyOn(prisma.user, "update").mockResolvedValue({
        id: userId,
        profileImageUrl: "https://media.quotehub.com/profiles/...",
      } as any);

      const mockJob = {
        id: "media-job-1",
        data: {
          userId,
          tempKey,
        },
      } as any;

      await processMediaJob(mockJob);

      // Verify GetObjectCommand was executed
      const getCmd = sendCalls.find((cmd) => cmd instanceof GetObjectCommand);
      expect(getCmd).toBeDefined();
      expect(getCmd.input.Bucket).toBe(env.R2_BUCKET_NAME || "quotehub-avatars");
      expect(getCmd.input.Key).toBe(tempKey);

      // Verify PutObjectCommand was executed with normalized WebP
      const putCmd = sendCalls.find((cmd) => cmd instanceof PutObjectCommand);
      expect(putCmd).toBeDefined();
      expect(putCmd.input.Bucket).toBe(env.R2_BUCKET_NAME || "quotehub-avatars");
      expect(putCmd.input.Key).toMatch(new RegExp(`^profiles/${userId}/\\d+\\.webp$`));
      expect(putCmd.input.ContentType).toBe("image/webp");

      // Verify the put buffer is indeed a 400x400 webp
      const putMetadata = await sharp(putCmd.input.Body).metadata();
      expect(putMetadata.format).toBe("webp");
      expect(putMetadata.width).toBe(400);
      expect(putMetadata.height).toBe(400);

      // Verify prisma.user.update was called with the resolved CDN URL
      expect(userUpdateSpy).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          profileImageUrl: expect.stringMatching(new RegExp(`^https://media\\.quotehub\\.com/profiles/${userId}/\\d+\\.webp$`)),
        },
      });

      // Verify DeleteObjectCommand was executed to clean up temporary object
      const deleteCmd = sendCalls.find((cmd) => cmd instanceof DeleteObjectCommand);
      expect(deleteCmd).toBeDefined();
      expect(deleteCmd.input.Bucket).toBe(env.R2_BUCKET_NAME || "quotehub-avatars");
      expect(deleteCmd.input.Key).toBe(tempKey);
    });

    it("supports 'key' as alternative to 'tempKey' and 'user_id' for userId", async () => {
      const userId = "user-alt-key-123";
      const key = `uploads/avatars/${userId}/avatar.jpg`;

      const sampleJpeg = await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 3,
          background: { r: 0, g: 255, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        if (command instanceof GetObjectCommand) {
          return { Body: sampleJpeg } as any;
        }
        return {} as any;
      });

      const userUpdateSpy = vi.spyOn(prisma.user, "update").mockResolvedValue({} as any);

      const mockJob = {
        id: "media-job-2",
        data: {
          user_id: userId,
          key,
        },
      } as any;

      await processMediaJob(mockJob);

      expect(userUpdateSpy).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          profileImageUrl: expect.stringContaining(`profiles/${userId}/`),
        },
      });
    });

    it("handles stringified JSON job data payload", async () => {
      const userId = "user-stringified-789";
      const tempKey = `uploads/avatars/${userId}/photo.png`;

      const samplePng = await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .png()
        .toBuffer();

      vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        if (command instanceof GetObjectCommand) {
          return { Body: samplePng } as any;
        }
        return {} as any;
      });

      const userUpdateSpy = vi.spyOn(prisma.user, "update").mockResolvedValue({} as any);

      const mockJob = {
        id: "media-job-3",
        data: JSON.stringify({
          userId,
          tempKey,
        }),
      } as any;

      await processMediaJob(mockJob);

      expect(userUpdateSpy).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          profileImageUrl: expect.stringContaining(`profiles/${userId}/`),
        },
      });
    });

    it("skips processing when userId or tempKey is missing", async () => {
      const sendSpy = vi.spyOn(r2Client, "send");
      const userUpdateSpy = vi.spyOn(prisma.user, "update");

      const mockJob = {
        id: "media-job-missing",
        data: {
          userId: "user-without-key",
        },
      } as any;

      await processMediaJob(mockJob);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(userUpdateSpy).not.toHaveBeenCalled();
    });

    it("Review Focus #3: When Sharp fails on corrupt image bytes, cleans up temporary object, DOES NOT update user's profileImageUrl, and throws UnrecoverableError", async () => {
      const userId = "user-corrupt-bytes";
      const tempKey = `uploads/avatars/${userId}/corrupted.png`;
      const corruptBytes = Buffer.from("NOT_A_VALID_IMAGE_DATA_BYTES");

      const deleteCalls: any[] = [];
      vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        if (command instanceof GetObjectCommand) {
          return { Body: corruptBytes } as any;
        }
        if (command instanceof DeleteObjectCommand) {
          deleteCalls.push(command);
          return {} as any;
        }
        return {} as any;
      });

      const userUpdateSpy = vi.spyOn(prisma.user, "update");

      const mockJob = {
        id: "media-job-corrupt",
        data: {
          userId,
          tempKey,
        },
      } as any;

      // Must throw UnrecoverableError so BullMQ does not retry corrupt image bytes endlessly
      await expect(processMediaJob(mockJob)).rejects.toThrow(UnrecoverableError);

      // Crucial: user profileImageUrl MUST NOT be touched (preserves existing avatar URL)
      expect(userUpdateSpy).not.toHaveBeenCalled();

      // Temporary object should be cleaned up
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0].input.Key).toBe(tempKey);
    });

    it("When download from R2 fails, DOES NOT update user's profileImageUrl and propagates error", async () => {
      const userId = "user-download-fail";
      const tempKey = `uploads/avatars/${userId}/missing.png`;

      vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        if (command instanceof GetObjectCommand) {
          throw new Error("R2 NoSuchKey: The specified key does not exist");
        }
        return {} as any;
      });

      const userUpdateSpy = vi.spyOn(prisma.user, "update");

      const mockJob = {
        id: "media-job-download-fail",
        data: {
          userId,
          tempKey,
        },
      } as any;

      await expect(processMediaJob(mockJob)).rejects.toThrow("R2 NoSuchKey");
      expect(userUpdateSpy).not.toHaveBeenCalled();
    });

    it("When database update fails, propagates error for job retry", async () => {
      const userId = "user-db-fail";
      const tempKey = `uploads/avatars/${userId}/avatar.png`;

      const samplePng = await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .png()
        .toBuffer();

      vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        if (command instanceof GetObjectCommand) {
          return { Body: samplePng } as any;
        }
        return {} as any;
      });

      vi.spyOn(prisma.user, "update").mockRejectedValue(new Error("Database connection closed"));

      const mockJob = {
        id: "media-job-db-fail",
        data: {
          userId,
          tempKey,
        },
      } as any;

      await expect(processMediaJob(mockJob)).rejects.toThrow("Database connection closed");
    });

    it("Gracefully logs warning if deleting temporary object fails after successful processing", async () => {
      const userId = "user-delete-warn";
      const tempKey = `uploads/avatars/${userId}/temp.png`;

      const samplePng = await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 3,
          background: { r: 50, g: 50, b: 50 },
        },
      })
        .png()
        .toBuffer();

      vi.spyOn(r2Client, "send").mockImplementation(async (command: any) => {
        if (command instanceof GetObjectCommand) {
          return { Body: samplePng } as any;
        }
        if (command instanceof DeleteObjectCommand) {
          throw new Error("S3 Delete failed transiently");
        }
        return {} as any;
      });

      const userUpdateSpy = vi.spyOn(prisma.user, "update").mockResolvedValue({} as any);

      const mockJob = {
        id: "media-job-delete-warn",
        data: {
          userId,
          tempKey,
        },
      } as any;

      // Does not throw because image was processed and user was updated
      await expect(processMediaJob(mockJob)).resolves.not.toThrow();
      expect(userUpdateSpy).toHaveBeenCalled();
    });
  });

  describe("startMediaWorker and stopMediaWorker", () => {
    it("creates worker on 'media-queue' and closes worker on stop", async () => {
      const mockWorker = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const createWorkerSpy = vi
        .spyOn(bullmqModule, "createWorker")
        .mockReturnValue(mockWorker as any);

      const worker1 = startMediaWorker();
      expect(createWorkerSpy).toHaveBeenCalledWith(
        MEDIA_QUEUE_NAME,
        processMediaJob,
        undefined
      );
      expect(worker1).toBe(mockWorker);

      // Reuses worker instance
      const worker2 = startMediaWorker();
      expect(worker2).toBe(mockWorker);
      expect(createWorkerSpy).toHaveBeenCalledTimes(1);

      await stopMediaWorker();
      expect(mockWorker.close).toHaveBeenCalled();

      // After stopping, startMediaWorker creates a new one
      startMediaWorker();
      expect(createWorkerSpy).toHaveBeenCalledTimes(2);
    });
  });
});
