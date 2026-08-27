import { SignIn } from "@clerk/expo/web";

import { AuthWebShell } from "@/components/auth-web-shell";
import { authWebAppearance } from "@/constants/auth-web";

const PENDING_PAIRING_KEY = "rook-connect-pending";
const PAIRING_REQUEST_PATTERN = /^rkd-[a-f0-9]{48}$/i;

/**
 * Clerk reads forceRedirectUrl during its initial render. Resolve a pairing
 * request synchronously from the route first, then fall back to local storage.
 * Carrying the opaque request in the return path prevents an authenticated
 * browser from being sent to the generic workroom before code issuance.
 */
function initialRedirectUrl(): string {
  try {
    const requested = new URLSearchParams(window.location.search).get("request");
    const requestId = requested && PAIRING_REQUEST_PATTERN.test(requested)
      ? requested.toLowerCase()
      : window.localStorage.getItem(PENDING_PAIRING_KEY);

    if (requestId && PAIRING_REQUEST_PATTERN.test(requestId)) {
      window.localStorage.setItem(PENDING_PAIRING_KEY, requestId.toLowerCase());
      return `/connect-node?request=${encodeURIComponent(requestId.toLowerCase())}`;
    }
  } catch {
    // Use the ordinary workroom redirect when browser storage is unavailable.
  }
  return "/";
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
