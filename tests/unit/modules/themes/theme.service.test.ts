import { describe, it, expect, vi } from "vitest";
import { ThemeService } from "../../../../src/modules/themes/services/theme.service";
import { ThemeRepository } from "../../../../src/modules/themes/repositories/theme.repository";

describe("ThemeService", () => {
  const mockRepo = {
    findActiveThemes: vi.fn().mockResolvedValue([
      { id: "018d-theme-1", key: "classic-serif", name: "Classic Serif", isActive: true }
    ]),
    findById: vi.fn()
  } as unknown as ThemeRepository;
  const service = new ThemeService(mockRepo);

  it("should return active themes", async () => {
    const themes = await service.listActiveThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0].key).toBe("classic-serif");
  });

  it("should return theme by id", async () => {
    const mockTheme = {
      id: "018d-theme-1",
      key: "classic-serif",
      name: "Classic Serif",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    vi.mocked(mockRepo.findById).mockResolvedValueOnce(mockTheme as any);

    const theme = await service.getThemeById("018d-theme-1");
    expect(theme).toEqual(mockTheme);
    expect(mockRepo.findById).toHaveBeenCalledWith("018d-theme-1");
  });
});
