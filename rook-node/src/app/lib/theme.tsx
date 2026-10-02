import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  tokensFor,
  type ResolvedScheme,
  type Scheme,
  type Tokens,
} from "./tokens";

export type { Scheme, ResolvedScheme, Tokens } from "./tokens";

type ThemeState = {
  scheme: Scheme;
  resolved: ResolvedScheme;
  tokens: Tokens;
  setScheme: (next: Scheme) => void;
  cycle: () => void;
};

const STORAGE_KEY = "rook:theme";

const ThemeContext = createContext<ThemeState | null>(null);

function readSystem(): ResolvedScheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyClass(scheme: ResolvedScheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
}

function loadInitial(): Scheme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>(() => loadInitial());
  const [system, setSystem] = useState<ResolvedScheme>(() => readSystem());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const resolved: ResolvedScheme = scheme === "system" ? system : scheme;

  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  const setScheme = useCallback((next: Scheme) => {
    setSchemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const cycle = useCallback(() => {
    setSchemeState((prev) => {
      const next: Scheme = prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [setScheme]);

  const value = useMemo<ThemeState>(
    () => ({ scheme, resolved, tokens: tokensFor(resolved), setScheme, cycle }),
    [scheme, resolved, setScheme, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      scheme: "system",
      resolved: "light",
      tokens: tokensFor("light"),
      setScheme: () => undefined,
      cycle: () => undefined,
    };
  }
  return ctx;
}
