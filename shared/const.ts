export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG =
  "Session not accepted (10001). Sign in again — if you are signed in, the API cannot verify sessions (dev: check CLERK_SECRET_KEY in .env.local).";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
