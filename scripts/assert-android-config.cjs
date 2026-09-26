const path = require("node:path");

const configPath = process.argv[2];
if (!configPath) {
  console.error("Pass the generated Expo configuration file path.");
  process.exit(1);
}

const config = require(path.resolve(process.cwd(), configPath));

const requiredPermissions = ["POST_NOTIFICATIONS", "RECORD_AUDIO"];
const permissions = config.android?.permissions ?? [];
const intentFilters = config.android?.intentFilters ?? [];
const supportsHostlessRookLinks = intentFilters.some((filter) =>
  filter.action === "VIEW" &&
  filter.category?.includes("BROWSABLE") &&
  filter.category?.includes("DEFAULT") &&
  filter.data?.some((entry) => entry.scheme === "manusrook" && !entry.host),
);

const valid =
  config.scheme === "manusrook" &&
  config.android?.package === "com.app.rook" &&
  requiredPermissions.every((permission) => permissions.includes(permission)) &&
  supportsHostlessRookLinks;

if (!valid) {
  console.error("Android manifest or hostless deep-link configuration is incomplete.");
  process.exit(1);
}

console.log("Android manifest and hostless deep-link configuration verified.");
