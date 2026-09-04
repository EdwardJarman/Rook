const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Let NativeWind use Metro's virtual-module integration. Forcing generated
  // CSS into react-native-css-interop's node_modules cache leaves Metro
  // unable to hash that file in clean CI/Vercel web-export environments.
});
