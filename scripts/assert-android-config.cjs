const config = require(process.argv[2]);

const requiredPermissions = ["POST_NOTIFICATIONS", "RECORD_AUDIO"];
const permissions = config.android?.permissions ?? [];
const valid =
  config.scheme === "manusrook" &&
  config.android?.package === "com.app.rook" &&
  requiredPermissions.every((permission) => permissions.includes(permission));

if (!valid) {
  console.error("Android manifest or deep-link configuration is incomplete.");
  process.exit(1);
}

console.log("Android manifest and deep-link configuration verified.");
