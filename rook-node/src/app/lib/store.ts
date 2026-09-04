/**
 * Local persistence for desktop-app-only state.
 *
 * Uses `tauri-plugin-store` when running in the Tauri shell, and
 * `localStorage` as a dev fallback. Stores the user's linked folders, the
 * most recent workspaces, theme preference (mirrored in the theme module),
 * and the "run on login" toggle.
 */
import { useCallback, useEffect, useState } from "react";

import { isTauri } from "./node-bridge";

type Store = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  save?(): Promise<void>;
};
// The Tauri plugin's `delete` returns `Promise<boolean>`; we coerce to void
// for our own use sites.
type AnyTauriStore = { get: <T>(k: string) => Promise<T | null>; set: <T>(k: string, v: T) => Promise<void>; delete: (k: string) => Promise<unknown>; save?: () => Promise<void> };

let _store: Store | null = null;
let _storePromise: Promise<Store> | null = null;

const PREFIX = "rook:";

async function getStore(): Promise<Store> {
  if (_store) return _store;
  if (_storePromise) return _storePromise;
  _storePromise = (async () => {
    if (isTauri()) {
      try {
        // Lazy import — only present inside the Tauri runtime.
        const mod = (await import(
          /* @vite-ignore */ "@tauri-apps/plugin-store"
        )) as unknown as { Store: { load: (f: string) => Promise<AnyTauriStore> } };
        const loaded = await mod.Store.load("rook-desktop.json");
        _store = {
          get: loaded.get.bind(loaded),
          set: loaded.set.bind(loaded),
          async delete(key) {
            await loaded.delete(key);
          },
          save: loaded.save?.bind(loaded),
        } satisfies Store;
      } catch {
        /* fall through to localStorage */
      }
    }
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
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    _store = {
      async get<T>(key: string) {
        return (memory[key] as T) ?? null;
      },
      async set<T>(key: string, value: T) {
        memory[key] = value;
        try {
          window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
        } catch {
          /* ignore */
        }
      },
      async delete(key: string) {
        delete memory[key];
        try {
          window.localStorage.removeItem(PREFIX + key);
        } catch {
          /* ignore */
        }
      },
    };
    return _store;
  })();
  return _storePromise;
}

export async function readKv<T>(key: string): Promise<T | null> {
  const store = await getStore();
  return store.get<T>(key);
}

export async function writeKv<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
}

export async function deleteKv(key: string): Promise<void> {
  const store = await getStore();
  await store.delete(key);
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
