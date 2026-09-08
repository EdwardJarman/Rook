import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { BotCreateSheet } from "@/components/bot-create-sheet";
import { AgentActivityTrace } from "@/components/agent-activity-trace";
import { AiWorkingIndicator } from "@/components/ai-working-indicator";
import { ComposerConnectorsSheet } from "@/components/composer-connectors-sheet";
import { ComposerModelPicker } from "@/components/composer-model-picker";
import { MobileBotDrawer } from "@/components/mobile-bot-drawer";
import { RookLogo } from "@/components/rook-logo";
import {
  Avatar,
  EmptyState,
  IconButton,
  PrimaryButton,
  Sheet,
  SheetEyebrow,
  useRookTheme,
} from "@/components/rook-primitives";
import { MathNotation } from "@/components/math-notation";
import { ScreenContainer } from "@/components/screen-container";
import { botDropTargetProps, useBotDrag } from "@/lib/bot-drag";
import {
  composerPasteProps,
  imageDropTargetProps,
  type PastedImage,
} from "@/lib/composer-images";
import {
  insertBotMention,
  matchingBotsForMention,
  trailingBotMentionQuery,
} from "@/lib/bot-mentions";
import { useDesktopSidebar } from "@/lib/desktop-sidebar-state";
import { useRookNotifications } from "@/lib/rook-notifications";
import { trpc } from "@/lib/trpc";
import { tint } from "@/lib/ui";
import {
  canonicalModelForProvider,
  defaultModelForProvider,
  modelMatchesProvider,
  providerForModel,
  providerLabel,
} from "@/lib/ai-provider";
import {
  parseChatMarkdown,
  type ChatMarkdownInline,
} from "@/lib/chat-markdown";
import { splitMathNotation } from "@/lib/math-notation";
import { assessRisk, fileSizeLabel } from "@/lib/workroom-helpers";
import { useWorkroom, type Approval, type Bot, type WorkMessage } from "@/lib/workroom-store";

/**
 * Rook is one room.
 *
 * The user lands here on sign-in and this is the whole app: a single chat
 * transcript. Bots join the room by being dragged (desktop) or added from the
 * picker, and every Bot in the room gets its mark in the strip along the top.
 * The composer talks to whichever Bot is focused there.
 *
 * A brand-new account sees a calm invitation and a blank sidebar — no sample
 * teammates, no fabricated chatter.
 */
export default function ChatScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors } = useRookTheme();
  const { visible: desktopSidebarVisible, show: showDesktopSidebar } =
    useDesktopSidebar();
  const workroom = useWorkroom();
  const { bots, messages, approvals } = workroom;
  const {
    ready: roomReady,
    chatBotIds,
    activeChatBotId,
    activeChatId,
    focusChatBot,
    addBotToChat,
    removeBotFromChat,
    startNewChat,
    draggingBot,
    dropActive,
    setDropActive,
  } = useBotDrag();
  const [composer, setComposer] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [excelAttached, setExcelAttached] = useState(false);
  const [githubAttached, setGithubAttached] = useState(false);
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([]);
  const [imageDropActive, setImageDropActive] = useState(false);
  const replyMutation = trpc.workroom.reply.useMutation();
  const voiceMutation = trpc.voice.transcribe.useMutation();
  const modelCatalog = trpc.ai.models.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const { preferences: notificationPreferences, sendTaskAlert } =
    useRookNotifications();
  const threadRef = useRef<ScrollView>(null);

  const isCompactLayout = width < 960;
  const isDesktopWeb = Platform.OS === "web" && !isCompactLayout;
  const chatBots = useMemo(
    () => bots.filter((bot) => chatBotIds.includes(bot.id)),
    [bots, chatBotIds],
  );
  const activeMention = useMemo(
    () => trailingBotMentionQuery(composer),
    [composer],
  );
  const mentionMatches = useMemo(
    () => matchingBotsForMention(bots, composer),
    [bots, composer],
  );
  const activeBot = useMemo(
    () =>
      chatBots.find((bot) => bot.id === activeChatBotId) ?? chatBots[0] ?? null,
    [activeChatBotId, chatBots],
  );
  const activeProvider = useMemo(
    () => providerForModel(activeBot?.model, workroom.aiProvider),
    [activeBot?.model, workroom.aiProvider],
  );
  const resolvedModel = useMemo(() => {
    if (!activeBot) return undefined;
    const models = modelCatalog.data?.models ?? [];
    const canonical = canonicalModelForProvider(
      activeBot.model,
      activeProvider,
    );
    const selected = models.find(
      (model) =>
        model.id === canonical &&
        modelMatchesProvider(model.id, activeProvider),
    );
    if (selected) return selected;
    return (
      defaultModelForProvider(models, activeProvider) ??
      (activeProvider === "openrouter" ? { id: "openrouter/free" } : undefined)
    );
  }, [activeBot, activeProvider, modelCatalog.data?.models]);

  /* The whole room reads as one conversation: every message from a Bot that is present. */
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          chatBotIds.includes(message.botId) &&
          (message.conversationId ?? "chat-legacy") === activeChatId,
      ),
    [activeChatId, chatBotIds, messages],
  );
  const pendingApproval = activeBot
    ? approvals.find(
        (approval) =>
          approval.botId === activeBot.id && approval.state === "Pending",
      )
    : undefined;

  const resolveExcelAction = trpc.excel.resolveAction.useMutation();
  const computerDecideCommand = trpc.nodes.computer.decideCommand.useMutation();
  const computerPoll = trpc.nodes.computer.poll.useMutation();
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(
    null,
  );

  /**
   * Approvals resolve here, in the chat — no tab switching. The proposal card
   * below the thread carries Approve/Decline; the result lands back in the
   * conversation as a bot message.
   */
  const decideInline = async (
    approval: Approval,
    decision: "approve" | "decline",
  ) => {
    if (resolvingApprovalId) return;
    if (!approval.externalActionId) {
      workroom.resolveApproval(
        approval.id,
        decision === "approve" ? "Approved" : "Declined",
      );
      return;
    }
    setResolvingApprovalId(approval.id);
    const approved = decision === "approve";
    const say = (body: string) =>
      workroom.addMessage({
        botId: approval.botId,
        author: "bot",
        body,
        kind: "message",
        taskId: approval.taskId,
        conversationId: activeChatId,
      });
    try {
      if (approval.kind === "cloud" || approval.kind === "local") {
        await computerDecideCommand.mutateAsync({
          commandId: approval.externalActionId,
          decision: approved ? ("approved" as const) : ("declined" as const),
        });
        workroom.resolveApproval(
          approval.id,
          approved ? "Approved" : "Declined",
        );
        if (!approved) {
          if (approval.taskId)
            workroom.updateTaskStatus(
              approval.taskId,
              "Cancelled",
              "The proposed action was declined.",
            );
          say("Declined — I won't run that action.");
          return;
        }
        // Cloud commands execute server-side; local ones are delivered to the
        // device and complete within a few seconds. Poll until terminal.
        let executed:
          | { ok: boolean; result?: unknown; message?: string; state?: string }
          | undefined;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          executed = await computerPoll.mutateAsync({
            commandId: approval.externalActionId,
          });
          if (
            !executed ||
            executed.state === "completed" ||
            executed.state === "declined" ||
            executed.state === "expired"
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 1_200));
        }
        const summary = summarizeComputerResult(
          executed ?? { ok: false, message: "The command did not finish." },
        );
        if (executed?.ok) {
          if (approval.taskId)
            workroom.updateTaskStatus(
              approval.taskId,
              "Completed",
              "The approved action finished.",
            );
          say(`Done. ${summary}`);
        } else {
          if (approval.taskId)
            workroom.updateTaskStatus(
              approval.taskId,
              "Completed",
              "The action finished with an error.",
            );
          say(`The computer reported: ${executed?.message ?? summary}`);
        }
        return;
      }

      const result = await resolveExcelAction.mutateAsync({
        actionId: approval.externalActionId,
        decision,
      });
      workroom.resolveApproval(
        approval.id,
        approved ? "Approved" : "Declined",
      );
      if (result.executed) {
        if (approval.taskId)
          workroom.updateTaskStatus(
            approval.taskId,
            "Completed",
            "The approved Excel change was applied.",
          );
        say(`Excel updated. ${result.summary}`);
      } else {
        if (approval.taskId)
          workroom.updateTaskStatus(
            approval.taskId,
            "Cancelled",
            "The proposed Excel change was declined.",
          );
        say("Declined — I won't change the workbook.");
      }
    } catch (error) {
      Alert.alert(
        "Action not completed",
        error instanceof Error
          ? error.message
          : "Rook could not complete this action. Nothing was changed.",
      );
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const [handoffOpen, setHandoffOpen] = useState(false);
  /* Group workroom: the most recent open task owned by the active Bot in this chat. */
  const activeTaskForHandoff = useMemo(() => {
    if (!activeBot) return undefined;
    return workroom.tasks.find(
      (task) =>
        task.botId === activeBot.id &&
        !["Completed", "Cancelled", "Failed"].includes(task.status),
    );
  }, [activeBot, workroom.tasks]);
  const handoffCandidates = useMemo(
    () => chatBots.filter((bot) => bot.id !== activeBot?.id),
    [chatBots, activeBot?.id],
  );

  /* Keep the newest message in view as the thread grows. */
  useEffect(() => {
    if (visibleMessages.length > 0)
      threadRef.current?.scrollToEnd({ animated: true });
  }, [visibleMessages.length]);

  const handleSend = async () => {
    const clean = composer.trim();
    const images = pendingImages;
    if ((!clean && !images.length) || !activeBot) return;
    if (!resolvedModel) {
      Alert.alert(
        "No model available",
        activeProvider === "chatgpt"
          ? "Reconnect ChatGPT or switch to OpenRouter from Account."
          : `Rook could not load a ${providerLabel(activeProvider)} model. Check its connection or switch providers from Account.`,
      );
      return;
    }
    // Auto-Review: classify risk into Low/Medium/High rather than a single
    // approve-or-not boolean. Low risk (drafting, research, reading) never
    // creates approval friction; only Medium/High pause for a decision.
    const messageBody = clean || (images.length ? "Shared an image." : "");
    const risk = assessRisk(messageBody);
    const requiresReview = risk.tier !== "Low";
    const task = workroom.addTask({
      botId: activeBot.id,
      title:
        messageBody.length > 52 ? `${messageBody.slice(0, 52)}…` : messageBody,
      status: requiresReview ? "Approval required" : "Planning",
      summary: requiresReview
        ? "Waiting for your decision before any sensitive step."
        : "Preparing a focused response from your instructions.",
      nextAction: requiresReview
        ? "Review the proposed action."
        : "Review the result and decide what happens next.",
      risk: risk.tier,
      steps: [
        {
          id: "scope",
          label: "Understand the result you want",
          state: "active",
        },
        { id: "work", label: "Do the safe work", state: "pending" },
        { id: "return", label: "Return the result", state: "pending" },
      ],
    });
    workroom.addMessage({
      botId: activeBot.id,
      author: "user",
      body: messageBody,
      conversationId: activeChatId,
      imageUris: images.length ? images.map((image) => image.uri) : undefined,
    });
    setComposer("");
    setPendingImages([]);
    if (requiresReview) {
      workroom.addApproval({
        botId: activeBot.id,
        title: task.title,
        detail: risk.reason,
        risk: risk.tier === "High" ? "High" : "Medium",
      });
      void sendTaskAlert({
        kind: "approval",
        title: "Approval needed in Rook",
        body: `${activeBot.name} needs your decision`,
        url: "/",
      });
      workroom.addMessage({
        botId: activeBot.id,
        author: "bot",
        conversationId: activeChatId,
        body: `I can prepare the work, but I need your approval before this step. ${risk.reason}`,
        kind: "approval",
        taskId: task.id,
      });
      return;
    }
    workroom.updateBotStatus(activeBot.id, "Working");
    try {
      workroom.updateTaskStatus(
        task.id,
        "Working",
        "Finishing the requested work.",
      );
      const response = await replyMutation.mutateAsync({
        botId: activeBot.id,
        taskId: task.id,
        botName: activeBot.name,
        botRole: activeBot.role,
        botPurpose: activeBot.purpose,
        model: resolvedModel.id,
        message: messageBody,
        userTimeZone: deviceTimeZone(),
        connectors: [
          ...(excelAttached ? (["microsoft-excel"] as const) : []),
          ...(githubAttached ? (["github"] as const) : []),
        ],
        recentContext: visibleMessages
          .slice(-6)
          .map((message) => ({ author: message.author, body: message.body })),
      });
      setExcelAttached(false);
      setGithubAttached(false);
      if (response.approvals.length) {
        workroom.updateTaskStatus(
          task.id,
          "Approval required",
          "Review the exact Excel change in Updates.",
        );
        response.approvals.forEach((approval) =>
          workroom.addApproval({
            botId: activeBot.id,
            taskId: task.id,
            externalActionId: approval.actionId,
            kind: approval.kind ?? "excel",
            title: approval.title,
            detail: approval.detail,
            risk: approval.risk,
          }),
        );
        if (!response.pushDelivery.accepted)
          void sendTaskAlert({
            kind: "approval",
            title: "Excel change needs approval",
            body: `${activeBot.name} prepared a workbook change`,
            url: "/",
          });
      } else {
        workroom.updateTaskStatus(
          task.id,
          "Completed",
          "Result returned. You can refine or start a new task.",
        );
      }
      workroom.updateBotStatus(activeBot.id, "Ready");
      workroom.addMessage({
        botId: activeBot.id,
        author: "bot",
        conversationId: activeChatId,
        body: response.text,
        kind: response.approvals.length ? "approval" : "message",
        trace: response.trace,
        taskId: task.id,
      });
      if (
        !response.approvals.length &&
        notificationPreferences.completion &&
        !response.pushDelivery.accepted
      )
        void sendTaskAlert({
          kind: "completion",
          title: `${activeBot.name} completed a task`,
          body: response.text.slice(0, 170),
          url: "/",
        });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Free AI capacity is unavailable right now. Please try again shortly.";
      workroom.updateTaskStatus(task.id, "Partially completed", message);
      workroom.updateBotStatus(activeBot.id, "Ready");
      workroom.addMessage({
        botId: activeBot.id,
        author: "bot",
        conversationId: activeChatId,
        body: `${message} Nothing external was attempted.`,
        taskId: task.id,
      });
    }
  };

  const addPendingImages = (images: PastedImage[]) => {
    if (!images.length) return;
    setPendingImages((current) => [...current, ...images]);
  };
  const removePendingImage = (uri: string) =>
    setPendingImages((current) => current.filter((image) => image.uri !== uri));
  const composerImageDropProps = imageDropTargetProps({
    onEnter: () => setImageDropActive(true),
    onLeave: () => setImageDropActive(false),
    onImages: (images) => {
      setImageDropActive(false);
      addPendingImages(images);
    },
  }) as object;

  const handleAttach = async () => {
    if (!activeBot) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: "*/*",
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      workroom.addFile({
        name: asset.name,
        size: fileSizeLabel(asset.size),
        scope: "Bot-private",
        owner: activeBot.name,
      });
      workroom.addMessage({
        botId: activeBot.id,
        author: "system",
        conversationId: activeChatId,
        body: `Attached ${asset.name}. It is available only to ${activeBot.name} in this room.`,
        kind: "activity",
        attachmentName: asset.name,
      });
    } catch {
      Alert.alert(
        "File attachment unavailable",
        "Rook could not attach this file. Please try again from the device file picker.",
      );
    }
  };

  const handleVoice = async () => {
    if (voiceMutation.isPending) return;
    if (recorderState.isRecording) {
      try {
        await audioRecorder.stop();
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        const uri = audioRecorder.uri;
        if (!uri) throw new Error("The recording file was not created.");
        const data = await audioToBase64(uri);
        if (data.length > 12_000_000)
          throw new Error(
            "That voice note is too long. Keep recordings under one minute.",
          );
        const result = await voiceMutation.mutateAsync({
          data,
          format: Platform.OS === "web" ? "webm" : "m4a",
        });
        setComposer((current) =>
          [current.trim(), result.text.trim()]
            .filter(Boolean)
            .join(current.trim() ? " " : ""),
        );
      } catch (error) {
        Alert.alert(
          "Voice input unavailable",
          error instanceof Error
            ? error.message
            : "Rook could not transcribe that recording.",
        );
      }
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone permission needed",
          "Allow microphone access to dictate a message to Rook.",
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch {
      Alert.alert(
        "Microphone unavailable",
        "Rook could not start recording on this device.",
      );
    }
  };

  const handleMentionSelect = (bot: Bot) => {
    addBotToChat(bot.id);
    focusChatBot(bot.id);
    setComposer((current) => insertBotMention(current, bot.name));
  };

  const handleNewChat = () => {
    startNewChat();
    setComposer("");
    setDrawerOpen(false);
  };

  const handleDrawerBotSelect = (botId: string) => {
    addBotToChat(botId);
    focusChatBot(botId);
    setDrawerOpen(false);
  };

  const hasComposerContent =
    Boolean(composer.trim()) || pendingImages.length > 0;
  const canSend =
    hasComposerContent &&
    Boolean(activeBot) &&
    !recorderState.isRecording &&
    !replyMutation.isPending &&
    !voiceMutation.isPending;
  /* The button looks armed once there's text, even with no Bot in the room
     yet — tapping it should prompt adding one instead of silently no-oping. */
  const needsBotToSend = hasComposerContent && !activeBot;
  const roomHasBots = chatBots.length > 0 || activeChatId !== "chat-legacy";
  const isPhoneExperience = isCompactLayout;
  const stageDropProps = botDropTargetProps({
    onEnter: () => setDropActive(true),
    onLeave: () => setDropActive(false),
    onDropBot: (botId) => addBotToChat(botId),
  }) as object;

  return (
    <ScreenContainer
      containerClassName="bg-background"
      className="flex-1"
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Top bar — the brand, plus quiet actions. The room's identity lives in the strip below. */}
        <View
          style={{
            minHeight: 58,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            gap: 10,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
            backgroundColor: colors.canvas,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              flex: 1,
              minWidth: 0,
            }}
          >
            {isCompactLayout ? (
              <IconButton
                icon="menu"
                label="Open your Bots"
                onPress={() => setDrawerOpen(true)}
              />
            ) : isDesktopWeb && !desktopSidebarVisible ? (
              <IconButton
                icon="menu"
                label="Open your Bots"
                onPress={showDesktopSidebar}
              />
            ) : null}
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 11,
                backgroundColor: colors.ink,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <RookLogo size={24} color={colors.onInk} />
            </View>
            <Text
              style={{
                color: colors.text,
                fontSize: 16,
                fontWeight: "700",
                letterSpacing: -0.3,
              }}
            >
              Rook
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {activeBot ? (
              <IconButton
                icon="folder-open"
                label={`Open ${activeBot.name}'s files`}
                onPress={() => setFilesOpen(true)}
              />
            ) : null}
            <IconButton
              icon="person-outline"
              label="Open account and connected apps"
              onPress={() => router.navigate("/account" as never)}
            />
            <IconButton
              icon="add"
              label="Add a Bot"
              onPress={() => setPickerOpen(true)}
              tone="accent"
            />
          </View>
        </View>

        {!roomReady || !workroom.ready ? (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.textFaint, fontSize: 13 }}>
              Opening your room…
            </Text>
          </View>
        ) : !roomHasBots ? (
          /* Empty room. A brand-new account sees a calm first-run invitation;
             a user with Bots but none in the room gets asked to bring one in. */
          bots.length === 0 ? (
            <View
              {...stageDropProps}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 30,
                paddingBottom: 40,
                backgroundColor: dropActive
                  ? tint(colors.accent, 0.05)
                  : colors.canvas,
              }}
            >
              <View
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 26,
                  backgroundColor: colors.ink,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 26,
                }}
              >
                <RookLogo size={56} color={colors.onInk} />
              </View>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 26,
                  lineHeight: 32,
                  fontWeight: "700",
                  letterSpacing: -0.8,
                  textAlign: "center",
                }}
              >
                Start with one good Bot.
              </Text>
              <Text
                style={{
                  color: colors.textSoft,
                  fontSize: 14,
                  lineHeight: 21,
                  textAlign: "center",
                  maxWidth: 320,
                  marginTop: 10,
                }}
              >
                Give it a name and a job, then bring it into the room and the
                conversation begins.
              </Text>
              <View style={{ marginTop: 24 }}>
                <PrimaryButton
                  label="Make a Bot"
                  icon="add"
                  onPress={() => setCreateOpen(true)}
                />
              </View>
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 12,
                  lineHeight: 17,
                  textAlign: "center",
                  maxWidth: 280,
                  marginTop: 18,
                }}
              >
                {isPhoneExperience
                  ? "Use this button whenever you are ready to bring it into the chat."
                  : "Drag it from the sidebar when you are ready, or add it from here."}
              </Text>
            </View>
          ) : (
            <View
              {...stageDropProps}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 30,
                paddingBottom: 40,
                backgroundColor: dropActive
                  ? tint(colors.accent, 0.05)
                  : colors.canvas,
              }}
            >
              <View
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 26,
                  backgroundColor: colors.ink,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 26,
                }}
              >
                <MaterialIcons
                  name="group-add"
                  size={32}
                  color={colors.onInk}
                />
              </View>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 26,
                  lineHeight: 32,
                  fontWeight: "700",
                  letterSpacing: -0.8,
                  textAlign: "center",
                }}
              >
                Bring a teammate into the room.
              </Text>
              <Text
                style={{
                  color: colors.textSoft,
                  fontSize: 14,
                  lineHeight: 21,
                  textAlign: "center",
                  maxWidth: 320,
                  marginTop: 10,
                }}
              >
                {isPhoneExperience
                  ? "Use Add a Bot to bring one into this conversation."
                  : "Drag a Bot from the sidebar onto the chat, or add one here and it joins the room."}
              </Text>
              <View style={{ marginTop: 24 }}>
                <PrimaryButton
                  label="Add a Bot"
                  icon="add"
                  onPress={() => setPickerOpen(true)}
                />
              </View>
              {draggingBot && dropActive ? (
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: 13,
                    fontWeight: "700",
                    marginTop: 18,
                  }}
                >
                  Drop to add {draggingBot.name}
                </Text>
              ) : null}
            </View>
          )
        ) : (
          <>
            {/* Participant marks appear only after a compact New Chat has Bots. The
                prior always-visible strip is deliberately absent on mobile. */}
            {!isCompactLayout ||
            (activeChatId !== "chat-legacy" && chatBots.length > 0) ? (
              <View
                style={{
                  minHeight: 58,
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                  backgroundColor: colors.canvas,
                }}
              >
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    gap: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 9,
                  }}
                >
                  {chatBots.map((bot) => (
                    <RoomBotChip
                      key={bot.id}
                      bot={bot}
                      active={bot.id === activeBot?.id}
                      onFocus={() => focusChatBot(bot.id)}
                      onRemove={() => removeBotFromChat(bot.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View
              style={[
                { flex: 1 },
                dropActive && { backgroundColor: tint(colors.accent, 0.05) },
              ]}
              {...stageDropProps}
            >
              <ScrollView
                ref={threadRef}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingTop: 18,
                  paddingBottom: 22,
                  gap: 16,
                  maxWidth: 760,
                  width: "100%",
                  alignSelf: "center",
                }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {pendingApproval ? (
                  <View
                    style={{
                      gap: 11,
                      padding: 14,
                      borderRadius: 16,
                      backgroundColor: colors.amberSoft,
                      borderWidth: 1,
                      borderColor: tint(colors.amber, 0.28),
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 11,
                      }}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 12,
                          backgroundColor: tint(colors.amber, 0.14),
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <MaterialIcons
                          name="shield"
                          size={18}
                          color={colors.amber}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={{
                            color: colors.text,
                            fontSize: 13.5,
                            fontWeight: "600",
                          }}
                        >
                          Approval needed
                        </Text>
                        <Text
                          numberOfLines={2}
                          style={{
                            color: colors.amber,
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          {pendingApproval.detail}
                        </Text>
                      </View>
                    </View>
                    {resolvingApprovalId === pendingApproval.id ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 9,
                        }}
                      >
                        <ActivityIndicator
                          size="small"
                          color={colors.amber}
                        />
                        <Text
                          style={{
                            color: colors.amber,
                            fontSize: 12.5,
                            fontWeight: "600",
                          }}
                        >
                          Working…
                        </Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Decline this action"
                          onPress={() => void decideInline(pendingApproval, "decline")}
                          style={({ pressed }) => ({
                            flex: 1,
                            minHeight: 42,
                            borderRadius: 13,
                            borderWidth: 1,
                            borderColor: colors.line,
                            backgroundColor: colors.surfaceAlt,
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: pressed ? 0.75 : 1,
                          })}
                        >
                          <Text
                            style={{
                              color: colors.text,
                              fontSize: 13,
                              fontWeight: "700",
                            }}
                          >
                            Decline
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Approve this action"
                          onPress={() => void decideInline(pendingApproval, "approve")}
                          style={({ pressed }) => ({
                            flex: 1,
                            minHeight: 42,
                            borderRadius: 13,
                            backgroundColor: colors.ink,
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: pressed ? 0.75 : 1,
                          })}
                        >
                          <Text
                            style={{
                              color: colors.onInk,
                              fontSize: 13,
                              fontWeight: "700",
                            }}
                          >
                            Approve
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ) : null}

                {activeTaskForHandoff && handoffCandidates.length ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Hand off ${activeTaskForHandoff.title} to another Bot in the room`}
                    onPress={() => setHandoffOpen(true)}
                    style={({ pressed }) => [
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 9,
                        paddingHorizontal: 13,
                        paddingVertical: 10,
                        borderRadius: 14,
                        backgroundColor: colors.surfaceAlt,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="swap-horiz"
                      size={16}
                      color={colors.textSoft}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: colors.textSoft,
                        fontSize: 12.5,
                        fontWeight: "600",
                      }}
                    >
                      Hand off “{activeTaskForHandoff.title}” to another Bot
                    </Text>
                    <MaterialIcons
                      name="chevron-right"
                      size={18}
                      color={colors.textFaint}
                    />
                  </Pressable>
                ) : null}

                {visibleMessages.length ? (
                  <View style={{ gap: 14, paddingTop: 2 }}>
                    {visibleMessages.map((message) => {
                      const source = bots.find(
                        (bot) => bot.id === message.botId,
                      );
                      if (
                        message.author === "system" ||
                        message.kind === "activity"
                      ) {
                        return (
                          <View
                            key={message.id}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 7,
                              paddingVertical: 2,
                              maxWidth: "100%",
                            }}
                          >
                            <View
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: 3,
                                backgroundColor: colors.textFaint,
                              }}
                            />
                            <Text
                              style={{
                                flex: 1,
                                color: colors.textFaint,
                                fontSize: 11.5,
                                lineHeight: 16,
                              }}
                            >
                              {message.body}
                            </Text>
                          </View>
                        );
                      }
                      if (message.author === "user") {
                        return (
                          <View
                            key={message.id}
                            style={{ alignItems: "flex-end", paddingLeft: 48 }}
                          >
                            <View
                              style={{
                                backgroundColor: colors.ink,
                                borderRadius: 20,
                                borderBottomRightRadius: 7,
                                paddingHorizontal: 15,
                                paddingVertical: 11,
                                maxWidth: "100%",
                              }}
                            >
                              {message.imageUris?.length ? (
                                <View
                                  style={{
                                    flexDirection: "row",
                                    flexWrap: "wrap",
                                    gap: 6,
                                    marginBottom: message.body ? 8 : 0,
                                  }}
                                >
                                  {message.imageUris.map((uri) => (
                                    <Image
                                      key={uri}
                                      source={{ uri }}
                                      style={{
                                        width: 140,
                                        height: 140,
                                        borderRadius: 12,
                                      }}
                                      resizeMode="cover"
                                    />
                                  ))}
                                </View>
                              ) : null}
                              {message.body ? (
                                <Text
                                  style={{
                                    color: colors.onInk,
                                    fontSize: 15,
                                    lineHeight: 21.5,
                                  }}
                                >
                                  {message.body}
                                </Text>
                              ) : null}
                              {message.attachmentName ? (
                                <FileChip name={message.attachmentName} />
                              ) : null}
                            </View>
                            <Text
                              style={{
                                color: colors.textFaint,
                                fontSize: 10.5,
                                marginTop: 5,
                                marginRight: 4,
                              }}
                            >
                              {message.createdAt}
                            </Text>
                          </View>
                        );
                      }
                      if (message.kind === "approval") {
                        return (
                          <View
                            key={message.id}
                            style={{
                              flexDirection: "row",
                              gap: 10,
                              backgroundColor: colors.amberSoft,
                              borderWidth: 1,
                              borderColor: tint(colors.amber, 0.25),
                              borderRadius: 16,
                              padding: 13,
                            }}
                          >
                            <MaterialIcons
                              name="shield"
                              size={17}
                              color={colors.amber}
                            />
                            <ChatMarkdown
                              text={message.body}
                              color={colors.text}
                              baseSize={13.5}
                            />
                          </View>
                        );
                      }
                      // Ordinary bot reply: plain text with the real activity trace.
                      return (
                        <BotMessage
                          key={message.id}
                          message={message}
                          bot={source}
                        />
                      );
                    })}
                    {replyMutation.isPending && activeBot ? (
                      <AiWorkingIndicator bot={activeBot} />
                    ) : null}
                  </View>
                ) : (
                  <EmptyState
                    icon="forum"
                    title={
                      activeBot
                        ? `Talk to ${activeBot.name}`
                        : "Start a new chat"
                    }
                    detail={
                      activeBot
                        ? "Describe the outcome you want, the important context, and when this Bot should pause for you."
                        : "Type / in the message box to bring one or more Bots into this chat."
                    }
                  />
                )}
              </ScrollView>

              {/* Drop a Bot anywhere on the stage. */}
              {draggingBot && dropActive ? (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { alignItems: "center", justifyContent: "center" },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      backgroundColor: colors.ink,
                      borderRadius: 999,
                      paddingHorizontal: 18,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: tint(colors.accent, 0.4),
                    }}
                  >
                    <MaterialIcons name="add" size={17} color={colors.onInk} />
                    <Text
                      style={{
                        color: colors.onInk,
                        fontSize: 14,
                        fontWeight: "600",
                      }}
                    >
                      Drop to add {draggingBot.name}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Composer — a two-tier rounded pill inspired by the supplied reference. */}
            <View
              style={{
                backgroundColor: colors.canvas,
                paddingHorizontal: 14,
                paddingTop: 8,
                paddingBottom: 10,
              }}
            >
              <View
                {...composerImageDropProps}
                style={{
                  borderRadius: 28,
                  borderWidth: imageDropActive ? 1.5 : 1,
                  borderColor: imageDropActive
                    ? colors.accent
                    : composerFocused
                      ? tint(colors.accent, 0.35)
                      : colors.line,
                  backgroundColor: imageDropActive
                    ? tint(colors.accent, 0.06)
                    : colors.surface,
                  paddingHorizontal: 12,
                  paddingTop: 10,
                  paddingBottom: 9,
                  maxWidth: 760,
                  width: "100%",
                  alignSelf: "center",
                  gap: 5,
                }}
              >
                {pendingImages.length ? (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: 2,
                    }}
                  >
                    {pendingImages.map((image) => (
                      <View key={image.uri} style={{ position: "relative" }}>
                        <Image
                          source={{ uri: image.uri }}
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: colors.line,
                          }}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${image.name}`}
                          onPress={() => removePendingImage(image.uri)}
                          style={{
                            position: "absolute",
                            top: -6,
                            right: -6,
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            backgroundColor: colors.ink,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <MaterialIcons
                            name="close"
                            size={12}
                            color={colors.onInk}
                          />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                <TextInput
                  nativeID="rook-composer-input"
                  value={composer}
                  onChangeText={setComposer}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  {...composerPasteProps(addPendingImages)}
                  placeholder={
                    activeBot
                      ? "Type your message here…"
                      : "Type / to add a Bot…"
                  }
                  placeholderTextColor={colors.textFaint}
                  multiline
                  editable={!recorderState.isRecording}
                  style={{
                    minHeight: 42,
                    maxHeight: 112,
                    color: colors.text,
                    fontSize: 15.5,
                    lineHeight: 22,
                    paddingTop: Platform.OS === "ios" ? 5 : 3,
                    paddingBottom: 5,
                    paddingHorizontal: 2,
                    textAlignVertical: "top",
                  }}
                  accessibilityLabel={`Message ${activeBot?.name ?? "your Bot"}`}
                />

                {activeMention ? (
                  <View
                    accessibilityLabel="Bot mention suggestions"
                    style={{
                      marginHorizontal: 1,
                      marginBottom: 4,
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: 14,
                      backgroundColor: colors.canvas,
                      overflow: "hidden",
                    }}
                  >
                    {mentionMatches.length ? (
                      mentionMatches.map((bot) => (
                        <Pressable
                          key={bot.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Mention ${bot.name}`}
                          onPress={() => handleMentionSelect(bot)}
                          style={({ pressed }) => ({
                            minHeight: 48,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 9,
                            paddingHorizontal: 10,
                            backgroundColor: pressed
                              ? colors.surfaceAlt
                              : "transparent",
                            borderBottomWidth:
                              bot.id ===
                              mentionMatches[mentionMatches.length - 1]?.id
                                ? 0
                                : StyleSheet.hairlineWidth,
                            borderBottomColor: colors.line,
                          })}
                        >
                          <Avatar
                            label={bot.avatar}
                            color={bot.color}
                            icon={bot.icon}
                            size={27}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                              numberOfLines={1}
                              style={{
                                color: colors.text,
                                fontSize: 13.5,
                                fontWeight: "700",
                              }}
                            >
                              {bot.name}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={{
                                color: colors.textFaint,
                                fontSize: 11.5,
                                marginTop: 1,
                              }}
                            >
                              {bot.role}
                            </Text>
                          </View>
                          {chatBotIds.includes(bot.id) ? (
                            <MaterialIcons
                              name="check"
                              size={17}
                              color={colors.accent}
                            />
                          ) : null}
                        </Pressable>
                      ))
                    ) : (
                      <Text
                        style={{
                          color: colors.textFaint,
                          paddingHorizontal: 12,
                          paddingVertical: 13,
                          fontSize: 12.5,
                        }}
                      >
                        No Bots match “/{activeMention.query}”.
                      </Text>
                    )}
                  </View>
                ) : null}

                <View
                  style={{
                    minHeight: 42,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 2,
                    }}
                  >
                    <ComposerControl
                      icon="attach-file"
                      label="Upload a file"
                      onPress={() => void handleAttach()}
                    />
                    <ComposerControl
                      icon="add"
                      label={
                        excelAttached || githubAttached
                          ? `${excelAttached ? "Microsoft Excel" : "GitHub"} attached. Open connectors`
                          : "Open connectors"
                      }
                      active={excelAttached || githubAttached}
                      onPress={() => setConnectorsOpen(true)}
                    />
                    <ComposerModelPicker
                      value={resolvedModel?.id || activeBot?.model || ""}
                      provider={activeProvider}
                      onChange={(model) =>
                        activeBot &&
                        workroom.updateBotModel(activeBot.id, model)
                      }
                    />
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      canSend
                        ? "Send message"
                        : needsBotToSend
                          ? "Add a Bot to send this message"
                          : recorderState.isRecording
                            ? "Stop recording"
                            : "Record voice message"
                    }
                    onPress={() => {
                      if (canSend) {
                        void handleSend();
                        return;
                      }
                      if (needsBotToSend) {
                        setPickerOpen(true);
                        return;
                      }
                      void handleVoice();
                    }}
                    disabled={
                      replyMutation.isPending || voiceMutation.isPending
                    }
                    style={({ pressed }) => ({
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: canSend
                        ? colors.ink
                        : needsBotToSend
                          ? tint(colors.accent, 0.14)
                          : recorderState.isRecording
                            ? colors.coral
                            : colors.canvas,
                      borderWidth:
                        canSend || recorderState.isRecording || needsBotToSend
                          ? 0
                          : 1,
                      borderColor: colors.lineStrong,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity:
                        replyMutation.isPending || voiceMutation.isPending
                          ? 0.5
                          : pressed
                            ? 0.7
                            : 1,
                    })}
                  >
                    <MaterialIcons
                      name={
                        canSend
                          ? "arrow-upward"
                          : needsBotToSend
                            ? "person-add-alt-1"
                            : recorderState.isRecording
                              ? "stop"
                              : voiceMutation.isPending
                                ? "more-horiz"
                                : "mic"
                      }
                      size={canSend ? 20 : 21}
                      color={
                        canSend || recorderState.isRecording
                          ? colors.onInk
                          : needsBotToSend
                            ? colors.accent
                            : colors.text
                      }
                    />
                  </Pressable>
                </View>

                {recorderState.isRecording ? (
                  <View
                    style={{
                      position: "absolute",
                      left: 15,
                      top: 13,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 7,
                      backgroundColor: colors.surface,
                      paddingRight: 8,
                    }}
                  >
                    <View
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        backgroundColor: colors.coral,
                      }}
                    />
                    <Text
                      style={{
                        color: colors.coral,
                        fontSize: 11.5,
                        fontWeight: "700",
                      }}
                    >
                      Recording{" "}
                      {formatRecordingTime(recorderState.durationMillis)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      <MobileBotDrawer
        visible={drawerOpen}
        bots={bots}
        chatBotIds={chatBotIds}
        activeBotId={activeBot?.id ?? ""}
        onClose={() => setDrawerOpen(false)}
        onNewChat={handleNewChat}
        onCreateBot={() => {
          setDrawerOpen(false);
          setCreateOpen(true);
        }}
        onSelectBot={handleDrawerBotSelect}
      />

      {/* Add a Bot — existing teammates, plus a quiet path to make a new one. */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <View>
            <SheetEyebrow>Room</SheetEyebrow>
            <Text
              style={{
                color: colors.text,
                fontSize: 21,
                lineHeight: 27,
                fontWeight: "700",
                letterSpacing: -0.5,
              }}
            >
              Add to the chat
            </Text>
          </View>
          <IconButton
            icon="add"
            label="Create a Bot"
            onPress={() => {
              setPickerOpen(false);
              setCreateOpen(true);
            }}
            tone="accent"
          />
        </View>
        <ScrollView
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 4, gap: 4 }}
        >
          {bots.map((bot) => {
            const inRoom = chatBotIds.includes(bot.id);
            return (
              <Pressable
                key={bot.id}
                accessibilityRole="button"
                accessibilityLabel={
                  inRoom
                    ? `${bot.name}, already in the room`
                    : `Add ${bot.name} to the room`
                }
                onPress={() => {
                  addBotToChat(bot.id);
                  setPickerOpen(false);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 10,
                    borderRadius: 15,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Avatar
                  label={bot.avatar}
                  color={bot.color}
                  icon={bot.icon}
                  size={42}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.text,
                      fontSize: 14.5,
                      fontWeight: "600",
                      letterSpacing: -0.1,
                    }}
                  >
                    {bot.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.textFaint,
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {bot.status === "Working" ? "Working now" : bot.role}
                  </Text>
                </View>
                {inRoom ? (
                  <MaterialIcons name="check" size={19} color={colors.accent} />
                ) : (
                  <MaterialIcons
                    name="add-circle-outline"
                    size={19}
                    color={colors.textFaint}
                  />
                )}
              </Pressable>
            );
          })}
          {bots.length === 0 ? (
            <EmptyState
              icon="smart-toy"
              title="No Bots yet"
              detail="Make your first teammate and it will appear here, ready to be added to the room."
              action={
                <PrimaryButton
                  label="Make a Bot"
                  icon="add"
                  onPress={() => {
                    setPickerOpen(false);
                    setCreateOpen(true);
                  }}
                />
              }
            />
          ) : null}
        </ScrollView>
      </Sheet>

      <ComposerConnectorsSheet
        visible={connectorsOpen}
        onClose={() => setConnectorsOpen(false)}
        onSelectExcel={() => setExcelAttached(true)}
        onSelectGithub={() => setGithubAttached(true)}
      />

      {/* Create a Bot — shared three-step sheet. */}
      <BotCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(bot) => addBotToChat(bot.id)}
      />

      <BotFilesSheet
        visible={filesOpen}
        onClose={() => setFilesOpen(false)}
        bot={activeBot}
      />

      {/* Group workroom: hand a task from the active Bot to another Bot in the room. */}
      <Sheet visible={handoffOpen} onClose={() => setHandoffOpen(false)}>
        <SheetEyebrow>Hand off</SheetEyebrow>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            lineHeight: 26,
            fontWeight: "700",
            letterSpacing: -0.4,
          }}
        >
          {activeTaskForHandoff?.title ?? "Choose who takes this"}
        </Text>
        <Text
          style={{
            color: colors.textSoft,
            fontSize: 13.5,
            lineHeight: 19.5,
            marginTop: 6,
            marginBottom: 16,
          }}
        >
          The receiving Bot gets a note in the room and this task moves to their
          queue.
        </Text>
        <View style={{ gap: 8 }}>
          {handoffCandidates.map((bot) => (
            <Pressable
              key={bot.id}
              accessibilityRole="button"
              accessibilityLabel={`Hand off to ${bot.name}`}
              onPress={() => {
                if (activeTaskForHandoff) {
                  workroom.handOffTask(activeTaskForHandoff.id, bot.id);
                  focusChatBot(bot.id);
                }
                setHandoffOpen(false);
              }}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 58,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.line,
                  paddingHorizontal: 13,
                },
                pressed && { opacity: 0.72 },
              ]}
            >
              <Avatar
                label={bot.avatar}
                color={bot.color}
                icon={bot.icon}
                size={38}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.text,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                >
                  {bot.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.textFaint,
                    fontSize: 12,
                    marginTop: 1,
                  }}
                >
                  {bot.role}
                </Text>
              </View>
              <MaterialIcons
                name="arrow-forward"
                size={18}
                color={colors.textFaint}
              />
            </Pressable>
          ))}
        </View>
      </Sheet>
    </ScreenContainer>
  );
}

/** One mark in the room strip: tap to talk to it, hover (or long-press) to remove it. */
function RoomBotChip({
  bot,
  active,
  onFocus,
  onRemove,
}: {
  bot: Bot;
  active: boolean;
  onFocus: () => void;
  onRemove: () => void;
}) {
  const { colors } = useRookTheme();
  const [hovered, setHovered] = useState(false);
  const showRemove = active || hovered;

  return (
    <View style={{ alignItems: "center", gap: 5 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Talk to ${bot.name}`}
        accessibilityHint="Long press to remove from the room"
        onPress={onFocus}
        onLongPress={onRemove}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => [
          {
            borderRadius: 14,
            borderWidth: 2,
            borderColor: active ? colors.ink : "transparent",
            padding: 2,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Avatar
          label={bot.avatar}
          color={bot.color}
          icon={bot.icon}
          size={40}
        />
      </Pressable>
      {showRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${bot.name} from the room`}
          onPress={onRemove}
          style={({ pressed }) => [
            {
              position: "absolute",
              top: -4,
              right: -4,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: colors.ink,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <MaterialIcons name="close" size={12} color={colors.onInk} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ChatMarkdown({
  text,
  color,
  baseSize,
}: {
  text: string;
  color: string;
  baseSize: number;
}) {
  const blocks = parseChatMarkdown(text);
  return (
    <View style={{ gap: Math.max(4, Math.round(baseSize * 0.36)) }}>
      {blocks.map((block, index) => {
        const heading = block.type === "heading";
        const lineStyle = {
          color,
          fontSize: heading ? baseSize + (block.level === 1 ? 4 : 2) : baseSize,
          lineHeight: heading
            ? baseSize + (block.level === 1 ? 10 : 8)
            : baseSize + 7,
          fontWeight: heading ? ("700" as const) : ("400" as const),
        };
        if (block.type === "math") {
          return (
            <MathNotation
              key={`math-${index}`}
              latex={block.latex}
              color={color}
              fontSize={baseSize}
              display
            />
          );
        }
        if (block.type === "bullet" || block.type === "ordered") {
          return (
            <View
              key={`${block.type}-${index}`}
              style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}
            >
              <Text
                style={[
                  lineStyle,
                  { minWidth: block.type === "ordered" ? 18 : 10 },
                ]}
              >
                {block.type === "ordered" ? `${block.ordinal}.` : "•"}
              </Text>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                {renderInlineMarkdown(
                  block.content,
                  color,
                  lineStyle.fontSize,
                  lineStyle.fontWeight,
                )}
              </View>
            </View>
          );
        }
        return (
          <View
            key={`${block.type}-${index}`}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {renderInlineMarkdown(
              block.content,
              color,
              lineStyle.fontSize,
              lineStyle.fontWeight,
            )}
          </View>
        );
      })}
    </View>
  );
}

function renderInlineMarkdown(
  parts: ChatMarkdownInline[],
  color: string,
  fontSize: number,
  baseWeight: "400" | "700",
) {
  return parts.flatMap((part, partIndex) =>
    splitMathNotation(part.text).map((segment, segmentIndex) => {
      const key = `${partIndex}-${segmentIndex}-${segment.type}`;
      if (segment.type === "math") {
        return (
          <MathNotation
            key={key}
            latex={segment.latex}
            color={color}
            fontSize={fontSize}
            display={segment.display}
          />
        );
      }
      return (
        <Text
          key={key}
          style={{
            color,
            fontSize,
            lineHeight: fontSize + 7,
            fontWeight: part.bold ? "700" : baseWeight,
            fontFamily: part.code ? "monospace" : undefined,
          }}
        >
          {segment.text}
        </Text>
      );
    }),
  );
}

/** Plain bot reply: text plus the real activity trace underneath. */
function BotMessage({ message, bot }: { message: WorkMessage; bot?: Bot }) {
  const { colors } = useRookTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingRight: 20 }}>
      <View style={{ width: 28, alignItems: "center" }}>
        <Avatar
          label={bot?.avatar ?? "?"}
          color={bot?.color}
          icon={bot?.icon}
          size={28}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {message.trace?.length && bot ? (
          <AgentActivityTrace bot={bot} trace={message.trace} />
        ) : null}
        <ChatMarkdown text={message.body} color={colors.text} baseSize={15} />
        {message.attachmentName ? (
          <FileChip name={message.attachmentName} />
        ) : null}
        <Text
          style={{ color: colors.textFaint, fontSize: 10.5, marginTop: 5 }}
        >
          {message.createdAt}
        </Text>
      </View>
    </View>
  );
}

/** Right-side panel: the focused Bot's own files, browsable and openable. */
function BotFilesSheet({
  visible,
  onClose,
  bot,
}: {
  visible: boolean;
  onClose: () => void;
  bot: Bot | null;
}) {
  const { colors } = useRookTheme();
  const workroom = useWorkroom();
  const [currentPath, setCurrentPath] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const browseFiles = trpc.nodes.computer.browse.useQuery(
    { botId: bot?.id ?? "", path: currentPath },
    { enabled: visible && Boolean(bot), retry: 1 },
  );
  const openedFile = trpc.nodes.computer.readFile.useQuery(
    { botId: bot?.id ?? "", path: openedPath ?? "" },
    { enabled: visible && Boolean(bot) && Boolean(openedPath), retry: 1 },
  );

  const botFiles = bot
    ? workroom.files.filter((file) => file.owner === bot.name)
    : [];
  const botMessages = bot
    ? workroom.messages.filter((message) => message.botId === bot.id)
    : [];

  useEffect(() => {
    if (visible) {
      setCurrentPath("");
      setHistory([]);
      setOpenedPath(null);
    }
  }, [visible, bot?.id]);

  const openPath = (path: string) => {
    setHistory((current) => [...current, currentPath]);
    setCurrentPath(path);
    setOpenedPath(null);
  };

  const goBack = () => {
    setHistory((current) => {
      const previous = current[current.length - 1] ?? "";
      setCurrentPath(previous);
      setOpenedPath(null);
      return current.slice(0, -1);
    });
  };

  const entries = Array.isArray(
    (browseFiles.data as { entries?: unknown } | undefined)?.entries,
  )
    ? ((browseFiles.data as { entries: Array<{ name: string; path: string; type: string; size?: number }> }).entries)
    : [];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetEyebrow>{bot ? `${bot.name}'s files` : "Files"}</SheetEyebrow>
      <Text
        style={{
          color: colors.text,
          fontSize: 20,
          lineHeight: 26,
          fontWeight: "700",
          letterSpacing: -0.4,
        }}
      >
        {bot ? `${bot.name}'s workspace` : "Workspace files"}
      </Text>
      <Text
        style={{
          color: colors.textSoft,
          fontSize: 13,
          lineHeight: 18,
          marginTop: 6,
          marginBottom: 14,
        }}
      >
        {bot
          ? `Everything ${bot.name} has made or attached lives here.`
          : "Open a Bot to see its files."}
      </Text>
      {history.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back one folder"
          onPress={goBack}
          style={{ alignSelf: "flex-start", paddingVertical: 6 }}
        >
          <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>
            ‹ {currentPath || "Workspace"}
          </Text>
        </Pressable>
      ) : null}
      {browseFiles.isPending ? (
        <Text style={{ color: colors.textFaint, fontSize: 13, marginTop: 8 }}>
          Opening files…
        </Text>
      ) : null}
      {browseFiles.isError ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={{ color: colors.coral, fontSize: 13 }}>
            Rook could not open these files.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading files again"
            onPress={() => void browseFiles.refetch()}
          >
            <Text
              style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}
            >
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}
      {browseFiles.data ? (
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 6 }}>
            {entries.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={`Open ${entry.name}`}
                onPress={() =>
                  entry.type === "dir"
                    ? openPath(entry.path)
                    : setOpenedPath(entry.path)
                }
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 46,
                    borderRadius: 13,
                    borderWidth: 1,
                    borderColor: colors.line,
                    paddingHorizontal: 12,
                    backgroundColor: colors.surfaceAlt,
                  },
                  pressed && { opacity: 0.72 },
                ]}
              >
                <MaterialIcons
                  name={entry.type === "dir" ? "folder" : "description"}
                  size={17}
                  color={colors.textSoft}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.text,
                    fontSize: 13.5,
                    fontWeight: "600",
                    flex: 1,
                  }}
                >
                  {entry.name}
                </Text>
                <MaterialIcons
                  name="chevron-right"
                  size={17}
                  color={colors.textFaint}
                />
              </Pressable>
            ))}
            {entries.length === 0 && botFiles.length === 0 ? (
              <Text style={{ color: colors.textFaint, fontSize: 13 }}>
                Nothing here yet — ask {bot?.name ?? "this Bot"} to make
                something.
              </Text>
            ) : null}
            {botFiles.map((file) => (
              <View
                key={file.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 46,
                  borderRadius: 13,
                  borderWidth: 1,
                  borderColor: colors.line,
                  paddingHorizontal: 12,
                }}
              >
                <MaterialIcons
                  name="attach-file"
                  size={16}
                  color={colors.textFaint}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.text,
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    {file.name}
                  </Text>
                  <Text style={{ color: colors.textFaint, fontSize: 11 }}>
                    {file.size} · {file.scope}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          {openedPath ? (
            <View
              style={{
                marginTop: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surfaceAlt,
                padding: 12,
                maxHeight: 280,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontSize: 13,
                  fontWeight: "700",
                  marginBottom: 6,
                }}
              >
                {openedPath}
              </Text>
              {openedFile.isPending ? (
                <Text style={{ color: colors.textFaint, fontSize: 12.5 }}>
                  Opening…
                </Text>
              ) : openedFile.isError ? (
                <Text style={{ color: colors.coral, fontSize: 12.5 }}>
                  Rook could not open this file.
                </Text>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text
                    style={{
                      color: colors.textSoft,
                      fontSize: 12.5,
                      lineHeight: 18,
                    }}
                  >
                    {String(
                      (openedFile.data as { content?: string } | undefined)
                        ?.content ?? "",
                    ).slice(0, 8000)}
                  </Text>
                </ScrollView>
              )}
            </View>
          ) : null}
          {botMessages.filter((message) => message.attachmentName).length >
          0 ? (
            <Text style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 10 }}>
              Attached in chat:{" "}
              {botMessages
                .filter((message) => message.attachmentName)
                .map((message) => message.attachmentName)
                .join(", ")}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

function FileChip({ name }: { name: string }) {
  const { colors } = useRookTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        marginTop: 8,
        backgroundColor: tint(colors.mint, 0.1),
        borderRadius: 9,
        paddingHorizontal: 9,
        paddingVertical: 6,
      }}
    >
      <MaterialIcons name="attach-file" size={13} color={colors.mint} />
      <Text
        numberOfLines={1}
        style={{ color: colors.mint, fontSize: 11.5, fontWeight: "600" }}
      >
        {name}
      </Text>
    </View>
  );
}

function ComposerControl({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: "attach-file" | "add";
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const { colors } = useRookTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? tint(colors.accent, 0.11) : "transparent",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <MaterialIcons
        name={icon}
        size={icon === "add" ? 21 : 19}
        color={active ? colors.accent : colors.textFaint}
      />
      {active ? (
        <View
          style={{
            position: "absolute",
            right: 4,
            top: 4,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.mint,
          }}
        />
      ) : null}
    </Pressable>
  );
}

function formatRecordingTime(durationMillis: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function audioToBase64(uri: string): Promise<string> {
  if (Platform.OS !== "web") {
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Rook could not read the recorded audio.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Builds a one-line human summary from a computer command execution result. */
function summarizeComputerResult(executed: {
  ok: boolean;
  result?: unknown;
  message?: string;
}): string {
  const outer = executed.result as
    | { ok?: boolean; result?: unknown; message?: string | null }
    | null
    | undefined;
  // Stored results nest the action result under `result`; accept either shape.
  const result =
    outer && typeof outer === "object" && "result" in outer && outer.result !== null
      ? (outer.result as Record<string, unknown>)
      : (outer as Record<string, unknown> | null | undefined);
  if (result && typeof result === "object") {
    if ("exitCode" in result || result.type === "runResult")
      return `exit ${String(result.exitCode ?? "?")}${
        typeof result.stdout === "string" && result.stdout.trim()
          ? ` — ${result.stdout.trim().split("\n")[0].slice(0, 160)}`
          : ""
      }`;
    if ("content" in result) return String(result.content ?? "").slice(0, 200);
    if (result.type === "fileWritten" || "written" in result)
      return `wrote ${String(result.path ?? result.written ?? "")}`;
    if ("entries" in result)
      return `listed ${Array.isArray(result.entries) ? result.entries.length : 0} entries`;
  }
  return executed.message ?? "the command finished";
}
