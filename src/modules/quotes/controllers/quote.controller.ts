import { Request, Response, NextFunction } from "express";
import { QuoteService } from "../services/quote.service";
import {
  createQuoteSchema,
  updateQuoteSchema,
  quoteQuerySchema,
} from "../schemas/quote.schemas";
import {
  AuthenticationError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { formatZodErrors } from "../../../shared/utils/zod";

export { formatZodErrors };

export class QuoteController {
  constructor(
    private readonly quoteService: QuoteService = new QuoteService()
  ) {}

  /**
   * Handles quote creation:
   * Validates body against createQuoteSchema, derives author from authenticated req.user,
   * invokes quoteService.createQuote, and returns 201 with created quote.
   */
  createQuote = async (
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

      const parseResult = createQuoteSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const quote = await this.quoteService.createQuote(
        req.user.id,
        parseResult.data
      );
      res.status(201).json(quote);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles public quote browsing with cursor pagination and optional filters.
   * Conforms to TDD §§ 13, 74, 91, 92.
   */
  listQuotes = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parseResult = quoteQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const result = await this.quoteService.listQuotes(parseResult.data);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles quote retrieval by ID:
   * Retrieves quote via quoteService.getQuoteById and returns 200 with quote.
   */
  getQuote = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const quote = await this.quoteService.getQuoteById(req.params.quoteId);
      res.status(200).json(quote);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles quote update:
   * Validates body against updateQuoteSchema, verifies user authentication,
   * invokes quoteService.updateQuote, and returns 200 with updated quote.
   */
  updateQuote = async (
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

      const parseResult = updateQuoteSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const updated = await this.quoteService.updateQuote(
        req.user.id,
        req.params.quoteId,
        parseResult.data
      );
      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles quote deletion (soft-delete):
   * Verifies user authentication, invokes quoteService.deleteQuote,
   * and returns 204 No Content.
   */
  deleteQuote = async (
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

      await this.quoteService.deleteQuote(req.user.id, req.params.quoteId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const quoteController = new QuoteController();
