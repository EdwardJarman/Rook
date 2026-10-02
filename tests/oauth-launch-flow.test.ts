import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const signInSource = readFileSync(
  resolve(process.cwd(), "app/sign-in.web.tsx"),
  "utf8",
);
const signUpSource = readFileSync(
  resolve(process.cwd(), "app/sign-up.web.tsx"),
  "utf8",
);

describe("public OAuth launch flow", () => {
  it("uses a same-tab redirect for sign-in provider launches", () => {
    expect(signInSource).toContain("<SignIn");
    expect(signInSource).toContain('oauthFlow="redirect"');
    expect(signInSource).toContain("forceRedirectUrl={redirectUrl}");
  });

  it("uses the same reliable OAuth launch mode for sign-up", () => {
    expect(signUpSource).toContain("<SignUp");
    expect(signUpSource).toContain('oauthFlow="redirect"');
    expect(signUpSource).toContain('signInUrl="/sign-in"');
  });
});
