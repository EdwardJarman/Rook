import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { ScrollView } from "react-native";
import { ScreenContainer } from "../components/screen-container";
import {
  EmptyState,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
} from "../components/rook-primitives";
import {
  JobRefreshError,
  JobRow,
  JobText,
  useBackgroundJobs,
  useJobClock,
} from "../components/background-jobs";
export default function JobsScreen() {
  const query = useBackgroundJobs(),
    now = useJobClock(),
    router = useRouter();
  const { isSignedIn } = useAuth();
  const jobs = query.data?.ok ? query.data.value : undefined;
  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ScreenHeader
          title="Background jobs"
          lead="Work that continues after you leave."
        />
        <SecondaryButton
          label="Back to workroom"
          onPress={() => router.push("/(tabs)" as never)}
        />
        {!isSignedIn ? (
          <JobText>Sign in to view your jobs.</JobText>
        ) : (
          <>
            {(query.isError || (query.data && !query.data.ok)) && (
              <JobRefreshError
                message={
                  query.data && !query.data.ok
                    ? query.data.error.message
                    : undefined
                }
                retry={() => void query.refetch()}
              />
            )}
            {query.isLoading && <JobText>Loading jobs…</JobText>}
            {jobs?.length === 0 && (
              <EmptyState
                icon="schedule"
                title="No background jobs yet"
                detail="Schedule your first job from a Bot — open Bots, choose a teammate, then tap Schedule a job."
                action={
                  <PrimaryButton
                    label="Choose a Bot"
                    onPress={() => router.push("/(tabs)/bots" as never)}
                  />
                }
              />
            )}
            {jobs?.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                now={now}
                open={() =>
                  router.push(`/background-job?id=${job.id}` as never)
                }
              />
            ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
