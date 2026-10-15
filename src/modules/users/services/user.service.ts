import { User, UserStatus } from "@prisma/client";
import { UserRepository } from "../repositories/user.repository";
import { prisma } from "../../../infrastructure/database/prisma";
import { stageOutboxEvent } from "../../../infrastructure/queue/outbox";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { updateProfileSchema, usernameSchema } from "../schemas/user.schemas";
import { formatZodErrors } from "../../../shared/utils/zod";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";
import { invalidateUserSessionCache } from "../../../middleware/auth";

export class UserService {
  constructor(
    private readonly userRepo: UserRepository = new UserRepository()
  ) {}

  /**
   * Retrieves a user profile by public username.
   * Soft-deleted users are excluded by default in the repository layer.
   *
   * @param username The public username handle
   * @throws NotFoundError if the user is not found
   */
  async getProfileByUsername(username: string): Promise<User> {
    const user = await this.userRepo.findByUsername(username);
    if (!user) {
      throw new NotFoundError("Resource not found");
    }
    return user;
  }

  /**
   * Updates user presentation profile fields (displayName, bio).
   * Validates input against updateProfileSchema with strict mass-assignment prevention.
   *
   * @param userId The ID of the user to update
   * @param data Payload to validate and apply
   * @throws ValidationError if payload fails schema validation
   * @throws NotFoundError if the user does not exist
   */
  async updateProfile(userId: string, data: unknown): Promise<User> {
    const parseResult = updateProfileSchema.safeParse(data);
    if (!parseResult.success) {
      throw new ValidationError(
        "Validation failed",
        formatZodErrors(parseResult.error)
      );
    }

    const existingUser = await this.userRepo.findById(userId);
    if (!existingUser) {
      throw new NotFoundError("Resource not found");
    }

    const updatedUser = await this.userRepo.updateProfile(userId, parseResult.data);
    await invalidateUserSessionCache(userId);
    return updatedUser;
  }

  /**
   * Soft-deletes a user account.
   * Wraps status update to DELETED and UserDeleted outbox event staging
   * in an atomic database transaction.
   *
   * @param userId The ID of the user to soft-delete
   * @throws NotFoundError if the user does not exist or is already deleted
   */
  async softDeleteAccount(userId: string): Promise<User> {
    const deletedUser = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
        },
      });

      if (!existingUser) {
        throw new NotFoundError("Resource not found");
      }

      const deleted = await tx.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.DELETED,
          deletedAt: new Date(),
        },
      });

      await stageOutboxEvent(tx, "UserDeleted", "User", userId, { userId });

      return deleted;
    });

    await invalidateUserSessionCache(userId);
    return deletedUser;
  }

  /**
   * Confirms direct-to-R2 avatar upload and stages AvatarUploaded outbox event.
   * Validates key ownership to prevent arbitrary/foreign key manipulation.
   */
  async confirmAvatarUpload(
    userId: string,
    key: string
  ): Promise<{ message: string; key: string }> {
    const expectedPrefix = `uploads/avatars/${userId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new ValidationError("Object key does not belong to authenticated user");
    }

    await prisma.$transaction(async (tx) => {
      await stageOutboxEvent(tx, "AvatarUploaded", "Media", userId, {
        userId,
        tempKey: key,
      });
    });

    return {
      message: "Avatar upload confirmed, processing queued",
      key,
    };
  }

  /**
   * Generates a candidate username conforming to usernameSchema (^[a-zA-Z0-9_]{3,30}$).
   */
  generateCandidateUsername(name?: string | null, email?: string | null): string {
    let base = "";
    if (name) {
      base = name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_{2,}/g, "_");
    }
    if ((!base || base.length < 3) && email) {
      const emailPrefix = email.split("@")[0];
      base = emailPrefix
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_{2,}/g, "_");
    }
    if (!base || base.length < 3) {
      base = "user";
    }
    return base.slice(0, 20);
  }

  /**
   * Ensures an active domain User exists for the given authId.
   * Auto-provisions from AuthUser data if not yet created.
   */
  async ensureDomainUserForAuth(
    authId: string,
    fallbackName?: string | null,
    fallbackEmail?: string | null,
    fallbackImage?: string | null
  ): Promise<User> {
    const existing = await prisma.user.findFirst({
      where: { authId },
    });
    if (existing) {
      return existing;
    }

    const authUser = await prisma.authUser.findUnique({
      where: { id: authId },
    });

    const name = fallbackName || authUser?.name || "";
    const email = fallbackEmail || authUser?.email || "";
    const image =
      fallbackImage !== undefined ? fallbackImage : authUser?.image || null;

    const baseHandle = this.generateCandidateUsername(name, email);
    let candidateUsername = baseHandle;
    let attempt = 0;

    while (attempt < 10) {
      const existingUser = await this.userRepo.findByUsername(candidateUsername, true);
      if (!existingUser) {
        break;
      }
      attempt++;
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      candidateUsername = `${baseHandle.slice(0, 24)}_${randomSuffix}`;
    }

    try {
      return await this.userRepo.create({
        id: generateUuidV7(),
        authId,
        username: candidateUsername,
        displayName: (name && name.trim()) || candidateUsername,
        profileImageUrl: image || null,
        role: "USER",
        status: "ACTIVE",
      });
    } catch (err: any) {
      const raceExisting = await prisma.user.findFirst({
        where: { authId },
      });
      if (raceExisting) {
        return raceExisting;
      }
      throw err;
    }
  }

  /**
   * Finalizes public username during onboarding or first-time setup.
   * Conforms to username validation rules and ensures handle uniqueness.
   */
  async finalizeUsername(userId: string, rawUsername: unknown): Promise<User> {
    const parseResult = usernameSchema.safeParse(rawUsername);
    if (!parseResult.success) {
      throw new ValidationError(
        "Validation failed",
        formatZodErrors(parseResult.error)
      );
    }
    const username = parseResult.data;
    const existing = await this.userRepo.findByUsername(username);
    if (existing && existing.id !== userId) {
      throw new ConflictError("Username is already taken");
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { username },
    });
    await invalidateUserSessionCache(userId);
    return updatedUser;
  }
}

