// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "com.app.rook";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Keep the Android deep-link scheme stable. Hosted authentication, Microsoft
// OAuth, and notification taps must continue to return to the installed app
// across development, preview, and production builds.
const appScheme = "manusrook";

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "Rook",
  appSlug: "rook",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "",
  scheme: appScheme,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  owner: "rook-app",
  version: "0.1.5",
  runtimeVersion: { policy: "appVersion" },
  orientation: "portrait",
  icon: "./assets/images/rook-logo.png",
  scheme: env.scheme,
  userInterfaceStyle: "light",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    adaptiveIcon: {
      // Use the same current Rook mark as the in-app header rather than the
      // legacy generic Android asset family.
      backgroundColor: "#F5F6F3",
      foregroundImage: "./assets/images/rook-logo.png",
      monochromeImage: "./assets/images/rook-logo.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    // Firebase client config for push (local file, git-ignored; on EAS cloud
    // builds the GOOGLE_SERVICES_JSON file-type env var provides the path).
    // Absent = local-only builds; builds fail fast naming the missing file.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    versionCode: 6,
    permissions: ["POST_NOTIFICATIONS", "RECORD_AUDIO"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        // Expo Router callback URLs such as `manusrook:///sign-in` use an
        // empty host, so the scheme must accept both empty and named hosts.
        data: [
          {
            scheme: env.scheme,
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "@clerk/expo",
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/rook-logo.png",
        color: "#77F3C4",
        defaultChannel: "workroom-alerts",
        enableBackgroundRemoteNotifications: false,
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
          targetSdkVersion: 35,
          compileSdkVersion: 36,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // EAS project link (dynamic configs can't be auto-written by `eas init`):
    // eas-project.json (git-ignored) or EAS_PROJECT_ID env. Absent = local-only
    // builds; EAS cloud builds fail fast naming the missing link.
    eas: (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("node:fs");
        const raw = fs.readFileSync("./eas-project.json", "utf8") as string;
        const id = (JSON.parse(raw) as { projectId?: unknown }).projectId;
        if (typeof id === "string" && id.trim()) return { projectId: id.trim() };
      } catch {
        // No local link file; fall through to env.
      }
      const envId = process.env.EAS_PROJECT_ID?.trim();
      return envId ? { projectId: envId } : {};
    })(),
  },
};

export default config;
