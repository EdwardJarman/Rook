/**
 * Linked-folder workspaces — the Codex/Claude-style "open a folder" model.
 *
 * A workspace is a user-picked absolute path on the local filesystem. The
 * desktop window can browse it (subject to the Tauri fs scope), read/write
 * small text files, and attach files to chat messages. The list is also
 * mirrored to the Rook server (per the `nodes.linkedFolders` tRPC router)
 * so the user sees the same workspaces on every device.
 */
import { useCallback, useEffect, useState } from "react";

import { pickFolder, listDir, type FileEntry } from "./node-bridge";
import { useKv } from "./store";

export type LinkedFolder = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastUsedAt: string;
};

const KEY = "linked-folders";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `lf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function useLinkedFolders(): {
  folders: LinkedFolder[];
  loading: boolean;
  add: () => Promise<LinkedFolder | null>;
  remove: (id: string) => void;
  markUsed: (id: string) => void;
  recent: LinkedFolder[];
} {
  const [folders, setFolders] = useKv<LinkedFolder[]>(KEY, []);
  const [loading, setLoading] = useState(false);

  const add = useCallback(async () => {
    setLoading(true);
    try {
      const path = await pickFolder();
      if (!path) return null;
      const entry: LinkedFolder = {
        id: newId(),
        name: deriveName(path),
        path,
        addedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      setFolders([entry, ...folders.filter((f) => f.path !== path)]);
      return entry;
    } finally {
      setLoading(false);
    }
  }, [folders, setFolders]);

  const remove = useCallback(
    (id: string) => {
      setFolders(folders.filter((f) => f.id !== id));
    },
    [folders, setFolders],
  );

  const markUsed = useCallback(
    (id: string) => {
      setFolders(
        folders
          .map((f) =>
            f.id === id ? { ...f, lastUsedAt: new Date().toISOString() } : f,
          )
          .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
      );
    },
    [folders, setFolders],
  );

  return {
    folders,
    loading,
    add,
    remove,
    markUsed,
    recent: [...folders]
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, 6),
  };
}

export function useFolderListing(path: string | null): {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDir(path)
      .then((res) => {
        if (cancelled) return;
        setEntries(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { entries, loading, error, refresh: () => setTick((n) => n + 1) };
}
