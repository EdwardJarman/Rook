import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import { getApiBaseUrl } from "@/constants/oauth";
import type { AppRouter } from "@/server/routers";

export const trpc = createTRPCReact<AppRouter>();

export type ClerkTokenProvider = () => Promise<string | null>;

/** Creates a tRPC client that supplies the active Clerk session as a bearer token. */
export function createTRPCClient(getToken?: ClerkTokenProvider) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await getToken?.();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        async fetch(url, options) {
          const paths = String(url)
            .split("/api/trpc/")[1]
            ?.split("?")[0]
            .split(",");
          if (!paths?.every((path) => path.startsWith("background.")))
            return fetch(url, { ...options, credentials: "include" });
          const controller = new AbortController();
          const abort = () => controller.abort();
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted) controller.abort();
          const timer = setTimeout(abort, 15_000);
          try {
            return await fetch(url, {
              ...options,
              credentials: "include",
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
          }
        },
      }),
    ],
  });
}
