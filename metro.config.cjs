const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Directories Metro must never watch nor resolve: the standalone CLI
// package (its node_modules once crashed the watcher on a junk `?` path),
// build outputs, and harness-local dirs. The Expo app never imports them;
// without this, unrelated file churn restarts bundles or kills the server.
const NEVER_WATCH = ["cli/node_modules", "cli/dist", "dist-server", ".opencode"];
const toDirPattern = (dir) =>
  new RegExp(
    dir
      .split("/")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[/\\\\]") + "([/\\\\]|$)",
  );
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  ...NEVER_WATCH.map(toDirPattern),
];

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Let NativeWind use Metro's virtual-module integration. Forcing generated
  // CSS into react-native-css-interop's node_modules cache leaves Metro
  // unable to hash that file in clean CI/Vercel web-export environments.
});
