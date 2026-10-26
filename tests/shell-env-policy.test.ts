import { describe, expect, it } from "vitest";

import { filterShellEnv } from "../server/integrations/shell-env-policy";

const ENV = {
  PATH: "/bin",
  HOME: "/home/u",
  OPENROUTER_API_KEY: "sk-x",
  MY_TOKEN: "t",
  MY_SECRET_VALUE: "s",
  ACME_FLAG: "1",
  CI_BUILD: "7",
};

describe("grok shell env policy (secrets never reach children)", () => {
  it("default drops secret patterns, keeps the rest", () => {
    const out = filterShellEnv(ENV, {});
    expect(out.PATH).toBe("/bin");
    expect(out.OPENROUTER_API_KEY).toBeUndefined();
    expect(out.MY_TOKEN).toBeUndefined();
    expect(out.MY_SECRET_VALUE).toBeUndefined();
    expect(out.ACME_FLAG).toBe("1");
  });

  it("ignoreDefaultExcludes restores untouched passthrough", () => {
    const out = filterShellEnv(ENV, { ignoreDefaultExcludes: true });
    expect(out.MY_TOKEN).toBe("t");
  });

  it("exclude + set + includeOnly compose in order", () => {
    const out = filterShellEnv(ENV, {
      exclude: ["ACME_*", "CI_*"],
      set: { MY_FLAG: "1" },
      includeOnly: ["PATH", "MY_FLAG"],
    });
    expect(out).toEqual({ PATH: "/bin", MY_FLAG: "1" });
  });

  it("core inherit starts from the small platform set", () => {
    const out = filterShellEnv(ENV, { inherit: "core" });
    expect(out.PATH).toBe("/bin");
    expect(out.HOME).toBe("/home/u");
    expect(out.ACME_FLAG).toBeUndefined();
    expect(filterShellEnv(ENV, { inherit: "none" })).toEqual({});
  });
});
