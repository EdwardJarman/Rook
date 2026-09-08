import { createClerkClient } from "@clerk/backend";
import { describe, expect, it } from "vitest";

describe("Clerk server credentials", () => {
  // Production credentials live in Vercel env vars; without them (local/CI)
  // there is nothing to verify, so skip rather than fail.
  it.skipIf(!process.env.CLERK_SECRET_KEY)(
    "authenticates a lightweight request to the linked Clerk instance",
    async () => {
      const secretKey = process.env.CLERK_SECRET_KEY;

      expect(secretKey).toBeTruthy();

      const client = createClerkClient({ secretKey });
      const instance = await client.instance.get();

      expect(instance.id).toBeTruthy();
    },
  );
});
