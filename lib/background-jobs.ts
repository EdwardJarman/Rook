import type { Job, JobState } from "../server/background/model";
export const JOB_POLL_MS = 3_000; // Existing node uplink cadence.
export type JobSummary = Omit<Job, "attempt" | "journal">;
export const isActiveJob = (state: JobState) =>
  ["queued", "running", "awaiting_approval"].includes(state);
export const jobStateLabel = (state: JobState) => state.replace(/_/g, " ");
export function jobCounts(jobs: JobSummary[]) {
  return `${jobs.filter((j) => j.state === "running").length} running · ${jobs.filter((j) => j.state === "awaiting_approval").length} awaiting approval`;
}
export function expiryLabel(at: number, now: number) {
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 0) return "Expired";
  if (minutes < 60) return `Expires in ${minutes}m`;
  if (minutes < 1440)
    return `Expires in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Expires in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}
export function scheduleTiming(delay: string, repeat: string, now: number) {
  const d = Number(delay),
    r = Number(repeat);
  if (
    !delay.trim() ||
    !repeat.trim() ||
    !Number.isFinite(d) ||
    !Number.isFinite(r) ||
    d < 0 ||
    r < 0 ||
    (r > 0 && r < 1)
  )
    throw new Error(
      "Use a non-negative delay and a repeat of zero (once) or at least one minute.",
    );
  return {
    ...(d ? { at: Math.round(now + d * 60_000) } : {}),
    ...(r ? { intervalMs: Math.round(r * 60_000) } : {}),
  };
}
