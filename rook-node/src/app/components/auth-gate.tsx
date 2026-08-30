import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { type ReactNode } from "react";

import { SignInPage } from "@/routes/sign-in";

/**
 * Wraps the app shell. When the user is not signed in, only the sign-in
 * page is shown. Once signed in, the rest of the router becomes available.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Clerk's `isSignedIn` is null while loading.
  const { isSignedIn, isLoaded } = useClerkAuth();
  if (!isLoaded) {
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
        Loading…
      </div>
    );
  }
  if (!isSignedIn) return <SignInPage />;
  return <>{children}</>;
}
