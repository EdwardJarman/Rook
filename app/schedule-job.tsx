import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { ScreenContainer } from "../components/screen-container";
import {
  Field,
  PrimaryButton,
  SecondaryButton,
  ScreenHeader,
} from "../components/rook-primitives";
import { JobText } from "../components/background-jobs";
import { useWorkroom } from "../lib/workroom-store";
import { scheduleTiming } from "../lib/background-jobs";
import { trpc } from "../lib/trpc";
export default function ScheduleJobScreen() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const { bots } = useWorkroom();
  const bot = bots.find((b) => b.id === botId),
    router = useRouter();
  const [prompt, setPrompt] = useState(""),
    [delay, setDelay] = useState("0"),
    [repeat, setRepeat] = useState("0"),
    [error, setError] = useState("");
  const schedule = trpc.background.schedule.useMutation(),
    utils = trpc.useUtils();
  async function submit() {
    if (!bot) return;
    try {
      const timing = scheduleTiming(delay, repeat, Date.now());
      const result = await schedule.mutateAsync({
        bot: {
          id: bot.id,
          name: bot.name,
          role: bot.role,
          purpose: bot.purpose,
          model: bot.model,
        },
        prompt: prompt.trim(),
        ...timing,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      void utils.background.list.invalidate();
      router.replace(`/background-job?id=${result.value.id}` as never);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not schedule. Please retry.",
      );
    }
  }
  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ScreenHeader
          title="Schedule a job"
          lead={bot ? `For ${bot.name}` : "Choose a Bot first."}
        />
        <SecondaryButton
          label="Back to Bots"
          onPress={() => router.push("/(tabs)/bots" as never)}
        />
        {bot && (
          <>
            <JobText>
              Describe a complete task. Background jobs cannot see this
              conversation. Jobs expire after seven days; actions that need
              judgment wait for approval.
            </JobText>
            <Field
              label="Standalone task"
              accessibilityLabel="Standalone task"
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={4000}
            />
            <Field
              label="Start in minutes (0 = now)"
              accessibilityLabel="Start in minutes"
              value={delay}
              onChangeText={setDelay}
              keyboardType="decimal-pad"
            />
            <Field
              label="Repeat every minutes (0 = once)"
              accessibilityLabel="Repeat every minutes"
              value={repeat}
              onChangeText={setRepeat}
              keyboardType="decimal-pad"
            />
            <PrimaryButton
              label={schedule.isPending ? "Scheduling…" : "Schedule job"}
              disabled={schedule.isPending || !prompt.trim()}
              onPress={() => void submit()}
            />
          </>
        )}
        {!!error && <JobText>{error}</JobText>}
      </ScrollView>
    </ScreenContainer>
  );
}
