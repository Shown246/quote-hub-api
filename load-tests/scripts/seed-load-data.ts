// load-tests/scripts/seed-load-data.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { env } from "../../src/app/config/env";
import { generateUuidV7 } from "../../src/shared/utils/uuidv7";
import { SEED_THEMES } from "../../prisma/seed";

export interface SeedUser {
  id: string;
  authId: string;
  username: string;
  displayName: string;
  email: string;
  bio: string;
  role: "USER";
  status: "ACTIVE";
}

export interface SeedSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

export interface SeedQuote {
  id: string;
  userId: string;
  content: string;
  text: string;
  isOriginal: boolean;
  authorName: string | null;
  themeId: string;
}

export interface SeedExportUser {
  id: string;
  username: string;
  token: string;
  cookie: string;
}

export interface SeedDataset {
  users: SeedExportUser[];
  quoteIds: string[];
  searchTerms: string[];
}

export interface SeedSummary {
  userCount: number;
  sessionCount: number;
  quoteCount: number;
  followCount: number;
  outputFile: string;
}

const SAMPLE_QUOTES = [
  "In the middle of difficulty lies opportunity. Wisdom begins with wonder.",
  "Courage is not the absence of fear, but the triumph over it. The brave person conquers fear.",
  "Life is what happens when you are busy making other plans. Focus on what truly matters.",
  "The only true wisdom is in knowing you know nothing. Seek truth with humility.",
  "Strength does not come from physical capacity. It comes from an indomitable will.",
  "To live is the rarest thing in the world. Most people exist, that is all. Embrace life.",
  "Do not go where the path may lead, go instead where there is no path and leave a trail. Courage leads.",
  "The journey of a thousand miles begins with a single step. Focus on each step.",
  "Simplicity is the ultimate sophistication. Truth is found in clarity and silence.",
  "It is during our darkest moments that we must focus to see the light of life.",
  "Wisdom comes from experience, and experience is often the result of lack of wisdom.",
  "Have courage for the great sorrows of life and patience for the small ones.",
  "Whatever you are, be a good one. Strength and honor will guide you.",
  "He who has a why to live can bear almost any how. Purpose breeds inner strength.",
  "Life shrinks or expands in proportion to one's courage and dedication.",
];

export const SEARCH_TERMS = ["wisdom", "courage", "life", "focus", "truth", "strength"];

/**
 * Generates an array of test user accounts and corresponding 30-day Better Auth session records.
 */
export function generateSeedUsers(count: number = 100): { users: SeedUser[]; sessions: SeedSession[] } {
  const users: SeedUser[] = [];
  const sessions: SeedSession[] = [];
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 86400000);

  for (let i = 1; i <= count; i++) {
    const pad = String(i).padStart(3, "0");
    const userId = generateUuidV7();
    const authId = `auth_perf_${pad}`;
    const username = `perf_user_${pad}`;
    const token = `perf_sess_${pad}_${generateUuidV7().replace(/-/g, "")}`;

    users.push({
      id: userId,
      authId,
      username,
      displayName: `Performance Test User ${pad}`,
      email: `${username}@perf.quote-hub.local`,
      bio: `Automated test account ${pad} for k6 performance testing`,
      role: "USER",
      status: "ACTIVE",
    });

    sessions.push({
      id: generateUuidV7(),
      userId: authId,
      token,
      expiresAt,
    });
  }

  return { users, sessions };
}

/**
 * Generates quotes referencing real keywords with length <= 280 chars.
 */
export function generateSeedQuotes(
  userIds: string[],
  quotesPerUser: number = 10,
  themeId: string = SEED_THEMES[0]?.id || "018f3a2c-0000-7000-8000-000000000001"
): SeedQuote[] {
  const quotes: SeedQuote[] = [];

  for (const userId of userIds) {
    for (let j = 0; j < quotesPerUser; j++) {
      const text = SAMPLE_QUOTES[(quotes.length + j) % SAMPLE_QUOTES.length];
      quotes.push({
        id: generateUuidV7(),
        userId,
        content: text,
        text,
        isOriginal: true,
        authorName: null,
        themeId,
      });
    }
  }

  return quotes;
}

/**
 * Main database seeding function for load testing.
 */
export async function seedLoadData(options?: {
  userCount?: number;
  quotesPerUser?: number;
  outputFile?: string;
  prismaClient?: PrismaClient;
}): Promise<SeedSummary> {
  const userCount = options?.userCount ?? 100;
  const quotesPerUser = options?.quotesPerUser ?? 15;
  const outputFile = options?.outputFile ?? path.resolve(process.cwd(), "load-tests/data/users.json");
  const prisma = options?.prismaClient ?? new PrismaClient();

  try {
    console.log(`Connecting to database at ${process.env.DATABASE_URL ? "custom URL" : "default"}...`);

    // 1. Ensure seed themes exist
    for (const theme of SEED_THEMES) {
      await prisma.theme.upsert({
        where: { id: theme.id },
        update: { name: theme.name, key: theme.key, isActive: theme.isActive },
        create: { id: theme.id, name: theme.name, key: theme.key, isActive: theme.isActive },
      });
    }

    // 2. Generate user accounts & sessions
    console.log(`Generating ${userCount} users and pre-warmed session tokens...`);
    const { users, sessions } = generateSeedUsers(userCount);

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const session = sessions[i];

      // Upsert AuthUser
      await prisma.authUser.upsert({
        where: { email: user.email },
        update: { name: user.displayName },
        create: {
          id: user.authId,
          email: user.email,
          name: user.displayName,
          emailVerified: true,
        },
      });

      // Upsert User
      await prisma.user.upsert({
        where: { username: user.username },
        update: { displayName: user.displayName, authId: user.authId },
        create: {
          id: user.id,
          authId: user.authId,
          username: user.username,
          displayName: user.displayName,
          bio: user.bio,
          role: user.role,
          status: user.status,
        },
      });

      // Upsert AuthSession
      await prisma.authSession.upsert({
        where: { token: session.token },
        update: { expiresAt: session.expiresAt },
        create: {
          id: session.id,
          userId: session.userId,
          token: session.token,
          expiresAt: session.expiresAt,
        },
      });
    }

    // Fetch refreshed user IDs
    const createdUsers = await prisma.user.findMany({
      where: { username: { startsWith: "perf_user_" } },
      select: { id: true, username: true },
    });
    const userIdMap = new Map(createdUsers.map((u) => [u.username, u.id]));

    // 3. Dense social graph (circular & mutual follows)
    console.log("Seeding dense social graph follows...");
    let followCount = 0;
    const userIds = createdUsers.map((u) => u.id);
    for (let i = 0; i < userIds.length; i++) {
      const followerId = userIds[i];
      // Follow the next 5 users cyclically
      for (let offset = 1; offset <= Math.min(5, userIds.length - 1); offset++) {
        const followingId = userIds[(i + offset) % userIds.length];
        try {
          await prisma.follow.upsert({
            where: {
              followerId_followingId: { followerId, followingId },
            },
            update: {},
            create: { followerId, followingId },
          });
          followCount++;
        } catch {
          // ignore duplicate conflicts
        }
      }
    }

    // 4. Generate & seed quotes
    console.log(`Generating quotes (${quotesPerUser} per user)...`);
    const defaultThemeId = SEED_THEMES[0].id;
    const rawQuotes = generateSeedQuotes(userIds, quotesPerUser, defaultThemeId);

    for (const q of rawQuotes) {
      await prisma.quote.upsert({
        where: { id: q.id },
        update: { text: q.text },
        create: {
          id: q.id,
          userId: q.userId,
          text: q.text,
          isOriginal: q.isOriginal,
          authorName: q.authorName,
          themeId: q.themeId,
        },
      });
    }

    // 5. Gather quote IDs for export
    const createdQuotes = await prisma.quote.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true },
      take: 2000,
    });
    const quoteIds = createdQuotes.map((q) => q.id);
    const quotes = createdQuotes.map((q) => ({ id: q.id, userId: q.userId }));

    // 6. Write load-tests/data/users.json
    const authSecret = env.BETTER_AUTH_SECRET;
    const exportUsers: SeedExportUser[] = users.map((u, idx) => {
      const token = sessions[idx].token;
      const signature = crypto.createHmac("sha256", authSecret).update(token).digest("base64");
      const signedCookie = encodeURIComponent(`${token}.${signature}`);
      return {
        id: userIdMap.get(u.username) || u.id,
        username: u.username,
        token,
        cookie: `better-auth.session_token=${signedCookie}`,
      };
    });

    const dataset: SeedDataset = {
      users: exportUsers,
      quoteIds,
      quotes,
      searchTerms: SEARCH_TERMS,
    };

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(dataset, null, 2), "utf-8");
    console.log(`Exported test dataset to ${outputFile} with ${exportUsers.length} users and ${quoteIds.length} quotes.`);

    return {
      userCount: exportUsers.length,
      sessionCount: sessions.length,
      quoteCount: quoteIds.length,
      followCount,
      outputFile,
    };
  } finally {
    if (!options?.prismaClient) {
      await prisma.$disconnect();
    }
  }
}

// CLI entrypoint
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].includes("seed-load-data")
) {
  seedLoadData()
    .then((summary) => {
      console.log("Seeding completed successfully:", summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to seed load data:", err);
      process.exit(1);
    });
}
