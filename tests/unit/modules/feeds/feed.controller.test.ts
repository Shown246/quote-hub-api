import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { FeedController } from "../../../../src/modules/feeds/controllers/feed.controller";
import { FeedService } from "../../../../src/modules/feeds/services/feed.service";
import {
  AuthenticationError,
  ValidationError,
} from "../../../../src/shared/errors/problem-details";
import { encodeCursor } from "../../../../src/shared/utils/cursor";

describe("FeedController Unit Tests", () => {
  let mockFeedService: {
    getFollowingFeed: ReturnType<typeof vi.fn>;
    getForYouFeed: ReturnType<typeof vi.fn>;
  };
  let controller: FeedController;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFeedService = {
      getFollowingFeed: vi.fn(),
      getForYouFeed: vi.fn(),
    };
    controller = new FeedController(mockFeedService as unknown as FeedService);
  });

  describe("getFollowingFeed", () => {
    it("should throw AuthenticationError if req.user is missing", async () => {
      const req = { query: {} } as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      await controller.getFollowingFeed(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });

    it("should clamp limit to 50 if limit exceeds 50", async () => {
      const req = {
        user: { id: "user-1" },
        query: { limit: "100" },
      } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      mockFeedService.getFollowingFeed.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await controller.getFollowingFeed(req, res, next);

      expect(mockFeedService.getFollowingFeed).toHaveBeenCalledWith(
        "user-1",
        undefined,
        50
      );
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(jsonFn).toHaveBeenCalledWith({
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it("should default limit to 20 if limit is not a positive integer", async () => {
      const req = {
        user: { id: "user-1" },
        query: { limit: "abc" },
      } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      mockFeedService.getFollowingFeed.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await controller.getFollowingFeed(req, res, next);

      expect(mockFeedService.getFollowingFeed).toHaveBeenCalledWith(
        "user-1",
        undefined,
        20
      );
    });

    it("should reject invalid cursor with ValidationError", async () => {
      const req = {
        user: { id: "user-1" },
        query: { cursor: "not-a-valid-cursor" },
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      await controller.getFollowingFeed(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(mockFeedService.getFollowingFeed).not.toHaveBeenCalled();
    });

    it("should pass valid cursor to feed service", async () => {
      const validCursor = encodeCursor(
        new Date("2026-10-07T12:00:00Z"),
        "018f972b-5b3a-7d4e-8fa1-000000000001"
      );
      const req = {
        user: { id: "user-1" },
        query: { cursor: validCursor, limit: "15" },
      } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      mockFeedService.getFollowingFeed.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await controller.getFollowingFeed(req, res, next);

      expect(mockFeedService.getFollowingFeed).toHaveBeenCalledWith(
        "user-1",
        validCursor,
        15
      );
      expect(statusFn).toHaveBeenCalledWith(200);
    });
  });

  describe("getForYouFeed", () => {
    it("should allow unauthenticated access and pass undefined userId", async () => {
      const req = { query: {} } as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      mockFeedService.getForYouFeed.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await controller.getForYouFeed(req, res, next);

      expect(mockFeedService.getForYouFeed).toHaveBeenCalledWith(
        undefined,
        undefined,
        20
      );
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(jsonFn).toHaveBeenCalledWith({
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it("should pass userId when user is authenticated", async () => {
      const req = {
        user: { id: "auth-user-99" },
        query: { limit: "30" },
      } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      mockFeedService.getForYouFeed.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await controller.getForYouFeed(req, res, next);

      expect(mockFeedService.getForYouFeed).toHaveBeenCalledWith(
        "auth-user-99",
        undefined,
        30
      );
      expect(statusFn).toHaveBeenCalledWith(200);
    });

    it("should reject invalid cursor with ValidationError", async () => {
      const req = {
        query: { cursor: "tampered_cursor" },
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      await controller.getForYouFeed(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(mockFeedService.getForYouFeed).not.toHaveBeenCalled();
    });

    it("should call next with error when service throws", async () => {
      const req = { query: {} } as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;
      const err = new Error("DB failure");

      mockFeedService.getForYouFeed.mockRejectedValueOnce(err);

      await controller.getForYouFeed(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
