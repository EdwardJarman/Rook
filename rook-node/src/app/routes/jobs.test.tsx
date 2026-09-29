import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  data: undefined as any,
  error: false,
  loading: false,
  id: "",
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children }: any) => <a>{children}</a>,
  useSearchParams: () => [
    new URLSearchParams(state.id ? { id: state.id } : {}),
    vi.fn(),
  ],
}));
vi.mock("../lib/safe-auth", () => ({
  useSafeAuth: () => ({ isSignedIn: true }),
}));
vi.mock("../lib/background-jobs", () => ({
  useBackgroundJobs: () => ({
    data: state.data,
    isError: state.error,
    isLoading: state.loading,
    refetch: vi.fn(),
  }),
  backgroundApi: {},
  unwrap: (x: any) => x,
  JOB_POLL_MS: 3000,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: state.id ? state.data : undefined,
    isError: state.error,
    isLoading: state.loading,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../components/primitives", () => ({
  Card: ({ children }: any) => <article>{children}</article>,
  Pill: ({ label, tone }: any) => <span data-tone={tone}>{label}</span>,
  PanelHeader: ({ title }: any) => <h1>{title}</h1>,
}));
import { JobsPage } from "./jobs";
import { BackgroundStatusStrip } from "../components/background-status";
const job = {
  id: "job",
  bot: { name: "Scout" },
  state: "done",
  prompt: "Read 42",
  nextFireAt: 1,
  expiresAt: 1,
  result: { text: "Done" },
  attempt: { firing: 1, tools: [] },
  journal: [{ at: 1, kind: "grant", detail: "Consumed grant once" }],
};
beforeEach(() =>
  Object.assign(state, {
    data: undefined,
    error: false,
    loading: false,
    id: "",
  }),
);
it("renders loading, empty, failed refresh, and populated expired rows", () => {
  state.loading = true;
  expect(renderToStaticMarkup(<JobsPage />)).toContain("Loading jobs");
  state.loading = false;
  state.data = [];
  expect(renderToStaticMarkup(<JobsPage />)).toContain(
    "Schedule your first job",
  );
  state.error = true;
  expect(renderToStaticMarkup(<JobsPage />)).toContain(
    "Could not refresh jobs",
  );
  state.error = false;
  state.data = [{ ...job, state: "expired" }];
  const html = renderToStaticMarkup(<JobsPage />);
  expect(html).toContain("Scout");
  expect(html).toContain("Expired");
  expect(html).toContain('data-tone="coral"');
  expect(html).toContain("No next fire");
});
it("renders full detail with journal and result", () => {
  state.id = "job";
  state.data = job;
  const html = renderToStaticMarkup(<JobsPage />);
  expect(html).toContain("Consumed grant once");
  expect(html).toContain("Result");
  expect(html).not.toContain("Cancel job");
});
it("disables an expired exact-argument approval", () => {
  state.id = "job";
  state.data = {
    ...job,
    state: "awaiting_approval",
    attempt: {
      firing: 1,
      tools: [
        {
          fingerprint: "f",
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
  };
  const html = renderToStaticMarkup(<JobsPage />);
  expect(html).toContain("42");
  expect(html).toContain('disabled=""');
});
it("mirrors real status counts and refresh failure", () => {
  state.data = [
    { ...job, state: "running" },
    { ...job, state: "awaiting_approval" },
  ];
  expect(renderToStaticMarkup(<BackgroundStatusStrip />)).toContain(
    "1 running · 1 awaiting approval",
  );
  state.error = true;
  expect(renderToStaticMarkup(<BackgroundStatusStrip />)).toContain(
    "Jobs refresh failed",
  );
});
