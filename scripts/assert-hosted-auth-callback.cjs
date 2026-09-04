const fs = require("node:fs");
const path = require("node:path");

const signInPath = path.resolve(__dirname, "../app/sign-in.tsx");
const source = fs.readFileSync(signInPath, "utf8");

const requiredPatterns = [
  /Linking\.createURL\("\/sign-in"\)/,
  /redirectUrl/,
  /authSessionOptions:\s*\{\s*showInRecents:\s*false\s*\}/,
];

if (!requiredPatterns.every((pattern) => pattern.test(source))) {
  console.error("Native hosted sign-in is missing the explicit Expo Router callback path.");
  process.exit(1);
}

console.log("Native hosted sign-in callback path verified.");
