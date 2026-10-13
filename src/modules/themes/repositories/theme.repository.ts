import { PrismaClient, Theme } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { getOrSetCache } from "../../../infrastructure/redis/cache";

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
    const themes = await getOrSetCache(
      "cache:themes:active",
      86400,
      async () => {
        return this.db.theme.findMany({
          where: {
            isActive: true,
          },
          orderBy: {
            name: "asc",
          },
        });
      }
    );

    if (Array.isArray(themes)) {
      return themes.map((t) => ({
        ...t,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      }));
    }

    return themes;
  }

  /**
   * Finds a theme by its unique UUID.
   *
   * @param id The UUID of the theme
   */
  async findById(id: string): Promise<Theme | null> {
    const theme = await getOrSetCache(
      `cache:theme:${id}`,
      86400,
      async () => {
        return this.db.theme.findUnique({
          where: { id },
        });
      }
    );

    if (theme) {
      return {
        ...theme,
        createdAt: new Date(theme.createdAt),
        updatedAt: new Date(theme.updatedAt),
      };
    }

    return theme;
  }
}
