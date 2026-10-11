import { Request, Response, NextFunction } from "express";
import { ThemeService } from "../services/theme.service";

export class ThemeController {
  constructor(
    private readonly themeService: ThemeService = new ThemeService()
  ) {}

  /**
   * Retrieves active quote themes for catalog display and selection.
   */
  list = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const themes = await this.themeService.listActiveThemes();
      res.status(200).json(themes);
    } catch (error) {
      next(error);
    }
  };
}

export const themeController = new ThemeController();
