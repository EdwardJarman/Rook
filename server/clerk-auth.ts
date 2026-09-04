import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Request } from "express";

import type { User } from "../shared/database";
import * as db from "./db";

export function extractClerkBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export function clerkOpenId(clerkUserId: string): string {
  return `clerk:${clerkUserId}`;
}

export function transientClerkUser(input: {
  clerkUserId: string;
  name: string | null;
  email: string | null;
}): User {
  const now = new Date();
  return {
    id: `transient:${clerkOpenId(input.clerkUserId)}`,
    openId: clerkOpenId(input.clerkUserId),
    name: input.name,
    email: input.email,
    loginMethod: "clerk",
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

export async function authenticateClerkRequest(request: Request): Promise<User | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const token = extractClerkBearerToken(request.header("authorization"));
  if (!secretKey || !token) {
    console.warn("[Clerk auth] Request rejected", {
      hasSecretKey: Boolean(secretKey),
      hasBearerToken: Boolean(token),
    });
    return null;
  }

  try {
    const claims = await verifyToken(token, { secretKey });
    if (!claims.sub) return null;

    const client = createClerkClient({ secretKey });
    const clerkUser = await client.users.getUser(claims.sub);
    const email = clerkUser.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? null;
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
    const openId = clerkOpenId(claims.sub);
    const transientUser = transientClerkUser({ clerkUserId: claims.sub, name, email });

    await db.upsertUser({
      openId,
      name,
      email,
      loginMethod: "clerk",
      lastSignedIn: new Date(),
    });

    const storedUser = await db.getUserByOpenId(openId);
    if (storedUser) return storedUser;

    console.warn("[Clerk auth] Database unavailable; using transient authenticated user");
    return transientUser;
  } catch (error) {
    console.warn("[Clerk auth] Token verification failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
