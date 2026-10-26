import { useQuery } from "@tanstack/react-query";
import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import { currentToken } from "./send-bridge";
import { getApiBaseUrl } from "./api-base";
import { useSafeAuth } from "./safe-auth";
import type { Job } from "../../../../server/background/model";
export type { Job };
export type JobSummary = Omit<Job, "attempt" | "journal">;
export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };
export const JOB_POLL_MS = 3000;
const client = createTRPCUntypedClient({
  links: [
    httpLink({
      url: `${getApiBaseUrl()}/api/trpc`,
      transformer: superjson,
      async headers() {
        const token = await currentToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
      async fetch(url, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      },
    }),
  ],
});
export const backgroundApi = {
  list: () => client.query("background.list") as Promise<Outcome<JobSummary[]>>,
  inspect: (id: string) =>
    client.query("background.inspect", { id }) as Promise<Outcome<Job>>,
  cancel: (id: string) =>
    client.mutation("background.cancel", { id }) as Promise<Outcome<Job>>,
  approve: (id: string, approvalId: string, decision: "approve" | "deny") =>
    client.mutation("background.approve", {
      id,
      approvalId,
      decision,
    }) as Promise<Outcome<Job>>,
};
export function unwrap<T>(result: Outcome<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export function useBackgroundJobs() {
  const auth = useSafeAuth();
  return useQuery({
    queryKey: ["background", auth.userId, "list"],
    queryFn: async () => unwrap(await backgroundApi.list()),
    enabled: auth.isSignedIn,
    refetchInterval: JOB_POLL_MS,
    retry: 1,
  });
}
