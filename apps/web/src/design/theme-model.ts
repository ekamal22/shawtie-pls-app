export type ThemeName = "dawn" | "midnight";
export type ThemePreference = ThemeName | "system";

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Follow my phone",
  dawn: "Dawn",
  midnight: "Midnight",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dawn" || value === "midnight" || value === "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ThemeName {
  if (preference === "system") return systemPrefersDark ? "midnight" : "dawn";
  return preference;
}
