import { Request, Response, NextFunction } from "express";
import { FollowService } from "../services/follow.service";
import { AuthenticationError } from "../../../shared/errors/problem-details";

export class FollowController {
  constructor(
    private readonly followService: FollowService = new FollowService()
  ) {}

  /**
   * Handles follow user request (POST /users/:userId/follow).
   * Requires authenticated user. Returns 200 with { following: true, userId }.
   */
  followUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const { userId } = req.params;
      const result = await this.followService.followUser(req.user.id, userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles unfollow user request (DELETE /users/:userId/follow).
   * Requires authenticated user. Returns 200 with { following: false, userId }.
   */
  unfollowUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const { userId } = req.params;
      const result = await this.followService.unfollowUser(req.user.id, userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles get followers request (GET /users/:userId/followers).
   * Public endpoint. Returns 200 with paginated followers.
   */
  getFollowers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { userId } = req.params;
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const parsedLimit = req.query.limit ? Number(req.query.limit) : 20;
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

      const result = await this.followService.getFollowers(
        userId,
        cursor,
        limit
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles get following request (GET /users/:userId/following).
   * Public endpoint. Returns 200 with paginated following users.
   */
  getFollowing = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { userId } = req.params;
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const parsedLimit = req.query.limit ? Number(req.query.limit) : 20;
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

      const result = await this.followService.getFollowing(
        userId,
        cursor,
        limit
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const followController = new FollowController();
