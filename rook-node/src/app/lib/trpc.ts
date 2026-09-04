import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
// NOTE: import `initTRPC` from the browser-safe core subpath. The package
// root (`@trpc/server`) throws at runtime in a browser bundle —
// "You're trying to use @trpc/server in a non-server environment" — which
// blanked every route of the desktop web app.
import { initTRPC } from "@trpc/server/unstable-core-do-not-import";

import { getApiBaseUrl } from "./api-base";

/**
 * Mirrors the Expo app's tRPC client shape. The web/desktop router types are
 * imported from the shared server definition. We declare a minimal stub
 * router here so the Vite app type-checks standalone; the actual routes run
 * against the live API (see `docs/rook-node.md`).
 */
// `allowOutsideOfServer` — the stub router is only used to derive the
// `AppRouter` type in this browser bundle; no procedures ever execute here.
const t = initTRPC.create({ transformer: superjson, allowOutsideOfServer: true });
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
