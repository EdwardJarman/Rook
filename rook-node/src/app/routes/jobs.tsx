import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Card, Pill, PanelHeader } from "../components/primitives";
import {
  backgroundApi,
  unwrap,
  useBackgroundJobs,
  JOB_POLL_MS,
} from "../lib/background-jobs";
import { useSafeAuth } from "../lib/safe-auth";
function statusTone(state: string): "mint" | "amber" | "coral" | "muted" {
  if (state === "awaiting_approval") return "amber";
  if (state === "failed" || state === "expired") return "coral";
  return state === "running" || state === "done" ? "mint" : "muted";
}
const control = {
  minHeight: 44,
  padding: "10px 16px",
  borderRadius: 12,
  color: "var(--rook-text)",
  background: "var(--rook-surface-alt)",
  border: "1px solid var(--rook-line)",
  cursor: "pointer",
};
const json = (value: unknown) => (
  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
    {JSON.stringify(value, null, 2)}
  </pre>
);
export function JobsPage() {
  const [params, setParams] = useSearchParams(),
    id = params.get("id") ?? "";
  const auth = useSafeAuth(),
    list = useBackgroundJobs(),
    cache = useQueryClient();
  const detail = useQuery({
    queryKey: ["background", auth.userId, "inspect", id],
    queryFn: async () => unwrap(await backgroundApi.inspect(id)),
    enabled: auth.isSignedIn && !!id,
    refetchInterval: JOB_POLL_MS,
    retry: 1,
  });
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const job = detail.data,
    pending = job?.attempt.tools.find((t) => t.phase === "approval");
  async function decide(action: "approve" | "deny" | "cancel") {
    if (!job) return;
    setBusy(true);
    try {
      unwrap(
        action === "cancel"
          ? await backgroundApi.cancel(id)
          : await backgroundApi.approve(id, pending!.approval!.id, action),
      );
      setMessage(
        action === "cancel" ? "Cancellation saved." : "Decision saved.",
      );
      setConfirm(false);
      await cache.invalidateQueries({ queryKey: ["background"] });
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Could not save. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const query = id ? detail : list;
  const proposal = pending?.output?.resultPayload as
    { summary?: string; background_action?: { args?: unknown } } | undefined;
  return (
    <section
      style={{
        padding: 24,
        display: "grid",
        gap: 16,
        color: "var(--rook-text)",
      }}
    >
      <PanelHeader title={id ? "Background job" : "Background jobs"} />
      {!auth.isSignedIn && <p>Sign in to view your jobs.</p>}
      {query.isLoading && <p>Loading jobs…</p>}
      {query.isError && (
        <Card role="status">
          Could not refresh jobs. Showing the last available information.{" "}
          <button style={control} onClick={() => void query.refetch()}>
            Retry refresh
          </button>
        </Card>
      )}
      {!id && list.data?.length === 0 && (
        <Card>
          Schedule your first job from a Bot — open Bots in the web or phone
          app, choose a teammate, then tap Schedule a job.
        </Card>
      )}
      {!id &&
        list.data?.map((j) => (
          <button
            key={j.id}
            style={{ ...control, textAlign: "left" }}
            onClick={() => setParams({ id: j.id })}
          >
            <strong>{j.bot.name}</strong>
            <Pill
              label={j.state.replace(/_/g, " ")}
              tone={statusTone(j.state)}
            />
            <p>{j.prompt}</p>
            <p>
              {["queued", "running", "awaiting_approval"].includes(j.state)
                ? `Next fire: ${new Date(j.nextFireAt).toLocaleString()}`
                : "No next fire"}
            </p>
            <p>
              {j.expiresAt <= Date.now()
                ? "Expired"
                : `Expires in ${Math.ceil((j.expiresAt - Date.now()) / 60000)}m`}
            </p>
          </button>
        ))}
      {id && (
        <Link to="/jobs" style={control}>
          All background jobs
        </Link>
      )}
      {id && job && (
        <>
          <h2>{job.bot.name}</h2>
          <Pill
            label={job.state.replace(/_/g, " ")}
            tone={statusTone(job.state)}
          />
          <p>{job.prompt}</p>
          {job.state === "awaiting_approval" && pending?.approval && (
            <Card>
              <p>
                This action needs your judgment because it can change connected
                data or run a command. Approval grants one use of the exact
                action below.
              </p>
              <p>{proposal?.summary ?? pending.name}</p>
              {json(proposal?.background_action?.args ?? pending.arguments)}
              <p>
                Approval expires{" "}
                {new Date(pending.approval.expiresAt).toLocaleString()}
              </p>
              {(["approve", "deny"] as const).map((a) => (
                <button
                  key={a}
                  style={control}
                  disabled={
                    busy ||
                    Math.min(job.expiresAt, pending.approval!.expiresAt) <=
                      Date.now()
                  }
                  onClick={() => void decide(a)}
                >
                  {a === "approve" ? "Approve this action" : "Deny this action"}
                </button>
              ))}
            </Card>
          )}
          {job.result !== undefined && (
            <Card>
              <h3>Result</h3>
              {json(job.result)}
            </Card>
          )}
          {job.error && (
            <p>
              {job.error.code}: {job.error.message}
            </p>
          )}
          {["queued", "running", "awaiting_approval"].includes(job.state) && (
            <button style={control} onClick={() => setConfirm(true)}>
              Cancel job
            </button>
          )}
          {confirm && (
            <Card role="alert">
              <p>
                Cancel this job? No further steps will start. An action already
                dispatched may still finish.
              </p>
              <button
                style={control}
                disabled={busy}
                onClick={() => void decide("cancel")}
              >
                Confirm cancellation
              </button>
              <button style={control} onClick={() => setConfirm(false)}>
                Keep job
              </button>
            </Card>
          )}
          <h3>Attempt {job.attempt.firing}</h3>
          {job.attempt.tools.map((t) => (
            <Card key={t.fingerprint}>
              <p>
                {t.name} · {t.phase}
              </p>
              {json(t.output?.resultPayload ?? t.arguments)}
            </Card>
          ))}
          <h3>Journal</h3>
          {job.journal.map((e, i) => (
            <Card key={i}>
              <time>{new Date(e.at).toLocaleString()}</time>
              <p>
                {e.kind} · {e.detail}
              </p>
            </Card>
          ))}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
