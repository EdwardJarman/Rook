import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

import type { User } from "../../shared/database";
import { authenticateClerkRequest } from "../clerk-auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const user = await authenticateClerkRequest(opts.req);
  return { req: opts.req, res: opts.res, user };
}
