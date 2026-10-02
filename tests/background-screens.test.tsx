import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../server/background/model";
const fixture = vi.hoisted(() => ({
  data: undefined as any,
  loading: false,
  error: false,
  bots: [] as any[],
  botId: "bot",
  signedIn: true,
  pending: false,
  userId: "first",
  hashes: [] as string[],
}));
vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isSignedIn: fixture.signedIn, userId: fixture.userId }),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => ({ id: "job", botId: fixture.botId }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  ScrollView: ({ children }: any) => <main>{children}</main>,
  Pressable: ({ children, accessibilityLabel }: any) => (
    <button aria-label={accessibilityLabel}>{children}</button>
  ),
}));
vi.mock("../components/screen-container", () => ({
  ScreenContainer: ({ children }: any) => <section>{children}</section>,
}));
vi.mock("../components/rook-primitives", () => ({
  useRookTheme: () => ({
    colors: {
      text: "black",
      line: "gray",
      surfaceAlt: "white",
      textSoft: "gray",
    },
  }),
  Card: ({ children }: any) => <article>{children}</article>,
  PrimaryButton: ({ label, disabled }: any) => (
    <button disabled={disabled}>{label}</button>
  ),
  SecondaryButton: ({ label }: any) => <button>{label}</button>,
  StatusPill: ({ label }: any) => <span>{label}</span>,
  Sheet: ({ visible, children }: any) =>
    visible ? <aside>{children}</aside> : null,
  ScreenHeader: ({ title, lead }: any) => (
    <header>
      {title} {lead}
    </header>
  ),
  Field: ({ label, value }: any) => (
    <label>
      {label}
      <input value={value} readOnly />
    </label>
  ),
  EmptyState: ({ title, detail, action }: any) => (
    <div>
      {title} {detail}
      {action}
    </div>
  ),
}));
vi.mock("../lib/workroom-store", () => ({
  useWorkroom: () => ({ bots: fixture.bots }),
}));
vi.mock("../lib/trpc", () => {
  const query = (
    _input: unknown,
    options?: { queryKeyHashFn?: () => string },
  ) => {
    if (options?.queryKeyHashFn) fixture.hashes.push(options.queryKeyHashFn());
    return {
      data: fixture.data,
      isLoading: fixture.loading,
      isError: fixture.error,
      refetch: vi.fn(),
    };
  };
  const mutation = () => ({ isPending: fixture.pending, mutateAsync: vi.fn() });
  return {
    trpc: {
      background: {
        list: { useQuery: query },
        inspect: { useQuery: query },
        schedule: { useMutation: mutation },
        approve: { useMutation: mutation },
        cancel: { useMutation: mutation },
      },
      useUtils: () => ({ background: { list: { invalidate: vi.fn() } } }),
    },
  };
});
import JobsScreen from "../app/jobs";
import DetailScreen from "../app/background-job";
import ScheduleScreen from "../app/schedule-job";
import UpdatesScreen from "../app/(tabs)/updates";
import { BackgroundStatusStrip } from "../components/background-jobs";
import { scheduleTiming } from "../lib/background-jobs";
const job: Job = {
  id: "job",
  owner: "owner",
  bot: { id: "bot", name: "Scout", role: "Analyst", purpose: "Work" },
  prompt: "Read a file",
  state: "queued",
  createdAt: 1,
  updatedAt: 2,
  nextFireAt: 3,
  expiresAt: Date.now() + 600000,
  fence: 0,
  attempt: { id: "job:1", firing: 1, startedAt: 1, spentMs: 0, tools: [] },
  journal: [{ at: 1, kind: "header", detail: "Scheduled detached job" }],
};
beforeEach(() => {
  Object.assign(fixture, {
    data: undefined,
    loading: false,
    error: false,
    bots: [],
    signedIn: true,
    pending: false,
  });
});
describe.each([
  ["jobs", JobsScreen],
  ["updates", UpdatesScreen],
] as const)("%s screen", (_, Screen) => {
  it("renders loading without fake jobs", () => {
    fixture.loading = true;
    const html = renderToStaticMarkup(<Screen />);
    expect(html).toMatch(/Loading/);
    expect(html).not.toContain("Scout");
  });
  it("gives an exact empty-state next action", () => {
    fixture.data = { ok: true, value: [] };
    expect(renderToStaticMarkup(<Screen />)).toContain(
      "Schedule your first job from a Bot",
    );
  });
  it("retains results with an honest refresh failure and recovers", () => {
    fixture.data = { ok: true, value: [job] };
    fixture.error = true;
    expect(renderToStaticMarkup(<Screen />)).toContain(
      "Could not refresh jobs",
    );
    fixture.error = false;
    const html = renderToStaticMarkup(<Screen />);
    expect(html).toContain("Scout");
    expect(html).not.toContain("Could not refresh jobs");
  });
  it("renders populated and expired states in words", () => {
    fixture.data = {
      ok: true,
      value: [{ ...job, state: "expired", expiresAt: 1 }],
    };
    const html = renderToStaticMarkup(<Screen />);
    expect(html).toContain("expired");
    expect(html).toContain("Expired");
  });
});
describe("job detail", () => {
  it("handles loading, missing and API error", () => {
    fixture.loading = true;
    expect(renderToStaticMarkup(<DetailScreen />)).toContain("Loading job");
    fixture.loading = false;
    fixture.data = { ok: false, error: { message: "Job not found" } };
    expect(renderToStaticMarkup(<DetailScreen />)).toContain("Job not found");
    fixture.data = undefined;
    fixture.error = true;
    expect(renderToStaticMarkup(<DetailScreen />)).toContain(
      "Could not refresh this job",
    );
  });
  it("renders result, journal timestamps, and consumed grant", () => {
    fixture.data = {
      ok: true,
      value: {
        ...job,
        state: "done",
        result: { text: "Done" },
        journal: [
          ...job.journal,
          { at: 2, kind: "grant", detail: "Consumed grant once" },
        ],
      },
    };
    const html = renderToStaticMarkup(<DetailScreen />);
    expect(html).toContain("Result");
    expect(html).toContain("Consumed grant once");
    expect(html).toContain("Scheduled detached job");
    expect(html).not.toContain("Cancel job");
  });
  it("shows exact arguments and disables expired approval", () => {
    fixture.data = {
      ok: true,
      value: {
        ...job,
        state: "awaiting_approval",
        attempt: {
          ...job.attempt,
          tools: [
            {
              fingerprint: "x",
              name: "write",
              phase: "approval",
              arguments: "{}",
              approval: { id: "a", expiresAt: 1 },
              output: {
                resultPayload: { background_action: { args: { value: 42 } } },
              },
            },
          ],
        },
      },
    };
    const html = renderToStaticMarkup(<DetailScreen />);
    expect(html).toContain("42");
    expect(html).toContain("Approval expired");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Cancel job");
  });
});
describe("schedule", () => {
  it("requires a Bot and describes standalone tasks", () => {
    expect(renderToStaticMarkup(<ScheduleScreen />)).toContain(
      "Choose a Bot first",
    );
    fixture.bots = [job.bot];
    const html = renderToStaticMarkup(<ScheduleScreen />);
    expect(html).toContain("Standalone task");
    expect(html).toContain("Repeat every minutes");
    expect(html).toContain('disabled=""');
  });
  it("shows pending scheduling", () => {
    fixture.bots = [job.bot];
    fixture.pending = true;
    expect(renderToStaticMarkup(<ScheduleScreen />)).toContain("Scheduling…");
  });
  it("validates timing before mutation", () => {
    expect(scheduleTiming("0", "1", 1000)).toEqual({ intervalMs: 60000 });
    expect(() => scheduleTiming("0", "0.5", 0)).toThrow();
    expect(() => scheduleTiming("NaN", "0", 0)).toThrow();
  });
});
it("strip uses truthful counts and error state", () => {
  fixture.data = {
    ok: true,
    value: [
      job,
      { ...job, state: "running" },
      { ...job, state: "awaiting_approval" },
    ],
  };
  expect(renderToStaticMarkup(<BackgroundStatusStrip />)).toContain(
    "1 running · 1 awaiting approval",
  );
  fixture.error = true;
  expect(renderToStaticMarkup(<BackgroundStatusStrip />)).toContain(
    "Jobs refresh failed",
  );
});
it("uses distinct job caches after switching accounts", () => {
  fixture.hashes = [];
  fixture.userId = "first";
  renderToStaticMarkup(<JobsScreen />);
  renderToStaticMarkup(<DetailScreen />);
  const first = [...fixture.hashes];
  fixture.hashes = [];
  fixture.userId = "second";
  renderToStaticMarkup(<JobsScreen />);
  renderToStaticMarkup(<DetailScreen />);
  expect(fixture.hashes).toHaveLength(2);
  expect(fixture.hashes[0]).not.toBe(first[0]);
  expect(fixture.hashes[1]).not.toBe(first[1]);
});
