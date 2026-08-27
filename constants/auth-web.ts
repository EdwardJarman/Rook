const INK = "#090909";
const PAPER = "#F1F0EB";
const MUTED = "#AAA8A1";
const LINE = "#3A3934";

/**
 * Clerk styling for Rook's browser authentication views. The authentication
 * shell owns the product-level editorial composition; Clerk owns only the
 * secure form. Keep the form calm, full-width, and legible on narrow screens.
 */
export const authWebAppearance = {
  variables: {
    colorPrimary: PAPER,
    colorPrimaryForeground: INK,
    colorBackground: "#111110",
    colorForeground: PAPER,
    colorDanger: "#EF8E8E",
    colorSuccess: PAPER,
    colorWarning: "#F1C46A",
    colorMuted: "#1A1A18",
    colorMutedForeground: MUTED,
    colorInput: "#171716",
    colorInputForeground: PAPER,
    colorNeutral: PAPER,
    colorTextOnPrimaryBackground: INK,
    colorTextSecondary: MUTED,
    borderRadius: "0px",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  elements: {
    backLink: { color: MUTED },
    headerBackLink: { color: MUTED },
    footerActionLink: { color: PAPER, fontWeight: "700" },
    footerPagesLink: { color: MUTED },
    formFieldAction: { color: PAPER },
    formResendCodeLink: { color: PAPER },
    identityPreviewEditButton: { color: PAPER },
    formButtonPrimary: {
      backgroundColor: PAPER,
      color: INK,
      borderRadius: "0px",
      fontWeight: "800",
      minHeight: "3.25rem",
    },
    footer: {
      backgroundColor: "transparent",
      borderTop: `1px solid ${LINE}`,
      marginTop: "1.25rem",
      paddingTop: "1.25rem",
    },
    branding: { display: "none" as const },
    clerkCopyrightBox: { display: "none" as const },
    badge: { display: "none" as const },
    poweredByClerk: { display: "none" as const },
    card: {
      backgroundColor: "#111110",
      boxShadow: "none",
      border: `1px solid ${LINE}`,
      borderRadius: "0px",
      width: "100%",
    },
    rootBox: {
      width: "100%",
      maxWidth: "28rem",
    },
    header: {
      // The Rook shell renders the product heading and uses the same editorial
      // type scale as the landing page, so Clerk's duplicate header is hidden.
      display: "none" as const,
    },
    socialButtons: {
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: "0.65rem",
    },
    socialButtonsIconButton: {
      width: "100%",
      minHeight: "3.25rem",
      borderRadius: "0px",
      border: `1px solid ${LINE}`,
      backgroundColor: "#171716",
      color: PAPER,
    },
    socialButtonsBlockButton: {
      width: "100%",
      minHeight: "3.25rem",
      justifyContent: "flex-start",
      paddingInline: "1rem",
      borderRadius: "0px",
      border: `1px solid ${LINE}`,
      backgroundColor: "#171716",
      color: PAPER,
      fontSize: "0.94rem",
      fontWeight: "700",
    },
    dividerLine: { backgroundColor: LINE },
    dividerText: { color: MUTED },
    formFieldLabel: { color: PAPER, fontWeight: "700" },
    formFieldInput: {
      minHeight: "3.25rem",
      borderRadius: "0px",
      border: `1px solid ${LINE}`,
      backgroundColor: "#171716",
      color: PAPER,
    },
    formFieldInputFocused: {
      border: `1px solid ${PAPER}`,
      boxShadow: "0 0 0 2px rgba(241, 240, 235, 0.12)",
    },
    formButtonReset: { color: MUTED },
  },
  // Current Clerk components read `layout`; current Core appearance docs use
  // `options`. Providing the same supported values in both keeps this Expo
  // integration stable as Clerk completes its Core 3 appearance migration.
  layout: {
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: false,
    termsPageUrl: undefined,
    privacyPageUrl: undefined,
    helpPageUrl: undefined,
    logoImageUrl: undefined,
    logoPlacement: "none" as const,
  },
  options: {
    elevation: "flush" as const,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: false,
    termsPageUrl: undefined,
    privacyPageUrl: undefined,
    helpPageUrl: undefined,
    logoImageUrl: undefined,
    logoPlacement: "outside" as const,
  },
};

/**
 * Localization overrides replace Clerk naming with Rook language and make the
 * full-width social controls read naturally.
 */
export const authWebLocalization = {
  locale: "en-US",
  socialButtonsBlockButton: "Continue with {{provider|titleize}}",
  socialButtonsBlockButtonManyInView: "Continue with {{provider|titleize}}",
  dividerText: "or continue with email",
  signIn: {
    start: {
      title: "Sign in to Rook",
      subtitle: "Return to your workroom.",
      actionText: "New to Rook?",
      actionLink: "Create an account",
    },
    password: {
      title: "Enter your password",
      subtitle: "to continue to Rook",
      formTitle: "Password",
      formSubtitle: "Enter the password associated with your account",
      forgotPassword: "Forgot password?",
      resetPassword: {
        title: "Reset your password",
        subtitle: "We'll send a code to your email",
        formTitle: "Email code",
        formSubtitle: "to verify your identity",
        resendButton: "Didn't receive a code? Resend",
        successMessage:
          "Check your email for a password reset link. You can close this tab once reset.",
      },
    },
    emailCode: {
      title: "Check your email",
      subtitle: "to continue to Rook",
      formTitle: "Verification code",
      formSubtitle: "Enter the verification code sent to your email",
      resendButton: "Didn't receive a code? Resend",
      successMessage: "You're signed in to Rook.",
    },
    emailLink: {
      title: "Check your email",
      subtitle: "to continue to Rook",
      formTitle: "Email link",
      formSubtitle: "Open the link sent to your email to sign in to Rook",
      resendButton: "Didn't receive a link? Resend",
      expired: {
        title: "This link expired",
        subtitle: "Return to Rook to request a new link.",
      },
      verified: {
        title: "You're signed in",
        subtitle: "Return to Rook to continue.",
      },
      failed: {
        title: "This link is invalid",
        subtitle: "Return to Rook and try again.",
      },
      loading: {
        title: "Signing in…",
        subtitle: "You'll be in your Rook workroom shortly.",
      },
      clientMismatch: {
        title: "Link opened on another device",
        subtitle: "Return to Rook on the original device to continue.",
      },
    },
    phoneCode: {
      title: "Check your phone",
      subtitle: "to continue to Rook",
      formTitle: "Verification code",
      formSubtitle: "Enter the verification code sent to your phone",
      resendButton: "Didn't receive a code? Resend",
      successMessage: "You're signed in to Rook.",
    },
    alternateMethods: {
      title: "Use another method",
      subtitle: "to sign in to Rook",
      actionText: "Sign in with another method",
      actionLink: "View all methods",
      getHelp: {
        title: "Need help signing in to Rook?",
        subtitle:
          "Reach out to Rook support if you're having trouble accessing your workroom.",
        blockButton__emailSupport: "Email Rook support",
        backLink: "Back to sign in",
      },
    },
    noAvailableMethods: {
      title: "Can't sign in",
      subtitle:
        "There are no available sign-in methods connected to your Rook account.",
      message: "Contact Rook support to regain access to your workroom.",
    },
  },
  signUp: {
    start: {
      title: "Create your Rook account",
      subtitle: "Begin with a clear workroom.",
      actionText: "Already have a Rook account?",
      actionLink: "Sign in",
    },
    emailCode: {
      title: "Verify your email",
      subtitle: "to create your Rook account",
      formTitle: "Verification code",
      formSubtitle: "Enter the code sent to your email",
      resendButton: "Didn't receive a code? Resend",
      successMessage: "Your Rook account is ready.",
    },
    emailLink: {
      title: "Verify your email",
      subtitle: "to create your Rook account",
      formTitle: "Email link",
      formSubtitle:
        "Open the link sent to your email to create your Rook account",
      resendButton: "Didn't receive a link? Resend",
      successMessage: "Your Rook account is ready.",
      loading: {
        title: "Creating your account…",
        subtitle: "You'll be in your Rook workroom shortly.",
      },
      verified: {
        title: "Email verified",
        subtitle: "Return to Rook to finish creating your account.",
      },
    },
    phoneCode: {
      title: "Verify your phone",
      subtitle: "to create your Rook account",
      formTitle: "Verification code",
      formSubtitle: "Enter the verification code sent to your phone",
      resendButton: "Didn't receive a code? Resend",
      successMessage: "Your Rook account is ready.",
    },
    continue: {
      title: "Fill in missing fields",
      subtitle: "to finish creating your account",
      actionText: "",
      actionLink: "",
    },
  },
  userButton: {
    action__signOut: "Sign out of Rook",
    action__manageAccount: "Manage Rook account",
  },
};
