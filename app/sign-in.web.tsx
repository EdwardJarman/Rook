import { SignIn } from "@clerk/expo/web";
import { useEffect, useState } from "react";

import { AuthWebShell } from "@/components/auth-web-shell";
import { authWebAppearance } from "@/constants/auth-web";

export default function WebSignInScreen() {
  const [redirectUrl, setRedirectUrl] = useState("/");

  useEffect(() => {
    try {
      if (window.localStorage.getItem("rook-connect-pending")) {
        setRedirectUrl("/connect-node");
      }
    } catch {}
  }, []);

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
