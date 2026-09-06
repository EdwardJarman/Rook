import { Colors } from "@/lib/_core/theme";

// Clerk's web components render before React context is available, so this
// module reads the light palette directly rather than through useRookTheme.
// It matches the app's default (light) canvas; dark-mode Clerk theming is a
// later enhancement since Clerk doesn't support runtime appearance swaps
// without a re-render of the whole widget.
const INK = Colors.light.text;
const ACCENT = "#0E7C59";
const SURFACE = "#FFFFFF";
const SURFACE_ALT = "#F1F1EC";
const LINE = "#E9E8E2";
const MUTED = "#8A9099";

/**
 * Clerk styling for Rook's browser authentication views. The authentication
 * shell owns the product-level composition; Clerk owns only the secure
 * form. Kept rounded and calm to match the rest of the app instead of a
 * separate flat, square-cornered treatment.
 */
export const authWebAppearance = {
  variables: {
    colorPrimary: ACCENT,
    colorPrimaryForeground: "#FFFFFF",
    colorBackground: SURFACE,
    colorForeground: INK,
    colorDanger: "#C03B3B",
    colorSuccess: ACCENT,
    colorWarning: "#9A6700",
    colorMuted: SURFACE_ALT,
    colorMutedForeground: MUTED,
    colorInput: SURFACE_ALT,
    colorInputForeground: INK,
    colorNeutral: INK,
    colorTextOnPrimaryBackground: "#FFFFFF",
    colorTextSecondary: MUTED,
    borderRadius: "14px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Inter, ui-sans-serif, system-ui, Segoe UI, sans-serif",
  },
  elements: {
    backLink: { color: MUTED },
    headerBackLink: { color: MUTED },
    footerActionLink: { color: ACCENT, fontWeight: "700" },
    footerPagesLink: { color: MUTED },
    formFieldAction: { color: ACCENT },
    formResendCodeLink: { color: ACCENT },
    identityPreviewEditButton: { color: ACCENT },
    formButtonPrimary: {
      backgroundColor: INK,
      color: "#FFFFFF",
      border: "none",
      borderRadius: "14px",
      fontWeight: "700",
      minHeight: "3.1rem",
      boxShadow: "none",
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
      backgroundColor: "transparent",
      boxShadow: "none",
      border: "none",
      width: "100%",
    },
    rootBox: {
      width: "100%",
      maxWidth: "28rem",
    },
    header: {
      // The Rook shell renders the product heading, so Clerk's duplicate
      // header is hidden.
      display: "none" as const,
    },
    socialButtons: {
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: "0.6rem",
    },
    socialButtonsIconButton: {
      width: "100%",
      minHeight: "3.1rem",
      borderRadius: "14px",
      border: `1px solid ${LINE}`,
      backgroundColor: SURFACE_ALT,
      color: INK,
    },
    socialButtonsBlockButton: {
      width: "100%",
      minHeight: "3.1rem",
      justifyContent: "flex-start",
      paddingInline: "1rem",
      borderRadius: "14px",
      border: `1px solid ${LINE}`,
      backgroundColor: SURFACE_ALT,
      color: INK,
      fontSize: "0.94rem",
      fontWeight: "700",
    },
    dividerLine: { backgroundColor: LINE },
    dividerText: { color: MUTED },
    formFieldLabel: { color: INK, fontWeight: "700" },
    formFieldInput: {
      minHeight: "3.1rem",
      borderRadius: "14px",
      border: `1px solid ${LINE}`,
      backgroundColor: SURFACE_ALT,
      color: INK,
    },
    formFieldInputFocused: {
      border: `1px solid ${ACCENT}`,
      boxShadow: "0 0 0 3px rgba(14, 124, 89, 0.14)",
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
