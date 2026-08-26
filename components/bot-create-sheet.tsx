import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  BotIdentityPicker,
  DEFAULT_BOT_COLOR,
  DEFAULT_BOT_ICON,
} from "@/components/bot-identity-picker";
import { AiModelSelector } from "@/components/ai-model-selector";
import { BotIdentityMark } from "@/components/bot-orb";
import { GlassSurface } from "@/components/liquid-glass";
import { RookLogo } from "@/components/rook-logo";
import { Field, useRookTheme } from "@/components/rook-primitives";
import {
  defaultModelForProvider,
  providerForModel,
} from "@/lib/ai-provider";
import { trpc } from "@/lib/trpc";
import { tint } from "@/lib/ui";
import { useWorkroom, type Bot } from "@/lib/workroom-store";

const DEFAULT_APPROVAL =
  "Ask me before anything external, irreversible, or sensitive.";

type Step = 1 | 2 | 3;

const STEP_COPY: Record<
  2 | 3,
  { eyebrow: string; title: string; detail: string }
> = {
  2: {
    eyebrow: "Role",
    title: "What should it own?",
    detail:
      "Keep the role narrow. Clear teammates are easier to trust, brief, and delegate to.",
  },
  3: {
    eyebrow: "Boundaries",
    title: "Choose its pause point",
    detail:
      "Tell Rook when this Bot should stop and bring you into the decision.",
  },
};

/**
 * A compact, floating Bot maker. The glass surface preserves context behind the
 * modal while the live geometric identity makes customization immediate.
 */
export function BotCreateSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (bot: Bot) => void;
}) {
  const { colors, dark } = useRookTheme();
  const { aiProvider, createBot } = useWorkroom();
  const modelCatalog = trpc.ai.models.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const { width, height } = useWindowDimensions();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [purpose, setPurpose] = useState("");
  const [approvalRule, setApprovalRule] = useState(DEFAULT_APPROVAL);
  const [color, setColor] = useState(DEFAULT_BOT_COLOR);
  const [icon, setIcon] = useState(DEFAULT_BOT_ICON);
  const [model, setModel] = useState("openrouter/free");

  const compactMobile = Platform.OS !== "web" && width < 600;
  // Keep the native creator as a deliberate floating dialog rather than an
  // almost full-screen panel layered over the tab header.
  const panelWidth = compactMobile
    ? Math.min(Math.max(width - 48, 304), 360)
    : Math.min(Math.max(width - 40, 360), 520);
  const panelHeight = compactMobile
    ? Math.min(Math.max(height - 260, 456), 536)
    : Math.min(height - 72, 600);
  const copy = step === 1 ? null : STEP_COPY[step];
  const suggestedModel = useMemo(() => {
    const models = modelCatalog.data?.models ?? [];
    // A connected ChatGPT 5.5 route wins for new Bots. If it is not offered by
    // this account, preserve the selected Rook provider and its own fallback.
    return models.find((entry) => entry.id === "chatgpt:gpt-5.5") ??
      models.find((entry) => entry.id.startsWith("chatgpt:") && /gpt[- ]?5\.5/i.test(`${entry.id} ${entry.name}`)) ??
      defaultModelForProvider(models, aiProvider) ??
      models.find((entry) => entry.id === "openrouter/free") ??
      models[0];
  }, [aiProvider, modelCatalog.data?.models]);
  const modelProvider = providerForModel(model, aiProvider);

  useEffect(() => {
    if (!visible) return;
    setModel(suggestedModel?.id ?? "openrouter/free");
  }, [suggestedModel?.id, visible]);

  const reset = () => {
    setStep(1);
    setName("");
    setRole("");
    setPurpose("");
    setApprovalRule(DEFAULT_APPROVAL);
    setColor(DEFAULT_BOT_COLOR);
    setIcon(DEFAULT_BOT_ICON);
    setModel("openrouter/free");
  };

  const close = () => {
    reset();
    onClose();
  };

  const continueForward = () => {
    if (step === 1 && !name.trim()) {
      Alert.alert(
        "Name your Bot",
        "Choose a short name that makes this teammate easy to recognize.",
      );
      return;
    }
    if (step === 2 && (!role.trim() || !purpose.trim())) {
      Alert.alert(
        "Describe the work",
        "Add a primary job and a clear description of what this Bot should own.",
      );
      return;
    }
    setStep((step + 1) as Step);
  };

  const handleCreate = () => {
    const bot = createBot({
      name: name.trim(),
      role: role.trim(),
      purpose: purpose.trim(),
      approvalRule: approvalRule.trim() || DEFAULT_APPROVAL,
      color,
      icon,
      model,
    });
    reset();
    onClose();
    onCreated?.(bot);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <Pressable
        accessibilityLabel="Dismiss Bot maker"
        style={[
          styles.scrim,
          { backgroundColor: dark ? "rgba(3, 5, 8, 0.64)" : "rgba(15, 19, 24, 0.32)" },
        ]}
        onPress={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardLayer}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            accessibilityViewIsModal
          >
            <GlassSurface
              radius={28}
              blur={30}
              flat
              style={[
                styles.panel,
                {
                  width: panelWidth,
                  height: panelHeight,
                  ...(compactMobile ? styles.compactPanel : {}),
                },
              ]}
              contentStyle={styles.panelContent}
            >
              <View style={styles.topRow}>
                <View style={styles.identityLabel}>
                  {step === 1 ? (
                    <View
                      style={[styles.mark, { backgroundColor: colors.ink }]}
                    >
                      <RookLogo size={24} color={colors.onInk} />
                    </View>
                  ) : (
                    <BotIdentityMark icon={icon} color={color} size={32} />
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close Bot maker"
                  hitSlop={8}
                  onPress={close}
                  style={({ pressed }) => [
                    styles.closeButton,
                    {
                      backgroundColor: colors.surfaceAlt,
                      opacity: pressed ? 0.58 : 1,
                    },
                  ]}
                >
                  <MaterialIcons
                    name="close"
                    size={18}
                    color={colors.textSoft}
                  />
                </Pressable>
              </View>

              <View
                style={styles.progressRow}
                accessibilityLabel={`Step ${step} of 3`}
              >
                {([1, 2, 3] as Step[]).map((index) => (
                  <View
                    key={index}
                    style={[
                      styles.progressTrack,
                      { backgroundColor: index <= step ? color : colors.line },
                    ]}
                  />
                ))}
              </View>

              <ScrollView
                style={styles.scroller}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                {copy ? (
                  <View style={styles.headingBlock}>
                    <Text style={[styles.eyebrow, { color }]}>
                      {copy.eyebrow} · {step} of 3
                    </Text>
                    <Text style={[styles.title, { color: colors.text }]}>
                      {copy.title}
                    </Text>
                    <Text style={[styles.detail, { color: colors.textSoft }]}>
                      {copy.detail}
                    </Text>
                  </View>
                ) : null}

                {step === 1 ? (
                  <View style={styles.stepContent}>
                    <BotIdentityPicker
                      color={color}
                      icon={icon}
                      onColorChange={setColor}
                      onIconChange={setIcon}
                    />
                    <Field
                      label="Name"
                      value={name}
                      onChangeText={setName}
                      placeholder="Atlas, Ledger, Scout…"
                      autoFocus
                      returnKeyType="next"
                      onSubmitEditing={continueForward}
                      style={{
                        backgroundColor: dark
                          ? "rgba(11, 15, 21, 0.52)"
                          : "rgba(255, 255, 255, 0.52)",
                        borderColor: tint(color, dark ? 0.42 : 0.28),
                      }}
                    />
                  </View>
                ) : null}

                {step === 2 ? (
                  <View style={styles.stepContent}>
                    <Field
                      label="Primary job"
                      value={role}
                      onChangeText={setRole}
                      placeholder="Research analyst"
                      autoFocus
                      style={{
                        backgroundColor: dark
                          ? "rgba(11, 15, 21, 0.52)"
                          : "rgba(255, 255, 255, 0.52)",
                        borderColor: colors.lineStrong,
                      }}
                    />
                    <Field
                      label="What it owns"
                      value={purpose}
                      onChangeText={setPurpose}
                      placeholder="Summarizes sources, flags contradictions, and returns a brief I can act on."
                      multiline
                      style={{
                        minHeight: 112,
                        backgroundColor: dark
                          ? "rgba(11, 15, 21, 0.52)"
                          : "rgba(255, 255, 255, 0.52)",
                        borderColor: colors.lineStrong,
                      }}
                    />
                  </View>
                ) : null}

                {step === 3 ? (
                  <View style={styles.stepContent}>
                    <Field
                      label="Approval boundary"
                      value={approvalRule}
                      onChangeText={setApprovalRule}
                      multiline
                      autoFocus
                      style={{
                        minHeight: 124,
                        backgroundColor: dark
                          ? "rgba(11, 15, 21, 0.52)"
                          : "rgba(255, 255, 255, 0.52)",
                        borderColor: colors.lineStrong,
                      }}
                    />
                    <AiModelSelector value={model} provider={modelProvider} onChange={setModel} />
                    <View
                      style={[
                        styles.summaryCard,
                        {
                          backgroundColor: tint(color, dark ? 0.2 : 0.1),
                          borderColor: tint(color, 0.28),
                        },
                      ]}
                    >
                      <BotIdentityMark icon={icon} color={color} size={38} />
                      <View style={styles.summaryCopy}>
                        <Text
                          style={[styles.summaryTitle, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        <Text
                          style={[
                            styles.summaryDetail,
                            { color: colors.textSoft },
                          ]}
                          numberOfLines={2}
                        >
                          {role}
                        </Text>
                      </View>
                      <MaterialIcons name="verified" size={18} color={color} />
                    </View>
                  </View>
                ) : null}
              </ScrollView>

              <View style={[styles.actions, { borderTopColor: colors.line }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={step > 1 ? "Back" : "Cancel"}
                  onPress={step > 1 ? () => setStep((step - 1) as Step) : close}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    {
                      borderColor: colors.lineStrong,
                      backgroundColor: dark
                        ? "rgba(20,24,32,0.46)"
                        : "rgba(255,255,255,0.42)",
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  {step > 1 ? (
                    <MaterialIcons
                      name="arrow-back"
                      size={17}
                      color={colors.text}
                    />
                  ) : null}
                  <Text style={[styles.secondaryText, { color: colors.text }]}>
                    {step > 1 ? "Back" : "Cancel"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={step < 3 ? "Continue" : "Create Bot"}
                  onPress={step < 3 ? continueForward : handleCreate}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    { backgroundColor: colors.ink },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.primaryText, { color: colors.onInk }]}>
                    {step < 3 ? "Continue" : "Create Bot"}
                  </Text>
                  <MaterialIcons
                    name={step < 3 ? "arrow-forward" : "check"}
                    size={18}
                    color={colors.onInk}
                  />
                </Pressable>
              </View>
            </GlassSurface>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
  },
  keyboardLayer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  panel: {
    overflow: "hidden",
  },
  compactPanel: {
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  panelContent: {
    minHeight: 0,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  identityLabel: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  progressRow: {
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 18,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 99,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
  },
  scroller: {
    flex: 1,
  },
  headingBlock: {
    marginBottom: 16,
  },
  eyebrow: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  title: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "700",
    letterSpacing: -0.65,
  },
  detail: {
    fontSize: 13.5,
    lineHeight: 19.5,
    marginTop: 6,
    maxWidth: 470,
  },
  stepContent: {
    gap: 15,
  },
  summaryCard: {
    minHeight: 66,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  summaryCopy: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
  summaryDetail: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 1,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 16,
  },
  secondaryAction: {
    minHeight: 46,
    minWidth: 94,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primaryAction: {
    minHeight: 46,
    minWidth: 132,
    borderRadius: 16,
    paddingHorizontal: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  primaryText: {
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
});
