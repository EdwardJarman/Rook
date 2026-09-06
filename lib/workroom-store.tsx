import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/hooks/use-auth";
import type { AiProvider } from "@/lib/ai-provider";
import type { AgentTraceStep } from "@/shared/agent-trace";
import { trpc } from "@/lib/trpc";
import {
  emptyWorkroomSnapshot,
  normalizeWorkroomSnapshot,
  type WorkroomCloudSnapshot,
} from "@/shared/workroom-snapshot";

export type TaskStatus =
  | "Draft"
  | "Queued"
  | "Planning"
  | "Working"
  | "Waiting for input"
  | "Approval required"
  | "Blocked"
  | "Paused"
  | "Retrying"
  | "Completed"
  | "Partially completed"
  | "Failed"
  | "Cancelled";
export type Bot = {
  id: string;
  name: string;
  role: string;
  purpose: string;
  avatar: string;
  color: string;
  icon: string;
  status: "Ready" | "Working" | "Paused";
  memory: string;
  approvalRule: string;
  model: string;
  lastActive: string;
};
export type WorkMessage = {
  id: string;
  botId: string;
  author: "user" | "bot" | "system";
  body: string;
  createdAt: string;
  conversationId?: string;
  kind?: "message" | "activity" | "result" | "approval" | "handoff";
  taskId?: string;
  attachmentName?: string;
  trace?: AgentTraceStep[];
};
export type WorkTask = {
  id: string;
  botId: string;
  title: string;
  status: TaskStatus;
  summary: string;
  startedAt: string;
  nextAction: string;
  risk: "Low" | "Medium" | "High";
  steps: { id: string; label: string; state: "done" | "active" | "pending" }[];
  /** Group workroom: every owner this task has had, oldest first. */
  handoffHistory?: { botId: string; at: string }[];
};
export type Skill = {
  id: string;
  name: string;
  owner: string;
  status: "Enabled" | "Draft" | "Testing" | "Paused";
  description: string;
  version: string;
  approvals: string;
};
export type Routine = {
  id: string;
  name: string;
  owner: string;
  cadence: string;
  nextRun: string;
  state: "Active" | "Paused";
  summary: string;
};
export type Approval = {
  id: string;
  title: string;
  detail: string;
  botId: string;
  risk: "Medium" | "High";
  state: "Pending" | "Approved" | "Declined";
  createdAt: string;
  externalActionId?: string;
  taskId?: string;
};
export type WorkFile = {
  id: string;
  name: string;
  size: string;
  scope: "Bot-private" | "Selected-Bot shared" | "Account-wide shared";
  owner: string;
  updatedAt: string;
};
export type WorkNotification = {
  id: string;
  title: string;
  detail: string;
  tone: "mint" | "amber" | "coral";
  read: boolean;
  createdAt: string;
};
export type Activity = {
  id: string;
  title: string;
  detail: string;
  tone: "mint" | "amber" | "coral" | "muted";
  createdAt: string;
};
type BotInput = Pick<Bot, "name" | "role" | "purpose"> & {
  approvalRule?: string;
  color?: string;
  icon?: string;
  memory?: string;
  model?: string;
};
type SyncStatus =
  | "Connecting"
  | "Synced"
  | "Saving"
  | "Offline changes kept locally"
  | "Local only";
type WorkroomContextValue = {
  ready: boolean;
  onboardingComplete: boolean;
  selectedBotId: string;
  aiProvider: AiProvider;
  bots: Bot[];
  messages: WorkMessage[];
  tasks: WorkTask[];
  skills: Skill[];
  routines: Routine[];
  approvals: Approval[];
  files: WorkFile[];
  notifications: WorkNotification[];
  activity: Activity[];
  syncStatus: SyncStatus;
  selectBot: (id: string) => void;
  setAiProvider: (provider: AiProvider) => void;
  createBot: (values: BotInput) => Bot;
  updateBotStatus: (id: string, status: Bot["status"]) => void;
  updateBotModel: (id: string, model: string) => void;
  addMessage: (message: Omit<WorkMessage, "id" | "createdAt">) => void;
  addTask: (task: Omit<WorkTask, "id" | "startedAt">) => WorkTask;
  updateTaskStatus: (
    id: string,
    status: TaskStatus,
    nextAction?: string,
  ) => void;
  /** Group workroom: reassign an in-progress task to a different Bot in the room. */
  handOffTask: (taskId: string, toBotId: string, note?: string) => void;
  addSkill: (skill: Omit<Skill, "id">) => void;
  addApproval: (approval: Omit<Approval, "id" | "createdAt" | "state">) => void;
  addRoutine: (routine: Omit<Routine, "id">) => void;
  toggleRoutine: (id: string) => void;
  resolveApproval: (id: string, state: "Approved" | "Declined") => void;
  addFile: (file: Omit<WorkFile, "id" | "updatedAt">) => void;
  markNotificationsRead: () => void;
  addActivity: (entry: Omit<Activity, "id" | "createdAt">) => void;
  completeOnboarding: () => void;
  clearWorkroom: () => void;
};

const STORAGE_KEY_PREFIX = "rook-local-fallback-v1";
const BOT_COLORS = [
  "#0E7C59",
  "#2563EB",
  "#7563F5",
  "#DF8D19",
  "#D95D78",
  "#5B7086",
];
const DEFAULT_BOT_ICON = "bot-orb:matte";
const WorkroomContext = createContext<WorkroomContextValue | undefined>(
  undefined,
);
const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const timeNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function WorkroomProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [ready, setReady] = useState(false);
  const [localLoaded, setLocalLoaded] = useState(false);
  const cloudHydrated = useRef(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("openrouter");
  const [bots, setBots] = useState<Bot[]>([]);
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [files, setFiles] = useState<WorkFile[]>([]);
  const [notifications, setNotifications] = useState<WorkNotification[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const localStorageKey = useMemo(
    () => `${STORAGE_KEY_PREFIX}-${user?.id ?? "signed-out"}`,
    [user?.id],
  );
  const cloudQuery = trpc.cloud.load.useQuery(
    user?.id ? { accountScope: user.id } : undefined,
    {
      enabled: isAuthenticated && Boolean(user?.id),
      retry: 2,
      refetchOnWindowFocus: true,
    },
  );
  const saveCloud = trpc.cloud.save.useMutation();
  const saveCloudRef = useRef(saveCloud.mutateAsync);
  saveCloudRef.current = saveCloud.mutateAsync;

  const applySnapshot = useCallback((value: unknown) => {
    const snapshot = normalizeWorkroomSnapshot(value);
    setSelectedBotId(snapshot.selectedBotId);
    setOnboardingComplete(snapshot.onboardingComplete);
    setAiProvider(snapshot.aiProvider);
    setBots(snapshot.bots as Bot[]);
    setMessages(snapshot.messages as WorkMessage[]);
    setTasks(snapshot.tasks as WorkTask[]);
    setSkills(snapshot.skills as Skill[]);
    setRoutines(snapshot.routines as Routine[]);
    setApprovals(snapshot.approvals as Approval[]);
    setFiles(snapshot.files as WorkFile[]);
    setNotifications(snapshot.notifications as WorkNotification[]);
    setActivity(snapshot.activity as Activity[]);
  }, []);

  useEffect(() => {
    cloudHydrated.current = false;
    setReady(false);
    setLocalLoaded(false);
    applySnapshot(emptyWorkroomSnapshot());
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(localStorageKey);
        if (raw) applySnapshot(JSON.parse(raw));
      } catch {
        /* A damaged fallback cache must never block the workroom. */
      } finally {
        setLocalLoaded(true);
      }
    })();
  }, [applySnapshot, localStorageKey]);
  useEffect(() => {
    if (!localLoaded) return;
    if (!isAuthenticated) {
      cloudHydrated.current = false;
      setReady(true);
      return;
    }
    if (cloudQuery.isLoading) return;
    if (cloudQuery.isError) {
      // Keep the account-specific local cache usable while offline, but never
      // allow it to save over a cloud snapshot we could not load.
      cloudHydrated.current = false;
      setReady(true);
      return;
    }
    if (!cloudHydrated.current) {
      if (cloudQuery.data?.snapshot) applySnapshot(cloudQuery.data.snapshot);
      cloudHydrated.current = true;
      setReady(true);
    }
  }, [
    applySnapshot,
    cloudQuery.data,
    cloudQuery.isError,
    cloudQuery.isLoading,
    isAuthenticated,
    localLoaded,
  ]);

  const snapshot = useMemo<WorkroomCloudSnapshot>(
    () =>
      normalizeWorkroomSnapshot({
        selectedBotId,
        onboardingComplete,
        aiProvider,
        bots,
        messages,
        tasks,
        skills,
        routines,
        approvals,
        files,
        notifications,
        activity,
      }),
    [
      selectedBotId,
      onboardingComplete,
      aiProvider,
      bots,
      messages,
      tasks,
      skills,
      routines,
      approvals,
      files,
      notifications,
      activity,
    ],
  );
  useEffect(() => {
    if (!ready) return;
    void AsyncStorage.setItem(localStorageKey, JSON.stringify(snapshot));
  }, [localStorageKey, ready, snapshot]);
  useEffect(() => {
    if (!ready || !isAuthenticated || !cloudHydrated.current) return;
    const handle = setTimeout(() => {
      void saveCloudRef.current({ snapshot }).catch(() => undefined);
    }, 550);
    return () => clearTimeout(handle);
  }, [isAuthenticated, ready, snapshot]);

  const addActivity = useCallback(
    (entry: Omit<Activity, "id" | "createdAt">) =>
      setActivity((current) => [
        { ...entry, id: makeId("activity"), createdAt: "Now" },
        ...current,
      ]),
    [],
  );
  const addMessage = useCallback(
    (message: Omit<WorkMessage, "id" | "createdAt">) =>
      setMessages((current) => [
        ...current,
        { ...message, id: makeId("message"), createdAt: timeNow() },
      ]),
    [],
  );
  const createBot = useCallback(
    (values: BotInput) => {
      const newBot: Bot = {
        id: makeId("bot"),
        name: values.name.trim(),
        role: values.role.trim(),
        purpose: values.purpose.trim(),
        avatar: values.name.trim().slice(0, 1).toUpperCase(),
        color: values.color ?? BOT_COLORS[bots.length % BOT_COLORS.length],
        icon: values.icon ?? DEFAULT_BOT_ICON,
        status: "Ready",
        memory: values.memory?.trim() || "No preferences saved yet.",
        approvalRule:
          values.approvalRule?.trim() ||
          "Ask before external, irreversible, or sensitive actions.",
        model: values.model?.trim() || "openrouter/free",
        lastActive: "Just created",
      };
      setBots((current) => [newBot, ...current]);
      setSelectedBotId(newBot.id);
      setOnboardingComplete(true);
      addActivity({
        title: `${newBot.name} is ready`,
        detail: `${newBot.role} created from your instructions`,
        tone: "mint",
      });
      return newBot;
    },
    [addActivity, bots.length],
  );
  const updateBotStatus = useCallback(
    (id: string, status: Bot["status"]) =>
      setBots((current) =>
        current.map((bot) =>
          bot.id === id
            ? {
                ...bot,
                status,
                lastActive:
                  status === "Working" ? "Working now" : "Just updated",
              }
            : bot,
        ),
      ),
    [],
  );
  const updateBotModel = useCallback(
    (id: string, model: string) =>
      setBots((current) =>
        current.map((bot) =>
          bot.id === id ? { ...bot, model, lastActive: "Model updated" } : bot,
        ),
      ),
    [],
  );
  const addTask = useCallback((task: Omit<WorkTask, "id" | "startedAt">) => {
    const next = { ...task, id: makeId("task"), startedAt: timeNow() };
    setTasks((current) => [next, ...current]);
    return next;
  }, []);
  const updateTaskStatus = useCallback(
    (id: string, status: TaskStatus, nextAction?: string) =>
      setTasks((current) =>
        current.map((task) =>
          task.id === id
            ? { ...task, status, nextAction: nextAction ?? task.nextAction }
            : task,
        ),
      ),
    [],
  );
  const handOffTask = useCallback(
    (taskId: string, toBotId: string, note?: string) => {
      const task = tasks.find((item) => item.id === taskId);
      if (!task || task.botId === toBotId) return;
      const fromBot = bots.find((bot) => bot.id === task.botId);
      const toBot = bots.find((bot) => bot.id === toBotId);
      if (!toBot) return;
      const at = timeNow();
      setTasks((current) =>
        current.map((item) =>
          item.id === taskId
            ? {
                ...item,
                botId: toBotId,
                handoffHistory: [
                  ...(item.handoffHistory ?? [{ botId: item.botId, at: item.startedAt }]),
                  { botId: toBotId, at },
                ],
              }
            : item,
        ),
      );
      addMessage({
        botId: toBotId,
        author: "system",
        conversationId: `chat-legacy`,
        body: `${fromBot?.name ?? "A teammate"} handed “${task.title}” to ${toBot.name}${note ? `: ${note}` : "."}`,
        kind: "handoff",
        taskId,
      });
      addActivity({
        title: `Handoff: ${task.title}`,
        detail: `${fromBot?.name ?? "Unassigned"} → ${toBot.name}`,
        tone: "mint",
      });
    },
    [addActivity, addMessage, bots, tasks],
  );
  const addSkill = useCallback(
    (skill: Omit<Skill, "id">) => {
      setSkills((current) => [{ ...skill, id: makeId("skill") }, ...current]);
      addActivity({
        title: `Skill saved: ${skill.name}`,
        detail:
          "Review its rules and test it on a safe example before automation.",
        tone: "mint",
      });
    },
    [addActivity],
  );
  const addApproval = useCallback(
    (approval: Omit<Approval, "id" | "createdAt" | "state">) => {
      setApprovals((current) => [
        {
          ...approval,
          id: makeId("approval"),
          state: "Pending",
          createdAt: timeNow(),
        },
        ...current,
      ]);
      setNotifications((current) => [
        {
          id: makeId("notification"),
          title: "Approval needed",
          detail: approval.title,
          tone: "amber",
          read: false,
          createdAt: "Now",
        },
        ...current,
      ]);
      addActivity({
        title: "Approval required",
        detail: approval.title,
        tone: "amber",
      });
    },
    [addActivity],
  );
  const addRoutine = useCallback(
    (routine: Omit<Routine, "id">) => {
      setRoutines((current) => [
        { ...routine, id: makeId("routine") },
        ...current,
      ]);
      addActivity({
        title: `Routine created: ${routine.name}`,
        detail: `${routine.owner} · ${routine.state}`,
        tone: routine.state === "Active" ? "mint" : "muted",
      });
    },
    [addActivity],
  );
  const toggleRoutine = useCallback(
    (id: string) =>
      setRoutines((current) =>
        current.map((routine) =>
          routine.id === id
            ? {
                ...routine,
                state: routine.state === "Active" ? "Paused" : "Active",
              }
            : routine,
        ),
      ),
    [],
  );
  const resolveApproval = useCallback(
    (id: string, state: "Approved" | "Declined") => {
      const found = approvals.find((approval) => approval.id === id);
      if (!found || found.state !== "Pending") return;
      setApprovals((current) =>
        current.map((approval) =>
          approval.id === id ? { ...approval, state } : approval,
        ),
      );
      addActivity({
        title: `Approval ${state.toLowerCase()}`,
        detail: found.title,
        tone: state === "Approved" ? "mint" : "coral",
      });
      setNotifications((current) =>
        current.map((notification) =>
          notification.title === "Approval needed"
            ? { ...notification, read: true }
            : notification,
        ),
      );
    },
    [addActivity, approvals],
  );
  const addFile = useCallback(
    (file: Omit<WorkFile, "id" | "updatedAt">) =>
      setFiles((current) => [
        { ...file, id: makeId("file"), updatedAt: "Added just now" },
        ...current,
      ]),
    [],
  );
  const markNotificationsRead = useCallback(
    () =>
      setNotifications((current) =>
        current.map((notification) => ({ ...notification, read: true })),
      ),
    [],
  );
  const clearWorkroom = useCallback(
    () => applySnapshot(emptyWorkroomSnapshot()),
    [applySnapshot],
  );
  const syncStatus: SyncStatus = !isAuthenticated
    ? "Local only"
    : cloudQuery.isLoading || !cloudHydrated.current
      ? "Connecting"
      : saveCloud.isPending
        ? "Saving"
        : saveCloud.isError || cloudQuery.isError
          ? "Offline changes kept locally"
          : "Synced";
  const value = useMemo<WorkroomContextValue>(
    () => ({
      ready,
      onboardingComplete,
      selectedBotId,
      aiProvider,
      bots,
      messages,
      tasks,
      skills,
      routines,
      approvals,
      files,
      notifications,
      activity,
      syncStatus,
      selectBot: setSelectedBotId,
      setAiProvider,
      createBot,
      updateBotStatus,
      updateBotModel,
      addMessage,
      addTask,
      updateTaskStatus,
      handOffTask,
      addSkill,
      addApproval,
      addRoutine,
      toggleRoutine,
      resolveApproval,
      addFile,
      markNotificationsRead,
      addActivity,
      completeOnboarding: () => setOnboardingComplete(true),
      clearWorkroom,
    }),
    [
      ready,
      onboardingComplete,
      selectedBotId,
      aiProvider,
      bots,
      messages,
      tasks,
      skills,
      routines,
      approvals,
      files,
      notifications,
      activity,
      syncStatus,
      createBot,
      updateBotStatus,
      updateBotModel,
      addMessage,
      addTask,
      updateTaskStatus,
      handOffTask,
      addSkill,
      addApproval,
      addRoutine,
      toggleRoutine,
      resolveApproval,
      addFile,
      markNotificationsRead,
      addActivity,
      clearWorkroom,
    ],
  );
  return (
    <WorkroomContext.Provider value={value}>
      {children}
    </WorkroomContext.Provider>
  );
}

export function useWorkroom() {
  const context = useContext(WorkroomContext);
  if (!context)
    throw new Error("useWorkroom must be used within WorkroomProvider");
  return context;
}
