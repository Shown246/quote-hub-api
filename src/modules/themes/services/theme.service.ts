import { Theme } from "@prisma/client";
import { ThemeRepository } from "../repositories/theme.repository";

export class ThemeService {
  constructor(
    private readonly themeRepo: ThemeRepository = new ThemeRepository()
  ) {}

  /**
   * Returns all active themes available in the catalog.
   */
  async listActiveThemes(): Promise<Theme[]> {
    return this.themeRepo.findActiveThemes();
  }

  /**
   * Retrieves a theme by its UUID.
   *
   * @param id The theme's UUID
   */
  async getThemeById(id: string): Promise<Theme | null> {
    return this.themeRepo.findById(id);
  }
}
