import { Job, Worker, WorkerOptions, UnrecoverableError } from "bullmq";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createWorker } from "../infrastructure/queue/bullmq";
import { r2Client } from "../infrastructure/storage/r2";
import { normalizeToWebP } from "../modules/media/services/avatar.service";
import { prisma } from "../infrastructure/database/prisma";
import { env } from "../app/config/env";
import { logger } from "../infrastructure/logging/logger";

export const MEDIA_QUEUE_NAME = "media-queue";

export interface MediaJobPayload {
  userId?: string;
  user_id?: string;
  tempKey?: string;
  key?: string;
  temp_key?: string;
  [key: string]: any;
}

/**
 * Converts various S3 response body types (ReadableStream, Node.js Readable stream,
 * transformToByteArray helper, Uint8Array, or Buffer) into a standard Node.js Buffer.
 */
export async function streamToBuffer(body: any): Promise<Buffer> {
  if (!body) {
    throw new Error("S3 object body is empty or undefined");
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  throw new Error("Unable to convert S3 response body to Buffer");
}

/**
 * Resolves the public CDN URL for a normalized media asset key.
 * Prioritizes R2_PUBLIC_DOMAIN (e.g. from env or process.env), falls back to R2_PUBLIC_URL,
 * or defaults to 'media.quote-hub.local'.
 */
export function resolveAvatarCdnUrl(destinationKey: string): string {
  const customDomain = (env as any).R2_PUBLIC_DOMAIN || process.env.R2_PUBLIC_DOMAIN;
  if (customDomain) {
    const cleanDomain = customDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${cleanDomain}/${destinationKey}`;
  }

  if (env.R2_PUBLIC_URL) {
    const cleanBase = env.R2_PUBLIC_URL.replace(/\/$/, "");
    return `${cleanBase}/${destinationKey}`;
  }

  return `https://media.quote-hub.local/${destinationKey}`;
}

/**
 * BullMQ processor function consuming media processing jobs from 'media-queue'.
 *
 * Job workflow:
 * 1. Reads `userId` and `tempKey` (supports both `tempKey` and `key`).
 * 2. Downloads temporary object from R2 bucket.
 * 3. Normalizes image via Sharp into 400x400 WebP format at 80% quality.
 * 4. Puts normalized object into R2 under key `profiles/${userId}/${Date.now()}.webp`.
 * 5. Resolves CDN / public URL.
 * 6. Updates user's `profileImageUrl` via Prisma.
 * 7. Deletes temporary upload from R2 via DeleteObjectCommand.
 *
 * Failure Recovery:
 * - If download or Sharp fails, logs error via logger.
 * - Cleans up temporary object if appropriate.
 * - NEVER updates user's `profileImageUrl` (preserves existing avatar URL!).
 * - Re-throws error to allow BullMQ retry handling.
 */
export async function processMediaJob(
  job: Job<MediaJobPayload | string>
): Promise<void> {
  const rawData = job.data;
  let payload: MediaJobPayload;

  if (typeof rawData === "string") {
    try {
      payload = JSON.parse(rawData);
    } catch {
      payload = {};
    }
  } else {
    payload = rawData ?? {};
  }

  const userId = payload.userId ?? payload.user_id;
  const tempKey = payload.tempKey ?? payload.key ?? payload.temp_key;

  if (!userId || !tempKey) {
    logger.warn(
      { jobId: job.id, userId, tempKey },
      "Missing required userId or tempKey in media job payload"
    );
    return;
  }

  const bucket = env.R2_BUCKET_NAME || "quotehub-avatars";

  // 1. Download temporary object from R2
  let downloadResponse;
  try {
    downloadResponse = await r2Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: tempKey,
      })
    );
  } catch (downloadErr) {
    logger.error(
      { err: downloadErr, jobId: job.id, userId, tempKey },
      "Failed to download object from R2 bucket"
    );
    throw downloadErr;
  }

  // 2. Read object bytes into Buffer
  let sourceBuffer: Buffer;
  try {
    sourceBuffer = await streamToBuffer(downloadResponse.Body);
  } catch (streamErr) {
    logger.error(
      { err: streamErr, jobId: job.id, userId, tempKey },
      "Failed to read image stream from R2 object"
    );
    throw streamErr;
  }

  // 3. Normalize image via Sharp (400x400 WebP with 80% quality)
  let normalizedBuffer: Buffer;
  try {
    normalizedBuffer = await normalizeToWebP(sourceBuffer);
  } catch (sharpErr: any) {
    logger.error(
      { err: sharpErr, jobId: job.id, userId, tempKey },
      "Failed to process and normalize avatar image via Sharp"
    );

    // Clean up temporary object if corrupt image bytes
    try {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: tempKey,
        })
      );
    } catch (cleanupErr) {
      logger.warn(
        { err: cleanupErr, jobId: job.id, tempKey },
        "Failed to clean up corrupt temporary upload object from R2"
      );
    }

    // DO NOT update user's profileImageUrl! Existing avatar remains untouched.
    // Wrap fatal image corruption in UnrecoverableError so BullMQ does not retry corrupt bytes endlessly
    throw new UnrecoverableError(
      sharpErr instanceof Error ? sharpErr.message : String(sharpErr)
    );
  }

  // 4. Put normalized WebP into R2 under key `profiles/${userId}/${Date.now()}.webp`
  const version = Date.now();
  const destinationKey = `profiles/${userId}/${version}.webp`;

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: destinationKey,
        Body: normalizedBuffer,
        ContentType: "image/webp",
      })
    );
  } catch (putErr) {
    logger.error(
      { err: putErr, jobId: job.id, userId, destinationKey },
      "Failed to put normalized avatar into R2 bucket"
    );
    throw putErr;
  }

  // 5. Resolve CDN / public URL
  const cdnUrl = resolveAvatarCdnUrl(destinationKey);

  // 6. Update user's profileImageUrl in database
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { profileImageUrl: cdnUrl },
    });
  } catch (dbErr) {
    logger.error(
      { err: dbErr, jobId: job.id, userId, cdnUrl },
      "Failed to update user profileImageUrl in database"
    );
    throw dbErr;
  }

  // 7. Delete temporary upload from R2
  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: tempKey,
      })
    );
  } catch (deleteErr) {
    logger.warn(
      { err: deleteErr, jobId: job.id, tempKey },
      "Failed to delete temporary upload object from R2 after successful processing"
    );
  }

  logger.info(
    { jobId: job.id, userId, destinationKey, cdnUrl },
    "Successfully processed and updated user avatar"
  );
}

let mediaWorkerInstance: Worker | null = null;

/**
 * Initializes and starts the BullMQ worker consuming jobs from 'media-queue'.
 */
export function startMediaWorker(opts?: Partial<WorkerOptions>): Worker {
  if (!mediaWorkerInstance) {
    mediaWorkerInstance = createWorker(
      MEDIA_QUEUE_NAME,
      processMediaJob,
      opts
    );
  }
  return mediaWorkerInstance;
}

/**
 * Closes the media worker instance cleanly.
 */
export async function stopMediaWorker(): Promise<void> {
  if (mediaWorkerInstance) {
    await mediaWorkerInstance.close();
    mediaWorkerInstance = null;
  }
}
