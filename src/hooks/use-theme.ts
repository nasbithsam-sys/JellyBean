import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "theme";

function read(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(t);
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    // Local storage can be unavailable in restricted browsing modes.
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const t = read();
    setTheme(t);
    apply(t);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    // Enable the slow crossfade transition only during the switch, then
    // remove it so it doesn't affect ordinary hover/focus interactions.
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.add("theme-transition");
      window.setTimeout(() => root.classList.remove("theme-transition"), 800);
    }
    setTheme(next);
    apply(next);
  };

  return { theme, toggle };
}
