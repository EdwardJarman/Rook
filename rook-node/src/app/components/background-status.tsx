import { Link } from "react-router-dom";
import { useBackgroundJobs } from "../lib/background-jobs";
import { useSafeAuth } from "../lib/safe-auth";
export function BackgroundStatusStrip() {
  const query = useBackgroundJobs(),
    auth = useSafeAuth();
  const label = !auth.isSignedIn
    ? "Sign in to view background jobs"
    : query.isError
      ? "Jobs refresh failed · open jobs to retry"
      : query.data
        ? `${query.data.filter((j) => j.state === "running").length} running · ${query.data.filter((j) => j.state === "awaiting_approval").length} awaiting approval`
        : "Loading background jobs…";
  return (
    <Link
      to="/jobs"
      aria-label={`${label}. Open background jobs`}
      style={{
        display: "block",
        minHeight: 44,
        padding: "12px 18px",
        boxSizing: "border-box",
        background: "var(--rook-surface-alt)",
        color: "var(--rook-text-soft)",
        borderBottom: "1px solid var(--rook-line)",
      }}
    >
      {label}
    </Link>
  );
}
