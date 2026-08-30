import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { initTRPC } from "@trpc/server";

import { getApiBaseUrl } from "./api-base";

/**
 * Mirrors the Expo app's tRPC client shape. The web/desktop router types are
 * imported from the shared server definition. We declare a minimal stub
 * router here so the Vite app type-checks standalone; the actual routes run
 * against the live API (see `docs/rook-node.md`).
 */
const t = initTRPC.create({ transformer: superjson });
const stubRouter = t.router({
  workroom: t.router({
    reply: t.procedure.query(() => null),
  }),
  nodes: t.router({
    listLinkedFolders: t.procedure.query(() => [] as never),
    addLinkedFolder: t.procedure.mutation(() => null),
    removeLinkedFolder: t.procedure.mutation(() => null),
  }),
});

export type AppRouter = typeof stubRouter;
export const trpc = createTRPCReact<AppRouter>();

let _client: ReturnType<typeof trpc.createClient> | null = null;

export function getTrpcClient(getToken?: () => Promise<string | null>) {
  if (_client) return _client;
  _client = trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await getToken?.();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
  return _client;
}
