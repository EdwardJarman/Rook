import { SignIn } from "@clerk/expo/web";

import { AuthWebShell } from "@/components/auth-web-shell";
import { authWebAppearance } from "@/constants/auth-web";

const PENDING_PAIRING_KEY = "rook-connect-pending";

/**
 * Clerk reads forceRedirectUrl during its initial render. Resolve the pending
 * pairing state synchronously so a user who signs in from Rook Node returns
 * to the loopback handoff instead of briefly being sent to the workroom.
 */
function initialRedirectUrl(): string {
  try {
    return window.localStorage.getItem(PENDING_PAIRING_KEY) ? "/connect-node" : "/";
  } catch {
    return "/";
  }
}

export default function WebSignInScreen() {
  const redirectUrl = initialRedirectUrl();

  return (
    <AuthWebShell
      eyebrow="WELCOME BACK"
      title="Your workroom is ready."
      detail="Sign in securely to return to your Bots, tasks, and private Rook workspace."
    >
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl={redirectUrl} appearance={authWebAppearance} />
    </AuthWebShell>
  );
}
