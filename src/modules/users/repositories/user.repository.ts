import { Prisma, PrismaClient, User, UserStatus } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";
import { ConflictError } from "../../../shared/errors/problem-details";

export interface CreateUserData {
  id?: string;
  authId?: string | null;
  username: string;
  displayName: string;
  bio?: string | null;
  profileImageUrl?: string | null;
}

export interface UpdateProfileData {
  displayName?: string;
  bio?: string | null;
  profileImageUrl?: string | null;
}

export interface IUserRepository {
  findByUsername(username: string, includeDeleted?: boolean): Promise<User | null>;
  findById(id: string, includeDeleted?: boolean): Promise<User | null>;
  findByAuthId(authId: string, includeDeleted?: boolean): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updateProfile(userId: string, data: UpdateProfileData): Promise<User>;
  softDelete(userId: string): Promise<User>;
}

export class UserRepository implements IUserRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Finds a user by their unique username.
   * By default, soft-deleted users (deletedAt !== null) are excluded.
   *
   * @param username The username to look up
   * @param includeDeleted If true, returns the user even if soft-deleted
   */
  async findByUsername(
    username: string,
    includeDeleted: boolean = false
  ): Promise<User | null> {
    const where: Prisma.UserWhereInput = { username };
    if (!includeDeleted) {
      where.deletedAt = null;
    }
    return this.db.user.findFirst({ where });
  }

  /**
   * Finds a user by their primary key UUID.
   * By default, soft-deleted users (deletedAt !== null) are excluded.
   *
   * @param id The user's UUID
   * @param includeDeleted If true, returns the user even if soft-deleted
   */
  async findById(
    id: string,
    includeDeleted: boolean = false
  ): Promise<User | null> {
    if (includeDeleted) {
      return this.db.user.findUnique({ where: { id } });
    }
    return this.db.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  /**
   * Finds a user linked to the specified Better Auth account ID.
   * By default, soft-deleted users (deletedAt !== null) are excluded.
   *
   * @param authId The Better Auth user ID
   * @param includeDeleted If true, returns the user even if soft-deleted
   */
  async findByAuthId(
    authId: string,
    includeDeleted: boolean = false
  ): Promise<User | null> {
    if (includeDeleted) {
      return this.db.user.findUnique({ where: { authId } });
    }
    return this.db.user.findFirst({
      where: {
        authId,
        deletedAt: null,
      },
    });
  }

  /**
   * Creates a new domain user.
   * Generates an RFC 9562-compliant UUIDv7 for `id` if not explicitly provided.
   * Traps Prisma P2002 unique constraint violations and raises a 409 ConflictError.
   *
   * @param data User creation payload
   * @throws ConflictError if username or authId is already taken
   */
  async create(data: CreateUserData): Promise<User> {
    const id = data.id ?? generateUuidV7();

    try {
      return await this.db.user.create({
        data: {
          id,
          authId: data.authId ?? null,
          username: data.username,
          displayName: data.displayName,
          bio: data.bio ?? null,
          profileImageUrl: data.profileImageUrl ?? null,
        },
      });
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError ||
          (typeof error === "object" && error !== null && "code" in error)) &&
        (error as { code: unknown }).code === "P2002"
      ) {
        throw new ConflictError("Username already taken");
      }
      throw error;
    }
  }

  /**
   * Updates only allowed profile presentation fields.
   * Enforces strict mass assignment protection against mutating protected attributes
   * like `role`, `status`, `followerCount`, `deletedAt`, or identifiers.
   *
   * @param userId The ID of the user to update
   * @param data Profile fields to update
   */
  async updateProfile(
    userId: string,
    data: UpdateProfileData
  ): Promise<User> {
    const updateData: Prisma.UserUpdateInput = {};

    if (data.displayName !== undefined) {
      updateData.displayName = data.displayName;
    }
    if (data.bio !== undefined) {
      updateData.bio = data.bio;
    }
    if (data.profileImageUrl !== undefined) {
      updateData.profileImageUrl = data.profileImageUrl;
    }

    return this.db.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  /**
   * Soft-deletes a user by updating their status to DELETED and recording deletedAt.
   *
   * @param userId The ID of the user to soft-delete
   */
  async softDelete(userId: string): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
      },
    });
  }
}
