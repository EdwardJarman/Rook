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
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BotCreateSheet } from "@/components/bot-create-sheet";
import { AiWorkingIndicator } from "@/components/ai-working-indicator";
import { ComposerConnectorsSheet } from "@/components/composer-connectors-sheet";
import { ComposerModelPicker } from "@/components/composer-model-picker";
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
import { parseChatMarkdown, type ChatMarkdownInline } from "@/lib/chat-markdown";
import { splitMathNotation } from "@/lib/math-notation";
import { approvalReason, fileSizeLabel, requiresApproval } from "@/lib/workroom-helpers";
import { useWorkroom, type Bot } from "@/lib/workroom-store";

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
  const { colors } = useRookTheme();
  const workroom = useWorkroom();
  const { bots, messages, approvals } = workroom;
  const { ready: roomReady, chatBotIds, activeChatBotId, focusChatBot, addBotToChat, removeBotFromChat, draggingBot, dropActive, setDropActive } = useBotDrag();
  const [composer, setComposer] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [excelAttached, setExcelAttached] = useState(false);
  const replyMutation = trpc.workroom.reply.useMutation();
  const voiceMutation = trpc.voice.transcribe.useMutation();
  const modelCatalog = trpc.ai.models.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: 1 });
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const { preferences: notificationPreferences, sendTaskAlert } = useRookNotifications();
  const threadRef = useRef<ScrollView>(null);

  const chatBots = useMemo(() => bots.filter((bot) => chatBotIds.includes(bot.id)), [bots, chatBotIds]);
  const activeBot = useMemo(
    () => chatBots.find((bot) => bot.id === activeChatBotId) ?? chatBots[0] ?? null,
    [activeChatBotId, chatBots],
  );
  const activeProvider = useMemo(
    () => providerForModel(activeBot?.model, workroom.aiProvider),
    [activeBot?.model, workroom.aiProvider],
  );
  const resolvedModel = useMemo(() => {
    if (!activeBot) return undefined;
    const models = modelCatalog.data?.models ?? [];
    const canonical = canonicalModelForProvider(activeBot.model, activeProvider);
    const selected = models.find((model) => model.id === canonical && modelMatchesProvider(model.id, activeProvider));
    if (selected) return selected;
    return defaultModelForProvider(models, activeProvider) ??
      (activeProvider === "openrouter" ? { id: "openrouter/free" } : undefined);
  }, [activeBot, activeProvider, modelCatalog.data?.models]);

  /* The whole room reads as one conversation: every message from a Bot that is present. */
  const visibleMessages = useMemo(
    () => messages.filter((message) => chatBotIds.includes(message.botId)),
    [chatBotIds, messages],
  );
  const pendingApproval = activeBot
    ? approvals.find((approval) => approval.botId === activeBot.id && approval.state === "Pending")
    : undefined;
  const pendingCount = approvals.filter((approval) => approval.state === "Pending").length;

  /* Keep the newest message in view as the thread grows. */
  useEffect(() => {
    if (visibleMessages.length > 0) threadRef.current?.scrollToEnd({ animated: true });
  }, [visibleMessages.length]);

  const handleSend = async () => {
    const clean = composer.trim();
    if (!clean || !activeBot) return;
    if (!resolvedModel) {
      Alert.alert(
        "No model available",
        activeProvider === "chatgpt"
          ? "Reconnect ChatGPT or switch to OpenRouter from Account."
          : `Rook could not load a ${providerLabel(activeProvider)} model. Check its connection or switch providers from Account.`,
      );
      return;
    }
    const requiresReview = requiresApproval(clean);
    const task = workroom.addTask({
      botId: activeBot.id,
      title: clean.length > 52 ? `${clean.slice(0, 52)}…` : clean,
      status: requiresReview ? "Approval required" : "Planning",
      summary: requiresReview
        ? "Waiting for your decision before any sensitive step."
        : "Preparing a focused response from your instructions.",
      nextAction: requiresReview ? "Review the proposed action." : "Review the result and decide what happens next.",
      risk: requiresReview ? "Medium" : "Low",
      steps: [
        { id: "scope", label: "Understand the result you want", state: "active" },
        { id: "work", label: "Do the safe work", state: "pending" },
        { id: "return", label: "Return the result", state: "pending" },
      ],
    });
    workroom.addMessage({ botId: activeBot.id, author: "user", body: clean });
    setComposer("");
    if (requiresReview) {
      workroom.addApproval({ botId: activeBot.id, title: task.title, detail: approvalReason(clean), risk: "Medium" });
      void sendTaskAlert({
        kind: "approval",
        title: "Approval needed in Rook",
        body: `${activeBot.name} needs your decision`,
        url: "/activity",
      });
      workroom.addMessage({
        botId: activeBot.id,
        author: "bot",
        body: `I can prepare the work, but I need your approval before this step. ${approvalReason(clean)}`,
        kind: "approval",
        taskId: task.id,
      });
      return;
    }
    workroom.updateBotStatus(activeBot.id, "Working");
    try {
      workroom.updateTaskStatus(task.id, "Working", "Finishing the requested work.");
      const response = await replyMutation.mutateAsync({
        botId: activeBot.id,
        taskId: task.id,
        botName: activeBot.name,
        botRole: activeBot.role,
        botPurpose: activeBot.purpose,
        model: resolvedModel.id,
        message: clean,
        userTimeZone: deviceTimeZone(),
        connectors: excelAttached ? ["microsoft-excel"] : [],
        recentContext: visibleMessages.slice(-6).map((message) => ({ author: message.author, body: message.body })),
      });
      setExcelAttached(false);
      if (response.approvals.length) {
        workroom.updateTaskStatus(task.id, "Approval required", "Review the exact Excel change in Updates.");
        response.approvals.forEach((approval) => workroom.addApproval({
          botId: activeBot.id,
          taskId: task.id,
          externalActionId: approval.actionId,
          title: approval.title,
          detail: approval.detail,
          risk: approval.risk,
        }));
        if (!response.pushDelivery.accepted)
          void sendTaskAlert({
            kind: "approval",
            title: "Excel change needs approval",
            body: `${activeBot.name} prepared a workbook change`,
            url: "/activity",
          });
      } else {
        workroom.updateTaskStatus(task.id, "Completed", "Result returned. You can refine or start a new task.");
      }
      workroom.updateBotStatus(activeBot.id, "Ready");
      workroom.addMessage({
        botId: activeBot.id,
        author: "bot",
        body: response.text,
        kind: response.approvals.length ? "approval" : "message",
        taskId: task.id,
      });
      if (!response.approvals.length && notificationPreferences.completion && !response.pushDelivery.accepted)
        void sendTaskAlert({
          kind: "completion",
          title: `${activeBot.name} completed a task`,
          body: response.text.slice(0, 170),
          url: "/",
        });
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "Free AI capacity is unavailable right now. Please try again shortly.";
      workroom.updateTaskStatus(task.id, "Partially completed", message);
      workroom.updateBotStatus(activeBot.id, "Ready");
      workroom.addMessage({
        botId: activeBot.id,
        author: "bot",
        body: `${message} Nothing external was attempted.`,
        taskId: task.id,
      });
    }
  };

  const handleAttach = async () => {
    if (!activeBot) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true, type: "*/*" });
      if (result.canceled) return;
      const asset = result.assets[0];
      workroom.addFile({ name: asset.name, size: fileSizeLabel(asset.size), scope: "Bot-private", owner: activeBot.name });
      workroom.addMessage({
        botId: activeBot.id,
        author: "system",
        body: `Attached ${asset.name}. It is available only to ${activeBot.name} in this room.`,
        kind: "activity",
        attachmentName: asset.name,
      });
    } catch {
      Alert.alert("File attachment unavailable", "Rook could not attach this file. Please try again from the device file picker.");
    }
  };

  const handleVoice = async () => {
    if (voiceMutation.isPending) return;
    if (recorderState.isRecording) {
      try {
        await audioRecorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = audioRecorder.uri;
        if (!uri) throw new Error("The recording file was not created.");
        const data = await audioToBase64(uri);
        if (data.length > 12_000_000) throw new Error("That voice note is too long. Keep recordings under one minute.");
        const result = await voiceMutation.mutateAsync({
          data,
          format: Platform.OS === "web" ? "webm" : "m4a",
        });
        setComposer((current) => [current.trim(), result.text.trim()].filter(Boolean).join(current.trim() ? " " : ""));
      } catch (error) {
        Alert.alert("Voice input unavailable", error instanceof Error ? error.message : "Rook could not transcribe that recording.");
      }
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone permission needed", "Allow microphone access to dictate a message to Rook.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch {
      Alert.alert("Microphone unavailable", "Rook could not start recording on this device.");
    }
  };

  const canSend = Boolean(composer.trim()) && !recorderState.isRecording && !replyMutation.isPending && !voiceMutation.isPending;
  const roomHasBots = chatBots.length > 0;
  const isPhoneExperience = Platform.OS !== "web";
  const stageDropProps = botDropTargetProps({
    onEnter: () => setDropActive(true),
    onLeave: () => setDropActive(false),
    onDropBot: (botId) => addBotToChat(botId),
  }) as object;

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9, flex: 1, minWidth: 0 }}>
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
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700", letterSpacing: -0.3 }}>Rook</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View>
              <IconButton icon="notifications-none" label="Open updates" onPress={() => router.navigate("/activity" as never)} />
              {pendingCount > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.amber,
                    borderWidth: 1.5,
                    borderColor: colors.canvas,
                  }}
                />
              ) : null}
            </View>
            <IconButton icon="person-outline" label="Open account and connected apps" onPress={() => router.navigate("/account" as never)} />
            <IconButton icon="add" label="Add a Bot" onPress={() => setPickerOpen(true)} tone="accent" />
          </View>
        </View>

        {!roomReady || !workroom.ready ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.textFaint, fontSize: 13 }}>Opening your room…</Text>
          </View>
        ) : !roomHasBots ? (
          /* Empty room. A brand-new account sees a calm first-run invitation;
             a user with Bots but none in the room gets asked to bring one in. */
          bots.length === 0 ? (
            <View
              {...stageDropProps}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30, paddingBottom: 40, backgroundColor: dropActive ? tint(colors.accent, 0.05) : colors.canvas }}
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
              <Text style={{ color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.8, textAlign: "center" }}>
                Start with one good Bot.
              </Text>
              <Text style={{ color: colors.textSoft, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 320, marginTop: 10 }}>
                Give it a name and a job, then bring it into the room and the conversation begins.
              </Text>
              <View style={{ marginTop: 24 }}>
                <PrimaryButton label="Make a Bot" icon="add" onPress={() => setCreateOpen(true)} />
              </View>
              <Text style={{ color: colors.textFaint, fontSize: 12, lineHeight: 17, textAlign: "center", maxWidth: 280, marginTop: 18 }}>
                {isPhoneExperience ? "Use this button whenever you are ready to bring it into the chat." : "Drag it from the sidebar when you are ready, or add it from here."}
              </Text>
            </View>
          ) : (
            <View
              {...stageDropProps}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30, paddingBottom: 40, backgroundColor: dropActive ? tint(colors.accent, 0.05) : colors.canvas }}
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
                <MaterialIcons name="group-add" size={32} color={colors.onInk} />
              </View>
              <Text style={{ color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.8, textAlign: "center" }}>
                Bring a teammate into the room.
              </Text>
              <Text style={{ color: colors.textSoft, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 320, marginTop: 10 }}>
                {isPhoneExperience ? "Use Add a Bot to bring one into this conversation." : "Drag a Bot from the sidebar onto the chat, or add one here and it joins the room."}
              </Text>
              <View style={{ marginTop: 24 }}>
                <PrimaryButton label="Add a Bot" icon="add" onPress={() => setPickerOpen(true)} />
              </View>
              {draggingBot && dropActive ? (
                <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "700", marginTop: 18 }}>Drop to add {draggingBot.name}</Text>
              ) : null}
            </View>
          )
        ) : (
          <>
            {/* The room strip — one mark per Bot in the room. Focus to talk, hover to remove. */}
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
                contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingVertical: 9 }}
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
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.navigate("/activity" as never)}
                    style={({ pressed }) => [
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 11,
                        padding: 14,
                        borderRadius: 16,
                        backgroundColor: colors.amberSoft,
                        borderWidth: 1,
                        borderColor: tint(colors.amber, 0.28),
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
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
                      <MaterialIcons name="shield" size={18} color={colors.amber} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: "600" }}>A decision is waiting</Text>
                      <Text numberOfLines={1} style={{ color: colors.amber, fontSize: 12, marginTop: 2 }}>
                        {pendingApproval.title}
                      </Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={colors.amber} />
                  </Pressable>
                ) : null}

                {visibleMessages.length ? (
                  <View style={{ gap: 14, paddingTop: 2 }}>
                    {visibleMessages.map((message) => {
                      const source = bots.find((bot) => bot.id === message.botId);
                      if (message.author === "system" || message.kind === "activity") {
                        return (
                          <View
                            key={message.id}
                            style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2, maxWidth: "100%" }}
                          >
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textFaint }} />
                            <Text style={{ flex: 1, color: colors.textFaint, fontSize: 11.5, lineHeight: 16 }}>{message.body}</Text>
                          </View>
                        );
                      }
                      if (message.author === "user") {
                        return (
                          <View key={message.id} style={{ alignItems: "flex-end", paddingLeft: 48 }}>
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
                              <Text style={{ color: colors.onInk, fontSize: 15, lineHeight: 21.5 }}>{message.body}</Text>
                              {message.attachmentName ? <FileChip name={message.attachmentName} /> : null}
                            </View>
                            <Text style={{ color: colors.textFaint, fontSize: 10.5, marginTop: 5, marginRight: 4 }}>
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
                            <MaterialIcons name="shield" size={17} color={colors.amber} />
                            <ChatMarkdown text={message.body} color={colors.text} baseSize={13.5} />
                          </View>
                        );
                      }
                      return (
                        <View key={message.id} style={{ flexDirection: "row", gap: 10, paddingRight: 20 }}>
                          <View style={{ width: 28, alignItems: "center" }}>
                            <Avatar label={source?.avatar ?? "?"} color={source?.color} icon={source?.icon} size={28} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <ChatMarkdown text={message.body} color={colors.text} baseSize={15} />
                            {message.attachmentName ? <FileChip name={message.attachmentName} /> : null}
                            <Text style={{ color: colors.textFaint, fontSize: 10.5, marginTop: 5 }}>{message.createdAt}</Text>
                          </View>
                        </View>
                      );
                    })}
                    {replyMutation.isPending && activeBot ? <AiWorkingIndicator bot={activeBot} /> : null}
                  </View>
                ) : (
                  <EmptyState
                    icon="forum"
                    title={`Talk to ${activeBot?.name ?? "your Bot"}`}
                    detail="Describe the outcome you want, the important context, and when this Bot should pause for you."
                  />
                )}
              </ScrollView>

              {/* Drop a Bot anywhere on the stage. */}
              {draggingBot && dropActive ? (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
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
                    <Text style={{ color: colors.onInk, fontSize: 14, fontWeight: "600" }}>Drop to add {draggingBot.name}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Composer — a two-tier rounded pill inspired by the supplied reference. */}
            <View style={{ backgroundColor: colors.canvas, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 }}>
              <View
                style={{
                  borderRadius: 28,
                  borderWidth: 1,
                  borderColor: composerFocused ? tint(colors.accent, 0.35) : colors.line,
                  backgroundColor: colors.surface,
                  paddingHorizontal: 12,
                  paddingTop: 10,
                  paddingBottom: 9,
                  maxWidth: 760,
                  width: "100%",
                  alignSelf: "center",
                  gap: 5,
                }}
              >
                <TextInput
                  nativeID="rook-composer-input"
                  value={composer}
                  onChangeText={setComposer}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  placeholder="Type your message here…"
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

                <View style={{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <ComposerControl icon="attach-file" label="Upload a file" onPress={() => void handleAttach()} />
                    <ComposerControl
                      icon="add"
                      label={excelAttached ? "Microsoft Excel attached. Open connectors" : "Open connectors"}
                      active={excelAttached}
                      onPress={() => setConnectorsOpen(true)}
                    />
                    <ComposerModelPicker
                      value={resolvedModel?.id || activeBot?.model || ""}
                      provider={activeProvider}
                      onChange={(model) => activeBot && workroom.updateBotModel(activeBot.id, model)}
                    />
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={canSend ? "Send message" : recorderState.isRecording ? "Stop recording" : "Record voice message"}
                    onPress={() => canSend ? void handleSend() : void handleVoice()}
                    disabled={replyMutation.isPending || voiceMutation.isPending}
                    style={({ pressed }) => ({
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: canSend ? colors.ink : recorderState.isRecording ? colors.coral : colors.canvas,
                      borderWidth: canSend || recorderState.isRecording ? 0 : 1,
                      borderColor: colors.lineStrong,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: replyMutation.isPending || voiceMutation.isPending ? 0.5 : pressed ? 0.7 : 1,
                    })}
                  >
                    <MaterialIcons
                      name={canSend ? "arrow-upward" : recorderState.isRecording ? "stop" : voiceMutation.isPending ? "more-horiz" : "mic"}
                      size={canSend ? 20 : 21}
                      color={canSend || recorderState.isRecording ? colors.onInk : colors.text}
                    />
                  </Pressable>
                </View>

                {recorderState.isRecording ? (
                  <View style={{ position: "absolute", left: 15, top: 13, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.surface, paddingRight: 8 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.coral }} />
                    <Text style={{ color: colors.coral, fontSize: 11.5, fontWeight: "700" }}>Recording {formatRecordingTime(recorderState.durationMillis)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      {/* Add a Bot — existing teammates, plus a quiet path to make a new one. */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View>
            <SheetEyebrow>Room</SheetEyebrow>
            <Text style={{ color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: "700", letterSpacing: -0.5 }}>
              Add to the chat
            </Text>
          </View>
          <IconButton icon="add" label="Create a Bot" onPress={() => { setPickerOpen(false); setCreateOpen(true); }} tone="accent" />
        </View>
        <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 4, gap: 4 }}>
          {bots.map((bot) => {
            const inRoom = chatBotIds.includes(bot.id);
            return (
              <Pressable
                key={bot.id}
                accessibilityRole="button"
                accessibilityLabel={inRoom ? `${bot.name}, already in the room` : `Add ${bot.name} to the room`}
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
                <Avatar label={bot.avatar} color={bot.color} icon={bot.icon} size={42} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1 }}>
                    {bot.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 12, marginTop: 2 }}>
                    {bot.status === "Working" ? "Working now" : bot.role}
                  </Text>
                </View>
                {inRoom ? (
                  <MaterialIcons name="check" size={19} color={colors.accent} />
                ) : (
                  <MaterialIcons name="add-circle-outline" size={19} color={colors.textFaint} />
                )}
              </Pressable>
            );
          })}
          {bots.length === 0 ? (
            <EmptyState
              icon="smart-toy"
              title="No Bots yet"
              detail="Make your first teammate and it will appear here, ready to be added to the room."
              action={<PrimaryButton label="Make a Bot" icon="add" onPress={() => { setPickerOpen(false); setCreateOpen(true); }} />}
            />
          ) : null}
        </ScrollView>
      </Sheet>

      <ComposerConnectorsSheet
        visible={connectorsOpen}
        onClose={() => setConnectorsOpen(false)}
        onSelectExcel={() => setExcelAttached(true)}
      />

      {/* Create a Bot — shared three-step sheet. */}
      <BotCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(bot) => addBotToChat(bot.id)}
      />

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
        <Avatar label={bot.avatar} color={bot.color} icon={bot.icon} size={40} />
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
          lineHeight: heading ? baseSize + (block.level === 1 ? 10 : 8) : baseSize + 7,
          fontWeight: heading ? "700" as const : "400" as const,
        };
        if (block.type === "bullet" || block.type === "ordered") {
          return (
            <View key={`${block.type}-${index}`} style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}>
              <Text style={[lineStyle, { minWidth: block.type === "ordered" ? 18 : 10 }]}>{block.type === "ordered" ? `${block.ordinal}.` : "•"}</Text>
              <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                {renderInlineMarkdown(block.content, color, lineStyle.fontSize, lineStyle.fontWeight)}
              </View>
            </View>
          );
        }
        return (
          <View key={`${block.type}-${index}`} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
            {renderInlineMarkdown(block.content, color, lineStyle.fontSize, lineStyle.fontWeight)}
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
        return <MathNotation key={key} latex={segment.latex} color={color} fontSize={fontSize} display={segment.display} />;
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
      <Text numberOfLines={1} style={{ color: colors.mint, fontSize: 11.5, fontWeight: "600" }}>{name}</Text>
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
      <MaterialIcons name={icon} size={icon === "add" ? 21 : 19} color={active ? colors.accent : colors.textFaint} />
      {active ? (
        <View style={{ position: "absolute", right: 4, top: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint }} />
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
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Rook could not read the recorded audio.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
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
