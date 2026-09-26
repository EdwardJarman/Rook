import { useState } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  Trash2,
  RefreshCcw,
  ExternalLink,
  Plus,
} from "lucide-react";

import { Button, Card, EmptyState, IconButton, Pill, Spinner } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useLinkedFolders, useFolderListing } from "@/lib/workspaces";
import { openPath, isTauri } from "@/lib/node-bridge";

export function FilesPage() {
  const { tokens } = useTheme();
  const { folders, add, remove } = useLinkedFolders();
  const [activePath, setActivePath] = useState<string | null>(null);
  const { entries, loading, error, refresh } = useFolderListing(activePath);

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 750,
            letterSpacing: -0.4,
            color: tokens.text,
          }}
        >
          Files
        </h1>
        <Pill label={`${folders.length} folder${folders.length === 1 ? "" : "s"}`} tone="muted" />
        <div style={{ flex: 1 }} />
        <Button
          onClick={async () => {
            const folder = await add();
            if (folder) setActivePath(folder.path);
          }}
        >
          <Plus size={14} /> Open folder
        </Button>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: 14,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Card padding={12} style={{ overflow: "auto" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              color: tokens.textFaint,
              padding: "4px 6px 8px",
            }}
          >
            Linked folders
          </div>
          {folders.length === 0 ? (
            <div
              style={{
                fontSize: 12.5,
                color: tokens.textFaint,
                padding: "8px 6px",
              }}
            >
              No folders yet. Open one to give your Bots a place to read and
              write — just like Codex and Claude.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActivePath(f.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background:
                      f.path === activePath
                        ? tokens.accentSoft
                        : "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    color: tokens.text,
                  }}
                >
                  {f.path === activePath ? (
                    <FolderOpen size={15} color={tokens.accent} />
                  ) : (
                    <Folder size={15} color={tokens.textSoft} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: tokens.textFaint,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.path}
                    </div>
                  </div>
                  <IconButton
                    label="Forget folder"
                    onClick={() => {
                      if (activePath === f.path) setActivePath(null);
                      remove(f.id);
                    }}
                    size={28}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card padding={0} style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {activePath ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 14px",
                  borderBottom: `1px solid ${tokens.line}`,
                }}
              >
                <FolderOpen size={15} color={tokens.accent} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{activePath.split(/[\\/]/).pop()}</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: tokens.textFaint,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activePath}
                  </div>
                </div>
                <IconButton label="Refresh" onClick={refresh}>
                  <RefreshCcw size={14} />
                </IconButton>
                <IconButton label="Open in file manager" onClick={() => openPath(activePath)}>
                  <ExternalLink size={14} />
                </IconButton>
              </div>
              <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
                {loading ? (
                  <div
                    style={{
                      display: "grid",
                      placeItems: "center",
                      padding: 40,
                      color: tokens.textSoft,
                    }}
                  >
                    <Spinner />
                  </div>
                ) : error ? (
                  <EmptyState
                    title="Couldn't read this folder"
                    body={error + (isTauri() ? "" : " (this only works inside the desktop app)")}
                  />
                ) : entries.length === 0 ? (
                  <EmptyState title="Empty folder" body="Pick a folder with files, or drop one in." />
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {entries.map((entry) => (
                      <li
                        key={entry.path}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 14px",
                          borderBottom: `1px solid ${tokens.line}`,
                          fontSize: 13,
                          cursor: entry.isDirectory ? "pointer" : "default",
                        }}
                      >
                        {entry.isDirectory ? (
                          <Folder size={14} color={tokens.textSoft} />
                        ) : (
                          <FileText size={14} color={tokens.textFaint} />
                        )}
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.name}
                        </span>
                        {!entry.isDirectory && entry.size ? (
                          <span style={{ fontSize: 11, color: tokens.textFaint }}>
                            {formatBytes(entry.size)}
                          </span>
                        ) : null}
                        <IconButton
                          label="Open"
                          size={26}
                          onClick={() => openPath(entry.path)}
                        >
                          <ChevronRight size={12} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Folder size={20} />}
              title="Open a folder to begin"
              body="Pick a folder on this computer and your Bots will be able to read and write files there."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
