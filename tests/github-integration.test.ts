import { afterEach, describe, expect, it } from "vitest";

import {
  isGithubConfigured,
  isValidRepoFullName,
} from "../server/integrations/github";
import {
  GITHUB_TOOLS,
  githubToolTraceTitle,
  parseGithubToolArguments,
} from "../server/integrations/github-tools";

const previousEnv = {
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
};

describe("GitHub connector configuration", () => {
  afterEach(() => {
    process.env.GITHUB_CLIENT_ID = previousEnv.githubClientId;
    process.env.GITHUB_CLIENT_SECRET = previousEnv.githubClientSecret;
    process.env.INTEGRATION_ENCRYPTION_KEY = previousEnv.encryptionKey;
  });

  it("reports unconfigured until both OAuth credentials and the encryption key exist", () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    process.env.INTEGRATION_ENCRYPTION_KEY =
      "test-only-integration-key-that-is-long-enough";
    expect(isGithubConfigured()).toBe(false);

    process.env.GITHUB_CLIENT_ID = "Iv1.testclient";
    expect(isGithubConfigured()).toBe(false);

    process.env.GITHUB_CLIENT_SECRET = "test-secret";
    expect(isGithubConfigured()).toBe(true);
  });
});

describe("GitHub repository identity", () => {
  it("accepts normal owner/name pairs", () => {
    expect(isValidRepoFullName("EdwardJarman/Rook")).toBe(true);
    expect(isValidRepoFullName("owner.name/repo_name")).toBe(true);
  });

  it("rejects anything that is not exactly owner/name", () => {
    expect(isValidRepoFullName("Rook")).toBe(false);
    expect(isValidRepoFullName("EdwardJarman/Rook/main")).toBe(false);
    expect(isValidRepoFullName("https://github.com/EdwardJarman/Rook")).toBe(
      false,
    );
    expect(isValidRepoFullName("")).toBe(false);
  });
});

describe("GitHub agent tools", () => {
  it("exposes exactly the three read-only tools", () => {
    expect(GITHUB_TOOLS.map((tool) => tool.function.name)).toEqual([
      "github_repo_overview",
      "github_list_files",
      "github_read_file",
    ]);
    const readFile = GITHUB_TOOLS[2].function;
    expect(readFile.parameters).toMatchObject({
      required: ["repo", "path"],
    });
  });

  it("parses a focused list-files call", () => {
    expect(
      parseGithubToolArguments(
        "github_list_files",
        JSON.stringify({
          repo: "EdwardJarman/Rook",
          path: "server",
        }),
      ),
    ).toMatchObject({ repo: "EdwardJarman/Rook", path: "server" });
  });

  it("defaults the directory path to the repository root", () => {
    expect(
      parseGithubToolArguments(
        "github_list_files",
        JSON.stringify({ repo: "EdwardJarman/Rook" }),
      ),
    ).toMatchObject({ repo: "EdwardJarman/Rook" });
  });

  it("requires a path for read-file", () => {
    expect(() =>
      parseGithubToolArguments(
        "github_read_file",
        JSON.stringify({ repo: "EdwardJarman/Rook" }),
      ),
    ).toThrow();
  });

  it("rejects a repository that is not owner/name", () => {
    expect(() =>
      parseGithubToolArguments(
        "github_repo_overview",
        JSON.stringify({ repo: "not-a-repo" }),
      ),
    ).toThrow();
  });

  it("rejects malformed JSON arguments", () => {
    expect(() =>
      parseGithubToolArguments("github_repo_overview", "{not json"),
    ).toThrow(/valid JSON/);
  });

  it("maps each tool to a human-readable trace title", () => {
    expect(githubToolTraceTitle("github_read_file")).toBe(
      "Read a GitHub repository file",
    );
    expect(githubToolTraceTitle("github_list_files")).toBe(
      "Listed GitHub repository files",
    );
    expect(githubToolTraceTitle("github_repo_overview")).toBe(
      "Reviewed a GitHub repository",
    );
  });
});
