import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "../../components/screen-container";
import { EmptyState, ScreenHeader } from "../../components/rook-primitives";
import {
  BackgroundStatusStrip,
  JobRow,
  JobText,
  JobRefreshError,
  useBackgroundJobs,
  useJobClock,
} from "../../components/background-jobs";
export default function UpdatesScreen() {
  const query = useBackgroundJobs(),
    now = useJobClock(),
    router = useRouter();
  const jobs = query.data?.ok
    ? [...query.data.value].sort((a, b) => b.updatedAt - a.updatedAt)
    : undefined;
  return (
    <ScreenContainer>
      <BackgroundStatusStrip />
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ScreenHeader
          title="Updates"
          lead="Background work and decisions, in one place."
        />
        {query.isLoading && <JobText>Loading updates…</JobText>}
        {(query.isError || (query.data && !query.data.ok)) && (
          <JobRefreshError retry={() => void query.refetch()} />
        )}
        {jobs?.length === 0 && (
          <EmptyState
            icon="notifications-none"
            title="No job updates yet"
            detail="Schedule your first job from a Bot — open Bots, choose a teammate, then tap Schedule a job."
          />
        )}
        {jobs?.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            now={now}
            open={() => router.push(`/background-job?id=${job.id}` as never)}
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}
