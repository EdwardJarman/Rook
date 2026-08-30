import { ClerkProvider } from "@clerk/clerk-react";
import { type ReactNode } from "react";

/**
 * Reads the Clerk publishable key from Vite env. The Tauri shell injects
 * `VITE_CLERK_PUBLISHABLE_KEY` at build time; in dev, set it in a local
 * .env file.
 */
function readPublishableKey(): string {
  const env = (import.meta as unknown as { env: Record<string, string> }).env;
  return env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
}

export function ClerkProviderRook({ children }: { children: ReactNode }) {
  const key = readPublishableKey();
  if (!key) {
    // Render children anyway so the rest of the app is usable while a
    // publishable key is being wired up. Routes that need auth will still
    // see `isSignedIn = false`.
    return <>{children}</>;
  }
  return (
    <ClerkProvider
      publishableKey={key}
      // We rely on the same hosted Clerk account the web app uses.
      // `signInUrl` / `signUpUrl` are intentionally not set — the sign-in
      // page is rendered in-app (see <SignInPage />).
      afterSignInUrl="/"
      afterSignUpUrl="/"
      appearance={{
        variables: {
          colorPrimary: "#0E7C59",
          borderRadius: "12px",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Text", Roboto, sans-serif',
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
