import { createContext, useContext, type ReactNode } from "react";

/**
 * Auth facade for route components. Clerk hooks throw when rendered outside
 * a <ClerkProvider> (e.g. builds without VITE_CLERK_PUBLISHABLE_KEY), so
 * routes must never call them directly. AuthGate provides this context in
 * both modes — with real Clerk state when configured, inert defaults when
 * running offline.
 */
export type SafeUser = {
  fullName: string | null;
  email: string | null;
  initials: string;
  joinedAt: string | null;
};

export type SafeAuth = {
  mode: "clerk" | "offline";
  isLoaded: boolean;
  isSignedIn: boolean;
  user: SafeUser | null;
  signOut: () => void;
};

const noop = () => {};

export const offlineAuth: SafeAuth = {
  mode: "offline",
  isLoaded: true,
  isSignedIn: false,
  user: null,
  signOut: noop,
};

const SafeAuthContext = createContext<SafeAuth>(offlineAuth);

export function SafeAuthProvider({ value, children }: { value: SafeAuth; children: ReactNode }) {
  return <SafeAuthContext.Provider value={value}>{children}</SafeAuthContext.Provider>;
}

export function useSafeAuth(): SafeAuth {
  return useContext(SafeAuthContext);
}
