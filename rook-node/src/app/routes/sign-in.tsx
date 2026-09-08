import { SignIn, SignUp } from "@clerk/clerk-react";
import { useState } from "react";

import { Cpu } from "lucide-react";

import { Button } from "@/components/primitives";
import { useTheme } from "@/lib/theme";

/**
 * Full-window sign-in surface.
 *
 * Uses Clerk's hosted component, themed to match Rook. Toggling between
 * sign-in and sign-up is a local state change so we don't need to navigate
 * away and lose the desktop window context.
 */
export function SignInPage() {
  const { tokens } = useTheme();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const clerkKey = (import.meta as unknown as { env: Record<string, string> })
    .env.VITE_CLERK_PUBLISHABLE_KEY;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
        height: "100vh",
        background: tokens.canvas,
      }}
    >
      <aside
        style={{
          background: tokens.surface,
          borderRight: `1px solid ${tokens.line}`,
          padding: "40px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              background: tokens.ink,
              color: tokens.onInk,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Cpu size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>
              Rook
            </div>
            <div
              style={{
                fontSize: 11,
                color: tokens.textFaint,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              Your workroom
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 420 }}>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 750,
              letterSpacing: -0.6,
              margin: 0,
              lineHeight: 1.1,
              color: tokens.text,
            }}
          >
            A calm place to run your Bots.
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 1.55,
              color: tokens.textSoft,
            }}
          >
            Rook keeps your chats, files, and Bots on this computer. Sign in
            to continue your workroom, then connect this computer to your
            account so your Bots can run here.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            color: tokens.textFaint,
            fontSize: 12,
          }}
        >
          <Button
            variant={mode === "sign-in" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </Button>
          <Button
            variant={mode === "sign-up" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setMode("sign-up")}
          >
            Create account
          </Button>
        </div>
      </aside>

      <section
        style={{
          display: "grid",
          placeItems: "center",
          padding: 32,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: tokens.surface,
            border: `1px solid ${tokens.line}`,
            borderRadius: 20,
            padding: 22,
            boxShadow: "0 18px 44px rgba(16,18,24,0.08)",
          }}
        >
          {clerkKey ? (
            mode === "sign-in" ? (
              <SignIn
                routing="hash"
                afterSignInUrl="/"
                appearance={{
                  elements: { card: { boxShadow: "none", border: "none" } },
                  variables: { colorPrimary: tokens.accent, borderRadius: "12px" },
                }}
              />
            ) : (
              <SignUp
                routing="hash"
                afterSignUpUrl="/"
                appearance={{
                  elements: { card: { boxShadow: "none", border: "none" } },
                  variables: { colorPrimary: tokens.accent, borderRadius: "12px" },
                }}
              />
            )
          ) : (
            <div
              style={{
                padding: 18,
                color: tokens.textSoft,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 15,
                  color: tokens.text,
                }}
              >
                Set VITE_CLERK_PUBLISHABLE_KEY
              </h2>
              <p style={{ marginTop: 8 }}>
                The desktop app uses the same Clerk account as the web app.
                Add the publishable key to your Tauri build environment to
                enable sign-in.
              </p>
              <pre
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: tokens.surfaceAlt,
                  border: `1px solid ${tokens.line}`,
                  borderRadius: 12,
                  fontSize: 12,
                  color: tokens.text,
                }}
              >
                VITE_CLERK_PUBLISHABLE_KEY=pk_test_…
              </pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
