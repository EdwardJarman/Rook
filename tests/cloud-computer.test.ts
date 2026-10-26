import { afterEach, describe, expect, it } from "vitest";

import {
  cloudMissingEnvVars,
  cloudNodeId,
  isCloudComputerConfigured,
  isCloudNodeId,
  isCloudSensitiveCapability,
  normalizeCloudRelPath,
} from "../server/integrations/cloud-computer";
import {
  CLOUD_SENSITIVE_TOOL_NAMES,
  CLOUD_TOOLS,
  CLOUD_TOOL_NAMES,
  cloudCommandSummary,
  parseCloudToolArguments,
} from "../server/integrations/cloud-tools";

const previousKey = process.env.E2B_API_KEY;

describe("cloud computer configuration", () => {
  afterEach(() => {
    process.env.E2B_API_KEY = previousKey;
  });

  it("reports unconfigured until E2B_API_KEY exists", () => {
    delete process.env.E2B_API_KEY;
    expect(isCloudComputerConfigured()).toBe(false);
    expect(cloudMissingEnvVars()).toEqual(["E2B_API_KEY"]);

    process.env.E2B_API_KEY = "  e2b-test-key  ";
    expect(isCloudComputerConfigured()).toBe(true);
    expect(cloudMissingEnvVars()).toEqual([]);
  });
});

describe("cloud node identity", () => {
  it("embeds the user id so command queues never cross accounts", () => {
    const nodeId = cloudNodeId("user-123");
    expect(nodeId).toBe("cloud-user-123");
    expect(isCloudNodeId(nodeId)).toBe(true);
    expect(isCloudNodeId("cloud-")).toBe(true);
    expect(isCloudNodeId("desktop-node")).toBe(false);
  });
});

describe("cloud capability classification", () => {
  it("treats shell and file writes as sensitive, reads as not", () => {
    expect(isCloudSensitiveCapability("shell")).toBe(true);
    expect(isCloudSensitiveCapability("files-write")).toBe(true);
    expect(isCloudSensitiveCapability("files-read")).toBe(false);
  });
});

describe("cloud path normalization", () => {
  it("rejects absolute paths", () => {
    expect(() => normalizeCloudRelPath("/etc/passwd")).toThrow();
    expect(() => normalizeCloudRelPath("C:\\Windows")).toThrow();
    expect(() => normalizeCloudRelPath("\\\\server\\share")).toThrow();
  });

  it("rejects traversal outside the workspace", () => {
    expect(() => normalizeCloudRelPath("../secret")).toThrow();
    expect(() => normalizeCloudRelPath("a/../../b")).toThrow();
  });

  it("rejects null bytes", () => {
    expect(() => normalizeCloudRelPath("a\0b")).toThrow();
  });

  it("normalizes relative paths and separators", () => {
    expect(normalizeCloudRelPath("reports/notes.md")).toBe("reports/notes.md");
    expect(normalizeCloudRelPath("  reports\\notes.md  ")).toBe(
      "reports/notes.md",
    );
    expect(normalizeCloudRelPath(".")).toBe("");
  });
});

describe("cloud tools", () => {
  it("declares exactly the tools it can execute", () => {
    const names = CLOUD_TOOLS.map((tool) => tool.function.name);
    expect(names.sort()).toEqual([...CLOUD_TOOL_NAMES].sort());
  });

  it("marks run-command and write-file as sensitive", () => {
    expect(CLOUD_SENSITIVE_TOOL_NAMES.has("computer_run_command")).toBe(true);
    expect(CLOUD_SENSITIVE_TOOL_NAMES.has("computer_write_file")).toBe(true);
    expect(CLOUD_SENSITIVE_TOOL_NAMES.has("computer_read_file")).toBe(false);
    expect(CLOUD_SENSITIVE_TOOL_NAMES.has("computer_list_files")).toBe(false);
  });

  it("parses valid arguments and rejects bad ones", () => {
    const run = parseCloudToolArguments(
      "computer_run_command",
      JSON.stringify({ command: "ls -la", cwd: "work" }),
    );
    expect(run).toEqual({ command: "ls -la", cwd: "work" });

    expect(() =>
      parseCloudToolArguments("computer_run_command", "not-json"),
    ).toThrow(/valid JSON/);

    expect(() =>
      parseCloudToolArguments("computer_run_command", "{}"),
    ).toThrow(/command/);

    expect(() =>
      parseCloudToolArguments(
        "computer_read_file",
        JSON.stringify({ path: "/etc/passwd" }),
      ),
    ).toThrow(/relative/);
  });

  it("builds human summaries for proposals", () => {
    expect(
      cloudCommandSummary("computer_run_command", {
        command: "npm test",
        cwd: "app",
      }),
    ).toBe("Run shell command in app: npm test");
    expect(
      cloudCommandSummary("computer_write_file", {
        path: "notes.md",
        content: "hi",
      }),
    ).toBe("Write file notes.md in the cloud workspace");
  });
});
