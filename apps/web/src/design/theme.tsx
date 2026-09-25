import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

export type ThemeName = "dawn" | "midnight";
export type ThemePreference = ThemeName | "system";

const STORAGE_KEY = "shawtie:theme";

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Follow my phone",
  dawn: "Dawn",
  midnight: "Midnight",
};

function isPreference(value: unknown): value is ThemePreference {
  return value === "dawn" || value === "midnight" || value === "system";
}

/** Reads the client-local preference. Never throws (storage may be blocked). */
export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The preference is a convenience only; the app renders correctly without it.
  }
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ThemeName {
  if (preference === "system") return systemPrefersDark ? "midnight" : "dawn";
  return preference;
}

const THEME_COLORS: Record<ThemeName, string> = { dawn: "#f6f0e7", midnight: "#15121a" };

/** Applies the theme to the document root and the browser chrome color. */
export function applyThemePreference(preference: ThemePreference): ThemeName {
  const root = document.documentElement;
  const dark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(preference, dark);
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", THEME_COLORS[resolved]));
  return resolved;
}

/** Call once before first render so the first paint already uses the stored theme. */
export function initTheme(): void {
  applyThemePreference(readThemePreference());
}

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ThemeName;
  setPreference(preference: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<ThemeName>(() => applyThemePreference(preference));

  useEffect(() => {
    setResolved(applyThemePreference(preference));
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyThemePreference("system"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}
