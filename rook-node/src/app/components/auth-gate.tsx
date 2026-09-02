import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { type ReactNode, useEffect, useState } from "react";

import { SignInPage } from "@/routes/sign-in";

/**
 * Reads the Clerk publishable key from Vite env. The Tauri shell injects
 * `VITE_CLERK_PUBLISHABLE_KEY` at build time; in dev, set it in a local
 * .env file.
 */
function readPublishableKey(): string {
  const env = (import.meta as unknown as { env: Record<string, string> }).env;
  return env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
}

/**
 * Wraps the app shell. When the user is not signed in, only the sign-in
 * page is shown. Once signed in, the rest of the router becomes available.
 *
 * Falls back to a "no auth configured" state when the Clerk publishable
 * key is missing — better than crashing the whole window at first paint.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const hasKey = Boolean(readPublishableKey());
  if (!hasKey) return <NoClerkKeyScreen>{children}</NoClerkKeyScreen>;
  return (
    <ClerkProvider publishableKey={readPublishableKey()} afterSignInUrl="/" afterSignUpUrl="/">
      <AuthGateInner>{children}</AuthGateInner>
    </ClerkProvider>
  );
}

function AuthGateInner({ children }: { children: ReactNode }) {
  // Clerk's `isSignedIn` is null while loading.
  const { isSignedIn, isLoaded } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  // If Clerk never finishes loading (network blocked, key invalid, etc.)
  // surface a clear error after 8 s rather than hanging on "Loading…".
  useEffect(() => {
    if (isLoaded) return;
    const id = setTimeout(() => setTimedOut(true), 8_000);
    return () => clearTimeout(id);
  }, [isLoaded]);
  if (!isLoaded) {
    if (timedOut) return <SignInUnavailableScreen />;
    return <LoadingScreen label="Checking your secure session…" />;
  }
  if (!isSignedIn) return <SignInPage />;
  return <>{children}</>;
}

function NoClerkKeyScreen({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "1fr auto" }}>
      <div
        style={{
          padding: 24,
          overflow: "auto",
          background: "var(--rook-canvas)",
          color: "var(--rook-text)",
        }}
      >
        {children}
      </div>
      <div
        style={{
          padding: "10px 16px",
          background: "var(--rook-amber-soft)",
          color: "var(--rook-amber)",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        Clerk publishable key is not configured. Set
        `VITE_CLERK_PUBLISHABLE_KEY` when building the desktop app to enable
        sign-in. The rest of the app is still usable.
      </div>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        color: "var(--rook-text-soft)",
        fontSize: 13,
      }}
    >
      {label}
    </div>
  );
}

function SignInUnavailableScreen() {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--rook-canvas)",
        color: "var(--rook-text)",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Sign-in unavailable</h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 13,
            color: "var(--rook-text-soft)",
            lineHeight: 1.55,
          }}
        >
          Rook couldn't reach Clerk to check your session. Check your
          internet connection, then relaunch the app. The local Rook Node
          sidecar is still running in the background.
        </p>
      </div>
    </div>
  );
}
