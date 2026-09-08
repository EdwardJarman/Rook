import { SignUp } from "@clerk/expo/web";

import { AuthWebShell } from "@/components/auth-web-shell";
import { authWebAppearance } from "@/constants/auth-web";

export default function WebSignUpScreen() {
  return (
    <AuthWebShell
      eyebrow="MAKE A ROOK ACCOUNT"
      title="Begin with a clear workroom."
      detail="Create your account, then make your first Bot from your own words."
    >
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/"
        oauthFlow="redirect"
        appearance={authWebAppearance}
      />
    </AuthWebShell>
  );
}
