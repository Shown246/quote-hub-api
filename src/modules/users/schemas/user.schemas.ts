import { z } from "zod";
import type { User } from "@prisma/client";

/**
 * Validates public usernames:
 * - 3 to 30 characters
 * - Only alphanumeric characters and underscores allowed
 */
export const usernameSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_]{3,30}$/,
    "Username must be 3-30 alphanumeric characters or underscores"
  );

/**
 * Validates profile update payloads with strict mass-assignment prevention:
 * - displayName: optional, trimmed, 1-50 characters
 * - bio: optional, nullable, max 160 characters
 * - .strict() ensures any unexpected properties (e.g. role, status, id) fail validation
 */
export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    bio: z.string().max(160).nullable().optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Validates avatar upload presigned URL request payloads:
 * - contentType: required non-empty string
 * - contentLength: optional positive integer
 * - .strict() ensures any unexpected properties fail validation
 */
export const avatarUploadRequestSchema = z
  .object({
    contentType: z.string().min(1),
    contentLength: z.number().int().positive().optional(),
  })
  .strict();

export type AvatarUploadRequestInput = z.infer<
  typeof avatarUploadRequestSchema
>;

/**
 * Validates avatar upload confirmation payloads:
 * - key: raw R2 key returned by presigned upload request
 */
export const avatarConfirmRequestSchema = z
  .object({
    key: z
      .string({ required_error: "Key is required" })
      .min(1, "Key must not be empty")
      .regex(
        /^uploads\/avatars\/[0-9a-fA-F-]{36}\/\d+\.(jpg|jpeg|png|webp)$/,
        "Invalid avatar object key format"
      ),
  })
  .strict();

export type AvatarConfirmRequestDto = z.infer<
  typeof avatarConfirmRequestSchema
>;

/**
 * Sanitized profile DTO response that strips internal database fields
 * (authId, suspendedAt, suspendedUntil, suspensionReason, deletedAt).
 */
export interface UserProfileResponse {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  profileImageUrl: string | null;
  role: string;
  status: string;
  followerCount: number;
  followingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Transforms a domain user entity into a sanitized public profile DTO.
 */
export function toUserProfileResponse(user: User): UserProfileResponse {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    profileImageUrl: user.profileImageUrl,
    role: user.role,
    status: user.status,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export { formatZodErrors } from "../../../shared/utils/zod";
