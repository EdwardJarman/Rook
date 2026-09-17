import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearProfile, configPath, DEFAULT_API_URL, loadProfile, saveProfile } from "./config.js";

let dir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  dir = mkdtempSync(join(tmpdir(), "rook-cli-"));
  vi.stubEnv("ROOK_CONFIG_DIR", dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("cli config", () => {
  it("defaults to localhost with no token", () => {
    expect(loadProfile()).toEqual({ apiUrl: DEFAULT_API_URL, token: null });
  });

  it("round-trips apiUrl and token", () => {
    saveProfile({ apiUrl: "https://api.example.com/", token: "rook_abc" });
    expect(loadProfile()).toEqual({ apiUrl: "https://api.example.com", token: "rook_abc" });
    expect(configPath().startsWith(dir)).toBe(true);
  });

  it("lets env override file, and clears cleanly", () => {
    saveProfile({ apiUrl: "https://file.example.com", token: "rook_file" });
    vi.stubEnv("ROOK_API_URL", "https://env.example.com/");
    vi.stubEnv("ROOK_TOKEN", "rook_env");
    expect(loadProfile()).toEqual({ apiUrl: "https://env.example.com", token: "rook_env" });
    vi.unstubAllEnvs();
    vi.stubEnv("ROOK_CONFIG_DIR", dir);
    clearProfile();
    expect(loadProfile()).toEqual({ apiUrl: DEFAULT_API_URL, token: null });
  });

  it("survives a corrupt config file", () => {
    saveProfile({ apiUrl: DEFAULT_API_URL, token: null });
    writeFileSync(configPath(), "{oops");
    expect(loadProfile()).toEqual({ apiUrl: DEFAULT_API_URL, token: null });
  });
});
