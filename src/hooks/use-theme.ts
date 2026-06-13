import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "theme";

function read(): Theme {
  return "light";
}

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("light");
  root.classList.remove("dark");
  try {
    window.localStorage.setItem(KEY, "light");
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
    setTheme("light");
    apply("light");
  };

  return { theme, toggle };
}
