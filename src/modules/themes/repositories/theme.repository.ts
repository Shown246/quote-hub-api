import { PrismaClient, Theme } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";

export interface IThemeRepository {
  findActiveThemes(): Promise<Theme[]>;
  findById(id: string): Promise<Theme | null>;
}

export class ThemeRepository implements IThemeRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Retrieves all active themes ordered alphabetically by name.
   */
  async findActiveThemes(): Promise<Theme[]> {
    return this.db.theme.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });
  }

  /**
   * Finds a theme by its unique UUID.
   *
   * @param id The UUID of the theme
   */
  async findById(id: string): Promise<Theme | null> {
    return this.db.theme.findUnique({
      where: { id },
    });
  }
}
