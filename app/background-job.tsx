import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useState } from "react";
import { ScrollView } from "react-native";
import { ScreenContainer } from "../components/screen-container";
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  ScreenHeader,
  Sheet,
} from "../components/rook-primitives";
import {
  BackgroundApprovalCard,
  JobRefreshError,
  JobState,
  JobText,
  useJobClock,
} from "../components/background-jobs";
import { expiryLabel, isActiveJob, JOB_POLL_MS } from "../lib/background-jobs";
import { trpc } from "../lib/trpc";

export default function BackgroundJobScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { isSignedIn, userId } = useAuth();
  const router = useRouter(),
    now = useJobClock();
  const [message, setMessage] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const query = trpc.background.inspect.useQuery(
    { id },
    {
      enabled: !!isSignedIn && !!id,
      refetchInterval: JOB_POLL_MS,
      retry: 1,
      queryKeyHashFn: () => JSON.stringify(["background.inspect", userId, id]),
    },
  );
  const approve = trpc.background.approve.useMutation(),
    cancel = trpc.background.cancel.useMutation();
  const utils = trpc.useUtils();
  const job = query.data?.ok ? query.data.value : undefined;
  const busy = approve.isPending || cancel.isPending;
  async function act(decision: "approve" | "deny" | "cancel") {
    if (!job) return;
    try {
      const pending = job.attempt.tools.find(
        (tool) => tool.phase === "approval",
      );
      if (decision !== "cancel" && !pending?.approval) return;
      const result =
        decision === "cancel"
          ? await cancel.mutateAsync({ id })
          : await approve.mutateAsync({
              id,
              approvalId: pending!.approval!.id,
              decision,
            });
      setMessage(
        result.ok
          ? decision === "cancel"
            ? "Cancellation saved."
            : "Decision saved."
          : result.error.message,
      );
      setConfirmCancel(false);
      await Promise.all([query.refetch(), utils.background.list.invalidate()]);
    } catch {
      setMessage("The action could not be saved. Refresh and try again.");
    }
  }
  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ScreenHeader title="Background job" />
        <SecondaryButton
          label="All background jobs"
          onPress={() => router.push("/jobs" as never)}
        />
        {!isSignedIn && <JobText>Sign in to review this job.</JobText>}
        {query.isLoading && isSignedIn && <JobText>Loading job…</JobText>}
        {(query.isError || (query.data && !query.data.ok)) && (
          <JobRefreshError
            message={
              query.data && !query.data.ok
                ? query.data.error.message
                : "Could not refresh this job. Showing the last available information."
            }
            retry={() => void query.refetch()}
          />
        )}
        {job && (
          <>
            <JobText>{job.bot.name}</JobText>
            <JobState job={job} />
            <JobText>{job.prompt}</JobText>
            <JobText>{expiryLabel(job.expiresAt, now)}</JobText>
            {isActiveJob(job.state) && (
              <JobText>
                Next fire: {new Date(job.nextFireAt).toLocaleString()}
              </JobText>
            )}
            <BackgroundApprovalCard
              job={job}
              now={now}
              busy={busy}
              decide={(decision) => void act(decision)}
            />
            {job.result !== undefined && (
              <Card>
                <JobText>Result</JobText>
                <JobText>{JSON.stringify(job.result, null, 2)}</JobText>
              </Card>
            )}
            {job.error && (
              <Card>
                <JobText>
                  {job.error.code}: {job.error.message}
                </JobText>
              </Card>
            )}
            {isActiveJob(job.state) && (
              <SecondaryButton
                label="Cancel job"
                destructive
                onPress={() => setConfirmCancel(true)}
              />
            )}
            <JobText>
              Attempt {job.attempt.firing} · {job.attempt.id}
            </JobText>
            {job.attempt.tools.map((tool) => (
              <Card key={tool.fingerprint}>
                <JobText>
                  {tool.name} · {tool.phase}
                </JobText>
                <JobText>
                  {JSON.stringify(
                    tool.output?.resultPayload ?? tool.arguments,
                    null,
                    2,
                  )}
                </JobText>
              </Card>
            ))}
            <JobText>Journal</JobText>
            {job.journal.map((event, index) => (
              <Card key={`${event.at}:${index}`}>
                <JobText>
                  {new Date(event.at).toLocaleString()} · {event.kind}
                </JobText>
                <JobText>{event.detail}</JobText>
              </Card>
            ))}
          </>
        )}
        {!!message && <JobText>{message}</JobText>}
      </ScrollView>
      <Sheet visible={confirmCancel} onClose={() => setConfirmCancel(false)}>
        <JobText>
          Cancel this job? No further steps will start. An action already
          dispatched may still finish.
        </JobText>
        <PrimaryButton
          label="Confirm cancellation"
          destructive
          disabled={busy}
          onPress={() => void act("cancel")}
        />
        <SecondaryButton
          label="Keep job"
          onPress={() => setConfirmCancel(false)}
        />
      </Sheet>
    </ScreenContainer>
  );
}
