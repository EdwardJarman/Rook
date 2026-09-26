export type WorkroomCloudSnapshot = {
  selectedBotId: string;
  onboardingComplete: boolean;
  aiProvider: "openrouter" | "chatgpt" | "orcarouter" | "tokenrouter";
  bots: unknown[];
  messages: unknown[];
  tasks: unknown[];
  skills: unknown[];
  routines: unknown[];
  approvals: unknown[];
  files: unknown[];
  notifications: unknown[];
  activity: unknown[];
};

export const emptyWorkroomSnapshot = (): WorkroomCloudSnapshot => ({ selectedBotId: "", onboardingComplete: false, aiProvider: "openrouter", bots: [], messages: [], tasks: [], skills: [], routines: [], approvals: [], files: [], notifications: [], activity: [] });

export const normalizeWorkroomSnapshot = (value: unknown): WorkroomCloudSnapshot => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const array = (key: keyof Omit<WorkroomCloudSnapshot, "selectedBotId" | "onboardingComplete" | "aiProvider">) => Array.isArray(source[key]) ? source[key] : [];
  const bots = array("bots");
  const preferred = typeof source.selectedBotId === "string" ? source.selectedBotId : "";
  const hasPreferred = bots.some((bot) => Boolean(bot) && typeof bot === "object" && (bot as { id?: unknown }).id === preferred);
  const firstId = bots[0] && typeof bots[0] === "object" ? (bots[0] as { id?: unknown }).id : "";
  const aiProvider = source.aiProvider === "chatgpt" || source.aiProvider === "orcarouter" || source.aiProvider === "tokenrouter"
    ? source.aiProvider
    : "openrouter";
  return { selectedBotId: hasPreferred ? preferred : typeof firstId === "string" ? firstId : "", onboardingComplete: Boolean(source.onboardingComplete), aiProvider, bots, messages: array("messages"), tasks: array("tasks"), skills: array("skills"), routines: array("routines"), approvals: array("approvals"), files: array("files"), notifications: array("notifications"), activity: array("activity") };
};
