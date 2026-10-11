import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma, pingDb, disconnectDb } from "../../../src/infrastructure/database/prisma";

describe("Prisma Database Client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should export prisma client instance and ping function", () => {
    expect(prisma).toBeDefined();
    expect(typeof pingDb).toBe("function");
    expect(typeof disconnectDb).toBe("function");
  });

  it("pingDb should return true when queryRaw succeeds", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);
    const result = await pingDb();
    expect(result).toBe(true);
  });

  it("pingDb should return false when queryRaw fails", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("Connection refused"));
    const result = await pingDb();
    expect(result).toBe(false);
  });

  it("pingDb should return false when queryRaw times out", async () => {
    vi.useFakeTimers();
    vi.spyOn(prisma, "$queryRaw").mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 5000)) as any
    );
    const pingPromise = pingDb();
    vi.advanceTimersByTime(3000);
    const result = await pingPromise;
    expect(result).toBe(false);
    vi.useRealTimers();
  });

  it("disconnectDb should call prisma.$disconnect", async () => {
    const disconnectSpy = vi.spyOn(prisma, "$disconnect").mockResolvedValueOnce();
    await disconnectDb();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
