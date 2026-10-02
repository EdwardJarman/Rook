import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  useRookTheme,
} from "./rook-primitives";
import { trpc } from "../lib/trpc";
import {
  expiryLabel,
  JOB_POLL_MS,
  jobCounts,
  jobStateLabel,
  type JobSummary,
} from "../lib/background-jobs";
import type { Job } from "../server/background/model";

export function JobText({ children }: { children: ReactNode }) {
  const { colors } = useRookTheme();
  return (
    <Text
      selectable
      style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}
    >
      {children}
    </Text>
  );
}
export function useJobClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), JOB_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function useBackgroundJobs() {
  const { isSignedIn, userId } = useAuth();
  return trpc.background.list.useQuery(undefined, {
    queryKeyHashFn: () => JSON.stringify(["background.list", userId]),
    enabled: !!isSignedIn,
    refetchInterval: JOB_POLL_MS,
    retry: 1,
  });
}
export function JobRefreshError({
  message = "Could not refresh jobs. Showing the last available information.",
  retry,
}: {
  message?: string;
  retry: () => void;
}) {
  return (
    <Card>
      <View accessibilityLiveRegion="polite">
        <JobText>{message}</JobText>
      </View>
      <SecondaryButton label="Retry refresh" onPress={retry} />
    </Card>
  );
}
export function BackgroundStatusStrip() {
  const query = useBackgroundJobs();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const { colors } = useRookTheme();
  const data = query.data;
  const label = !isSignedIn
    ? "Sign in to view background jobs"
    : query.isError || (data && !data.ok)
      ? "Jobs refresh failed · open jobs to retry"
      : data?.ok
        ? jobCounts(data.value)
        : "Loading background jobs…";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open background jobs`}
      onPress={() => router.push("/jobs" as never)}
      style={{
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surfaceAlt,
      }}
    >
      <Text style={{ color: colors.textSoft }}>{label}</Text>
    </Pressable>
  );
}
export function JobRow({
  job,
  now,
  open,
}: {
  job: JobSummary;
  now: number;
  open: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${job.bot.name} job, ${jobStateLabel(job.state)}`}
      onPress={open}
      style={{ minHeight: 44 }}
    >
      <Card>
        <JobText>{job.bot.name}</JobText>
        <JobState job={job} />
        <JobText>{job.prompt}</JobText>
        <JobText>
          {["queued", "running", "awaiting_approval"].includes(job.state)
            ? `Next fire: ${new Date(job.nextFireAt).toLocaleString()}`
            : "No next fire"}
        </JobText>
        <JobText>{expiryLabel(job.expiresAt, now)}</JobText>
      </Card>
    </Pressable>
  );
}
export function JobState({ job }: { job: JobSummary }) {
  return (
    <StatusPill
      label={jobStateLabel(job.state)}
      tone={
        job.state === "awaiting_approval"
          ? "amber"
          : job.state === "failed" || job.state === "expired"
            ? "coral"
            : job.state === "done" || job.state === "running"
              ? "mint"
              : "muted"
      }
    />
  );
}
/** Shared approval surface for the existing alert destination and job detail. */
export function BackgroundApprovalCard({
  job,
  now,
  busy,
  decide,
}: {
  job: Job;
  now: number;
  busy: boolean;
  decide: (decision: "approve" | "deny") => void;
}) {
  const pending = job.attempt.tools.find((tool) => tool.phase === "approval");
  if (!pending?.approval || job.state !== "awaiting_approval") return null;
  const proposal = pending.output?.resultPayload as
    { summary?: string; background_action?: { args?: unknown } } | undefined;
  const expired = pending.approval.expiresAt <= now || job.expiresAt <= now;
  return (
    <Card>
      <JobText>
        This action needs your judgment because it can change connected data or
        run a command. Approval grants one use of the exact action below.
      </JobText>
      <JobText>{proposal?.summary ?? pending.name}</JobText>
      <JobText>
        {JSON.stringify(
          proposal?.background_action?.args ?? pending.arguments,
          null,
          2,
        )}
      </JobText>
      <JobText>
        {expired
          ? "Approval expired. Refresh to see the latest job state."
          : `Approval expires ${new Date(pending.approval.expiresAt).toLocaleString()}`}
      </JobText>
      <PrimaryButton
        label="Approve this action"
        disabled={busy || expired}
        onPress={() => decide("approve")}
      />
      <PrimaryButton
        label="Deny this action"
        destructive
        disabled={busy || expired}
        onPress={() => decide("deny")}
      />
    </Card>
  );
}
