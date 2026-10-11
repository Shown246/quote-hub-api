import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../src/infrastructure/database/prisma";
import { logger } from "../src/infrastructure/logging/logger";

// Standard deterministic UUIDs
export const SEED_THEMES = [
  {
    id: "018f3a2c-0000-7000-8000-000000000001",
    key: "classic-serif",
    name: "Classic Serif",
    isActive: true,
  },
  {
    id: "018f3a2c-0000-7000-8000-000000000002",
    key: "modern-sans",
    name: "Modern Sans",
    isActive: true,
  },
  {
    id: "018f3a2c-0000-7000-8000-000000000003",
    key: "editorial",
    name: "Editorial",
    isActive: true,
  },
  {
    id: "018f3a2c-0000-7000-8000-000000000004",
    key: "minimalist",
    name: "Minimalist",
    isActive: true,
  },
];

export const SEED_USERS = [
  {
    authId: "auth_admin_001",
    email: "admin@quote-hub.local",
    name: "Admin User",
    userId: "018f3a2c-1000-7000-8000-000000000001",
    username: "admin",
    displayName: "Admin User",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    bio: "Platform Administrator",
  },
  {
    authId: "auth_alice_002",
    email: "alice@quote-hub.local",
    name: "Alice Smith",
    userId: "018f3a2c-1000-7000-8000-000000000002",
    username: "alice",
    displayName: "Alice Smith",
    role: "USER" as const,
    status: "ACTIVE" as const,
    bio: "Philosopher, reader, and thinker",
  },
  {
    authId: "auth_bob_003",
    email: "bob@quote-hub.local",
    name: "Bob Jones",
    userId: "018f3a2c-1000-7000-8000-000000000003",
    username: "bob",
    displayName: "Bob Jones",
    role: "USER" as const,
    status: "ACTIVE" as const,
    bio: "Literature enthusiast and writer",
  },
  {
    authId: "auth_charlie_004",
    email: "charlie@quote-hub.local",
    name: "Charlie Brown",
    userId: "018f3a2c-1000-7000-8000-000000000004",
    username: "charlie",
    displayName: "Charlie Brown",
    role: "USER" as const,
    status: "ACTIVE" as const,
    bio: "Curator of inspiring words",
  },
  {
    authId: "auth_spammer_005",
    email: "spammer@quote-hub.local",
    name: "Suspended Spammer",
    userId: "018f3a2c-1000-7000-8000-000000000005",
    username: "spammer",
    displayName: "Suspended Spammer",
    role: "USER" as const,
    status: "SUSPENDED" as const,
    bio: "Suspended user account",
    suspensionReason: "Spamming inappropriate quotes violating platform guidelines",
    suspendedAt: new Date("2026-03-01T00:00:00Z"),
  },
];

export const SEED_QUOTES = [
  {
    id: "018f3a2c-2000-7000-8000-000000000001",
    userId: "018f3a2c-1000-7000-8000-000000000002", // Alice
    text: "The unexamined life is not worth living.",
    isOriginal: false,
    authorName: "Socrates",
    themeId: "018f3a2c-0000-7000-8000-000000000001",
    deletedAt: null,
  },
  {
    id: "018f3a2c-2000-7000-8000-000000000002",
    userId: "018f3a2c-1000-7000-8000-000000000002", // Alice
    text: "Simplicity is the ultimate sophistication.",
    isOriginal: true,
    authorName: null,
    themeId: "018f3a2c-0000-7000-8000-000000000002",
    deletedAt: null,
  },
  {
    id: "018f3a2c-2000-7000-8000-000000000003",
    userId: "018f3a2c-1000-7000-8000-000000000003", // Bob
    text: "In the middle of difficulty lies opportunity.",
    isOriginal: false,
    authorName: "Albert Einstein",
    themeId: "018f3a2c-0000-7000-8000-000000000003",
    deletedAt: null,
  },
  {
    id: "018f3a2c-2000-7000-8000-000000000004",
    userId: "018f3a2c-1000-7000-8000-000000000004", // Charlie
    text: "Stay hungry, stay foolish.",
    isOriginal: false,
    authorName: "Steve Jobs",
    themeId: "018f3a2c-0000-7000-8000-000000000004",
    deletedAt: null,
  },
  {
    id: "018f3a2c-2000-7000-8000-000000000005",
    userId: "018f3a2c-1000-7000-8000-000000000003", // Bob
    text: "This draft was intentionally removed.",
    isOriginal: true,
    authorName: null,
    themeId: "018f3a2c-0000-7000-8000-000000000001",
    deletedAt: new Date("2026-03-02T12:00:00Z"), // Soft-deleted
  },
];

export async function seedDatabase(client: PrismaClient = defaultPrisma): Promise<void> {
  logger.info("Starting database seed conforming to TDD § 142...");

  // 1. Upsert Themes
  for (const theme of SEED_THEMES) {
    await client.theme.upsert({
      where: { key: theme.key },
      create: theme,
      update: { name: theme.name, isActive: theme.isActive },
    });
  }

  // 2. Upsert Auth Users and Application Profiles
  for (const u of SEED_USERS) {
    await client.authUser.upsert({
      where: { email: u.email },
      create: {
        id: u.authId,
        email: u.email,
        name: u.name,
        emailVerified: true,
      },
      update: {
        name: u.name,
      },
    });

    await client.user.upsert({
      where: { id: u.userId },
      create: {
        id: u.userId,
        authId: u.authId,
        username: u.username,
        displayName: u.displayName,
        bio: u.bio,
        role: u.role,
        status: u.status,
        suspensionReason: (u as any).suspensionReason ?? null,
        suspendedAt: (u as any).suspendedAt ?? null,
      },
      update: {
        displayName: u.displayName,
        bio: u.bio,
        role: u.role,
        status: u.status,
      },
    });
  }

  // 3. Upsert Quotes
  for (const q of SEED_QUOTES) {
    await client.quote.upsert({
      where: { id: q.id },
      create: q,
      update: {
        text: q.text,
        authorName: q.authorName,
        isOriginal: q.isOriginal,
        deletedAt: q.deletedAt,
      },
    });
  }

  // 4. Upsert Follow relationships
  // Alice follows Bob
  await client.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: "018f3a2c-1000-7000-8000-000000000002",
        followingId: "018f3a2c-1000-7000-8000-000000000003",
      },
    },
    create: {
      followerId: "018f3a2c-1000-7000-8000-000000000002",
      followingId: "018f3a2c-1000-7000-8000-000000000003",
    },
    update: {},
  });

  // Bob follows Alice
  await client.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: "018f3a2c-1000-7000-8000-000000000003",
        followingId: "018f3a2c-1000-7000-8000-000000000002",
      },
    },
    create: {
      followerId: "018f3a2c-1000-7000-8000-000000000003",
      followingId: "018f3a2c-1000-7000-8000-000000000002",
    },
    update: {},
  });

  // Charlie follows Alice
  await client.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: "018f3a2c-1000-7000-8000-000000000004",
        followingId: "018f3a2c-1000-7000-8000-000000000002",
      },
    },
    create: {
      followerId: "018f3a2c-1000-7000-8000-000000000004",
      followingId: "018f3a2c-1000-7000-8000-000000000002",
    },
    update: {},
  });

  // 5. Upsert Likes
  // Bob likes Quote 1 (Alice)
  await client.like.upsert({
    where: {
      userId_quoteId: {
        userId: "018f3a2c-1000-7000-8000-000000000003",
        quoteId: "018f3a2c-2000-7000-8000-000000000001",
      },
    },
    create: {
      userId: "018f3a2c-1000-7000-8000-000000000003",
      quoteId: "018f3a2c-2000-7000-8000-000000000001",
    },
    update: {},
  });

  // Charlie likes Quote 1 (Alice)
  await client.like.upsert({
    where: {
      userId_quoteId: {
        userId: "018f3a2c-1000-7000-8000-000000000004",
        quoteId: "018f3a2c-2000-7000-8000-000000000001",
      },
    },
    create: {
      userId: "018f3a2c-1000-7000-8000-000000000004",
      quoteId: "018f3a2c-2000-7000-8000-000000000001",
    },
    update: {},
  });

  // Alice likes Quote 3 (Bob)
  await client.like.upsert({
    where: {
      userId_quoteId: {
        userId: "018f3a2c-1000-7000-8000-000000000002",
        quoteId: "018f3a2c-2000-7000-8000-000000000003",
      },
    },
    create: {
      userId: "018f3a2c-1000-7000-8000-000000000002",
      quoteId: "018f3a2c-2000-7000-8000-000000000003",
    },
    update: {},
  });

  // 6. Upsert Reposts
  // Bob reposts Quote 1 (Alice)
  await client.repost.upsert({
    where: {
      uq_reposts_user_quote: {
        userId: "018f3a2c-1000-7000-8000-000000000003",
        quoteId: "018f3a2c-2000-7000-8000-000000000001",
      },
    },
    create: {
      id: "018f3a2c-3000-7000-8000-000000000001",
      userId: "018f3a2c-1000-7000-8000-000000000003",
      quoteId: "018f3a2c-2000-7000-8000-000000000001",
    },
    update: {},
  });

  // 7. Upsert Bookmarks
  // Charlie bookmarks Quote 1 (Alice)
  await client.bookmark.upsert({
    where: {
      userId_quoteId: {
        userId: "018f3a2c-1000-7000-8000-000000000004",
        quoteId: "018f3a2c-2000-7000-8000-000000000001",
      },
    },
    create: {
      userId: "018f3a2c-1000-7000-8000-000000000004",
      quoteId: "018f3a2c-2000-7000-8000-000000000001",
    },
    update: {},
  });

  // 8. Upsert Notifications
  await client.notification.upsert({
    where: { id: "018f3a2c-4000-7000-8000-000000000001" },
    create: {
      id: "018f3a2c-4000-7000-8000-000000000001",
      userId: "018f3a2c-1000-7000-8000-000000000002", // To Alice
      actorId: "018f3a2c-1000-7000-8000-000000000003", // From Bob
      type: "LIKE",
      entityId: "018f3a2c-2000-7000-8000-000000000001", // Quote 1
      readAt: null,
    },
    update: {},
  });

  // 9. Reconcile counters via PostgreSQL procedure
  try {
    await client.$executeRawUnsafe("CALL reconcile_all_counters();");
    logger.info("Denormalized counters reconciled successfully");
  } catch (err) {
    logger.warn({ err }, "Could not run reconcile_all_counters stored procedure (may not exist in mock env)");
  }

  logger.info("Database seeding successfully completed!");
}

async function main() {
  try {
    await seedDatabase();
  } catch (e) {
    logger.error({ error: e }, "Failed to seed database");
    process.exit(1);
  } finally {
    await defaultPrisma.$disconnect();
  }
}

if (process.env.NODE_ENV !== "test" && require.main === module) {
  main();
}
