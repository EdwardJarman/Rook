/**
 * Local persistence for desktop-app-only state: linked folders, recent
 * workspaces, theme preference, bots, and conversation history.
 *
 * Backed by WebView2's localStorage under the app's own profile dir
 * (%LOCALAPPDATA%/com.rook.desktop/EBWebView). This is deliberate: it
 * survives app restarts and reinstalls, needs no extra permissions, and
 * was the only path that ever actually persisted here — the
 * tauri-plugin-store JS route silently failed (file stayed `{}`) while the
 * catch swallowed the error, so the plugin branch was removed. If the
 * 5–10 MB localStorage quota ever becomes a constraint, revisit with
 * read_text_file/write_text_file through the existing shell commands.
 */
import { useCallback, useEffect, useState } from "react";

const PREFIX = "rook:";

function memoryFallback(): Record<string, unknown> {
  const memory: Record<string, unknown> = {};
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX)) {
          const v = window.localStorage.getItem(k);
          if (v !== null) {
            try {
              memory[k.slice(PREFIX.length)] = JSON.parse(v);
            } catch {
              /* ignore malformed entries */
            }
          }
        }
      }
    } catch {
      /* private mode etc. — memory only */
    }
  }
  return memory;
}

let memory: Record<string, unknown> | null = null;

function ensureMemory(): Record<string, unknown> {
  if (!memory) memory = memoryFallback();
  return memory;
}

export async function readKv<T>(key: string): Promise<T | null> {
  const mem = ensureMemory();
  return (mem[key] as T) ?? null;
}

export async function writeKv<T>(key: string, value: T): Promise<void> {
  const mem = ensureMemory();
  mem[key] = value;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota exceeded or storage blocked — memory-only for this session */
  }
}

export async function deleteKv(key: string): Promise<void> {
  const mem = ensureMemory();
  delete mem[key];
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function useKv<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let cancelled = false;
    void readKv<T>(key).then((stored) => {
      if (!cancelled && stored !== null) setValue(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      void writeKv(key, next);
    },
    [key],
  );

  return [value, update];
}
