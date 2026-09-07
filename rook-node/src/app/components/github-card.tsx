import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  Github as GithubIcon,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { Button, Card, Input, Pill, Spinner } from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { currentToken } from "@/lib/send-bridge";
import { getTrpcClient } from "@/lib/trpc";

type GithubStatus = {
  configured: boolean;
  connected: boolean;
  needsReauthorization: boolean;
  login: string | null;
  displayName: string | null;
  selectedRepos: Array<{
    fullName: string;
    description: string | null;
    privateRepo: boolean;
    defaultBranch: string | null;
    addedAt: string;
  }>;
};

type GithubRepo = {
  id: number;
  fullName: string;
  description: string | null;
  privateRepo: boolean;
  defaultBranch: string | null;
  language: string | null;
  updatedAt: string | null;
  htmlUrl: string;
};

type GithubRouter = {
  status: { query: () => Promise<GithubStatus> };
  authorizationUrl: {
    mutate: (input: { returnTo?: string }) => Promise<string>;
  };
  disconnect: { mutate: () => Promise<{ ok: boolean }> };
  repos: { query: (input?: { search?: string }) => Promise<GithubRepo[]> };
  selectRepo: { mutate: (input: { fullName: string }) => Promise<unknown> };
  unselectRepo: {
    mutate: (input: { fullName: string }) => Promise<{ ok: boolean }>;
  };
};

function githubRouter() {
  const client = getTrpcClient(currentToken);
  return client as unknown as { github: GithubRouter };
}

/**
 * GitHub connector card for the desktop Account page. Uses the same imperative
 * tRPC client as the chat send-bridge (the desktop app does not mount a tRPC
 * hooks provider).
 */
export function GithubCard() {
  const { tokens } = useTheme();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await githubRouter().status.query());
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Could not reach the Rook server.");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadRepos = useCallback(async () => {
    try {
      setRepos(await githubRouter().repos.query());
    } catch (err) {
      setError((err as Error).message || "Could not list repositories.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (browserOpen && status?.connected && repos === null) void loadRepos();
  }, [browserOpen, status?.connected, repos, loadRepos]);

  const connected = status?.connected === true;
  const selected = status?.selectedRepos ?? [];
  const term = search.trim().toLowerCase();
  const candidates = useMemo(
    () =>
      (repos ?? []).filter(
        (repo) => !term || repo.fullName.toLowerCase().includes(term),
      ),
    [repos, term],
  );

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await githubRouter().authorizationUrl.mutate({});
      window.open(url, "_blank", "noopener");
      setError(null);
    } catch (err) {
      setError(
        (err as Error).message || "Could not start the GitHub connection.",
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await githubRouter().disconnect.mutate();
      setBrowserOpen(false);
      setRepos(null);
      await loadStatus();
    } catch (err) {
      setError((err as Error).message || "Could not disconnect GitHub.");
    } finally {
      setBusy(false);
    }
  };

  const addRepo = async (fullName: string) => {
    setBusy(true);
    try {
      await githubRouter().selectRepo.mutate({ fullName });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message || "Could not add that repository.");
    } finally {
      setBusy(false);
    }
  };

  const removeRepo = async (fullName: string) => {
    setBusy(true);
    try {
      await githubRouter().unselectRepo.mutate({ fullName });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message || "Could not remove that repository.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: tokens.accentSoft,
            color: tokens.accent,
          }}
        >
          <GithubIcon size={19} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>
            GitHub
          </div>
          <div style={{ fontSize: 12.5, color: tokens.textSoft, marginTop: 2 }}>
            Pick repositories for your Bots to read while you chat.
          </div>
        </div>
        {status === null ? (
          <Spinner />
        ) : (
          <Pill
            label={
              connected
                ? "Connected"
                : status.needsReauthorization
                  ? "Reconnect"
                  : status.configured
                    ? "Available"
                    : "Setup needed"
            }
            tone={
              connected
                ? "mint"
                : status.needsReauthorization
                  ? "amber"
                  : "muted"
            }
          />
        )}
      </div>

      {connected ? (
        <>
          <div
            style={{ fontSize: 12.5, color: tokens.textSoft, marginTop: 10 }}
          >
            @{status?.login ?? "github"} · read-only repository access
          </div>

          {selected.length ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: tokens.textFaint,
                  textTransform: "uppercase",
                }}
              >
                Repositories your Bots can read ({selected.length}/25)
              </div>
              {selected.map((repo) => (
                <div
                  key={repo.fullName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    border: `1px solid ${tokens.line}`,
                    borderRadius: 12,
                    padding: "8px 11px",
                  }}
                >
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
                      {repo.fullName}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: tokens.textFaint,
                        marginTop: 1,
                      }}
                    >
                      {repo.privateRepo ? "Private" : "Public"}
                      {repo.defaultBranch ? ` · ${repo.defaultBranch}` : ""}
                    </div>
                  </div>
                  <a
                    href={`https://github.com/${repo.fullName}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: tokens.textFaint }}
                    aria-label={`Open ${repo.fullName} on GitHub`}
                  >
                    <ExternalLink size={14} />
                  </a>
                  <button
                    onClick={() => void removeRepo(repo.fullName)}
                    disabled={busy}
                    aria-label={`Remove ${repo.fullName}`}
                    style={{
                      background: "none",
                      border: "none",
                      color: tokens.textFaint,
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12.5,
                color: tokens.textSoft,
                lineHeight: 1.5,
              }}
            >
              No repositories selected yet. Add one or more below and your Bots
              can read their files in chat.
            </p>
          )}

          <div
            style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}
          >
            <Button
              variant="secondary"
              onClick={() => setBrowserOpen((open) => !open)}
            >
              {browserOpen ? (
                "Hide repositories"
              ) : (
                <>
                  <Plus size={14} /> Add repositories
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={() => void loadStatus()}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>

          {browserOpen ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 12,
              }}
            >
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your repositories"
              />
              {repos === null ? (
                <Spinner />
              ) : (
                <div
                  style={{
                    maxHeight: 260,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                  }}
                >
                  {candidates.slice(0, 60).map((repo) => {
                    const picked = selected.some(
                      (pickedRepo) =>
                        pickedRepo.fullName.toLowerCase() ===
                        repo.fullName.toLowerCase(),
                    );
                    return (
                      <button
                        key={repo.fullName}
                        onClick={() =>
                          void (picked
                            ? removeRepo(repo.fullName)
                            : addRepo(repo.fullName))
                        }
                        disabled={busy}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          textAlign: "left",
                          border: `1px solid ${picked ? tokens.accent : tokens.line}`,
                          borderRadius: 12,
                          padding: "8px 11px",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
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
                            {repo.fullName}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: tokens.textFaint,
                              marginTop: 1,
                            }}
                          >
                            {repo.privateRepo ? "Private" : "Public"}
                            {repo.language ? ` · ${repo.language}` : ""}
                          </div>
                        </div>
                        {picked ? (
                          <Check size={16} color={tokens.accent} />
                        ) : (
                          <Plus size={16} color={tokens.textFaint} />
                        )}
                      </button>
                    );
                  })}
                  {!candidates.length ? (
                    <div style={{ fontSize: 12, color: tokens.textFaint }}>
                      No matching repositories in the first 200 Rook found.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <Button
              variant="danger"
              onClick={() => void disconnect()}
              disabled={busy}
            >
              Disconnect GitHub
            </Button>
          </div>
        </>
      ) : (
        <>
          <p
            style={{
              margin: "10px 0 12px",
              fontSize: 12.5,
              color: tokens.textSoft,
              lineHeight: 1.5,
            }}
          >
            {status?.needsReauthorization
              ? "Rook's GitHub access expired. Reconnect to keep working with your repositories."
              : "Sign in with GitHub to let your Bots read the repositories you choose. Rook never asks for your password and never writes to your repositories."}
          </p>
          <Button onClick={() => void connect()} disabled={busy}>
            {status?.needsReauthorization
              ? "Reconnect GitHub"
              : "Connect GitHub"}
          </Button>
          {connected === false && status ? (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11.5,
                color: tokens.textFaint,
              }}
            >
              After authorizing in your browser, come back and the connection
              appears here.
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: tokens.coral }}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
