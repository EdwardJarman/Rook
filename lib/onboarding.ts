import { botOrbIcon } from "./bot-orb-identity";

export const ONBOARDING_FOCUS_OPTIONS = [
  {
    id: "plan",
    label: "Plan my day",
    detail: "Priorities, follow-ups, and loose ends",
    icon: "today" as const,
  },
  {
    id: "research",
    label: "Research & writing",
    detail: "Find, compare, summarize, and draft",
    icon: "travel-explore" as const,
  },
  {
    id: "operations",
    label: "Projects & operations",
    detail: "Keep work moving across people and tools",
    icon: "account-tree" as const,
  },
  {
    id: "communication",
    label: "Inbox & communication",
    detail: "Triage, prepare replies, and follow through",
    icon: "alternate-email" as const,
  },
  {
    id: "product",
    label: "Product & engineering",
    detail: "Investigate, document, and ship carefully",
    icon: "code" as const,
  },
  {
    id: "general",
    label: "A bit of everything",
    detail: "Start broad, then specialize together",
    icon: "auto-awesome" as const,
  },
] as const;

export type OnboardingFocusId = (typeof ONBOARDING_FOCUS_OPTIONS)[number]["id"];

export type OnboardingBotTemplate = {
  id: "atlas" | "scout" | "steward" | "patch";
  name: string;
  role: string;
  purpose: string;
  detail: string;
  color: string;
  icon: string;
  approvalRule: string;
};

export const ONBOARDING_BOT_TEMPLATES: readonly OnboardingBotTemplate[] = [
  {
    id: "atlas",
    name: "Atlas",
    role: "Chief of staff",
    purpose:
      "Turns open loops into a clear plan, follows up on commitments, and coordinates specialist Bots when a task needs another lane.",
    detail:
      "A calm first teammate for priorities, follow-through, and delegation.",
    color: "#111318",
    icon: botOrbIcon("matte"),
    approvalRule:
      "Ask before contacting anyone, changing a live system, spending money, or making an irreversible decision.",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Research partner",
    purpose:
      "Finds credible sources, compares options, flags uncertainty, and returns concise briefs with evidence you can inspect.",
    detail:
      "Best for research, writing, decisions, and keeping claims grounded.",
    color: "#2AA9A1",
    icon: botOrbIcon("iridescent"),
    approvalRule:
      "Ask before publishing, contacting a source, downloading sensitive data, or acting on an uncertain claim.",
  },
  {
    id: "steward",
    name: "Steward",
    role: "Operations coordinator",
    purpose:
      "Tracks moving pieces, prepares updates, notices blockers, and keeps recurring work from quietly falling through the cracks.",
    detail:
      "Built for projects, inboxes, handoffs, and dependable operating rhythm.",
    color: "#23B26D",
    icon: botOrbIcon("matte"),
    approvalRule:
      "Ask before sending messages, changing dates or ownership, or updating an external system.",
  },
  {
    id: "patch",
    name: "Patch",
    role: "Product builder",
    purpose:
      "Investigates product questions, explains code and tradeoffs, prepares implementation plans, and validates work before it ships.",
    detail:
      "A focused partner for product thinking, engineering, and careful delivery.",
    color: "#7C5CFC",
    icon: botOrbIcon("iridescent"),
    approvalRule:
      "Ask before merging code, deploying, changing permissions, or modifying production data.",
  },
] as const;

export function recommendedOnboardingTemplate(
  focuses: readonly OnboardingFocusId[],
): OnboardingBotTemplate {
  if (focuses.includes("product")) return ONBOARDING_BOT_TEMPLATES[3];
  if (focuses.includes("research")) return ONBOARDING_BOT_TEMPLATES[1];
  if (focuses.includes("operations") || focuses.includes("communication"))
    return ONBOARDING_BOT_TEMPLATES[2];
  return ONBOARDING_BOT_TEMPLATES[0];
}
