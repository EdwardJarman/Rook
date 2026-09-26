import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useState } from "react";
import {
  Button,
  ScrollView,
  Text as NativeText,
  View,
  type TextProps,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useRookTheme } from "@/lib/ui";

function Text(props: TextProps) {
  const { colors } = useRookTheme();
  return (
    <NativeText {...props} style={[{ color: colors.text }, props.style]} />
  );
}

/** Minimal alert destination. Full scheduling/status screens are a later task. */
export default function BackgroundJobScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { isSignedIn } = useAuth();
  const [message, setMessage] = useState("");
  const jobQuery = trpc.background.inspect.useQuery(
    { id },
    { enabled: !!isSignedIn && !!id, refetchInterval: 5000 },
  );
  const approve = trpc.background.approve.useMutation();
  const job = jobQuery.data?.ok ? jobQuery.data.value : undefined;
  const pending = job?.attempt.tools.find((tool) => tool.phase === "approval");
  const proposal = pending?.output?.resultPayload as
    | {
        summary?: string;
        background_action?: { args?: Record<string, unknown> };
      }
    | undefined;
  const decide = async (decision: "approve" | "deny") => {
    if (!pending?.approval) return;
    try {
      const response = await approve.mutateAsync({
        id,
        approvalId: pending.approval.id,
        decision,
      });
      setMessage(response.ok ? "Decision saved." : response.error.message);
      await jobQuery.refetch();
    } catch {
      setMessage("The decision could not be saved. Please retry.");
    }
  };
  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 24 }}>Background job</Text>
        {!isSignedIn ? <Text>Sign in to review this job.</Text> : null}
        {jobQuery.isError ? (
          <Text>Could not load this job. Please retry.</Text>
        ) : null}
        {jobQuery.data && !jobQuery.data.ok ? (
          <Text>{jobQuery.data.error.message}</Text>
        ) : null}
        {job ? (
          <>
            <Text>
              {job.bot.name} · {job.state.replace(/_/g, " ")}
            </Text>
            <Text selectable>{job.prompt}</Text>
            {pending?.approval && job.state === "awaiting_approval" ? (
              <View style={{ gap: 12 }}>
                <Text>
                  This action needs your judgment because it can change
                  connected data or run a command. Approval grants one use of
                  the exact action below.
                </Text>
                <Text>{proposal?.summary ?? "Review this action"}</Text>
                <Text selectable>
                  {JSON.stringify(
                    proposal?.background_action?.args ?? {},
                    null,
                    2,
                  )}
                </Text>
                <Text>
                  Expires{" "}
                  {new Date(pending.approval.expiresAt).toLocaleString()}
                </Text>
                <Button
                  title="Approve this action"
                  disabled={approve.isPending}
                  onPress={() => void decide("approve")}
                />
                <Button
                  title="Decline"
                  disabled={approve.isPending}
                  onPress={() => void decide("deny")}
                />
              </View>
            ) : null}
            {job.result ? (
              <Text selectable>{JSON.stringify(job.result, null, 2)}</Text>
            ) : null}
            {job.error ? <Text>{job.error.message}</Text> : null}
          </>
        ) : null}
        {message ? <Text>{message}</Text> : null}
      </ScrollView>
    </ScreenContainer>
  );
}
