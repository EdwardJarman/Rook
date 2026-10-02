import { useAuth as useClerkAuth, useUser } from "@clerk/expo";
import { useCallback, useMemo } from "react";

export type RookAuthUser = {
  id: string;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: "clerk" | "google" | "github" | "apple";
  lastSignedIn: Date;
};

/**
 * Keeps the app's existing auth-facing interface while sourcing all session
 * state and sign-out behavior from Clerk.
 */
export function useAuth() {
  const { isLoaded, isSignedIn, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();

  const user = useMemo<RookAuthUser | null>(() => {
    if (!isSignedIn || !clerkUser) return null;
    // Detect the OAuth provider the user actually signed in with so the UI can
    // show "Google" / "GitHub" / "Apple" instead of falling back to "Clerk".
    let loginMethod: RookAuthUser["loginMethod"] = "clerk";
    const externalProvider = clerkUser.externalAccounts?.find(
      (account) => account.verification?.status === "verified",
    );
    if (externalProvider) {
      const provider = externalProvider.provider.toLowerCase();
      if (provider.includes("google")) loginMethod = "google";
      else if (provider.includes("github")) loginMethod = "github";
      else if (provider.includes("apple")) loginMethod = "apple";
    }
    return {
      id: `clerk:${clerkUser.id}`,
      openId: `clerk:${clerkUser.id}`,
      name: clerkUser.fullName || clerkUser.username || null,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      loginMethod,
      lastSignedIn: new Date(clerkUser.lastSignInAt ?? Date.now()),
    };
  }, [clerkUser, isSignedIn]);

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return {
    user,
    loading: !isLoaded,
    error: null,
    isAuthenticated: Boolean(isSignedIn && user),
    refresh: async () => undefined,
    logout,
  };
}
