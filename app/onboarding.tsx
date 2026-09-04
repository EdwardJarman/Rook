import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import {
  BotIdentityPicker,
  DEFAULT_BOT_COLOR,
  DEFAULT_BOT_ICON,
} from "@/components/bot-identity-picker";
import { BotOrb } from "@/components/bot-orb";
import { RookLogo } from "@/components/rook-logo";
import { ScreenContainer } from "@/components/screen-container";
import { useBotDrag } from "@/lib/bot-drag";
import {
  ONBOARDING_BOT_TEMPLATES,
  ONBOARDING_FOCUS_OPTIONS,
  recommendedOnboardingTemplate,
  type OnboardingBotTemplate,
  type OnboardingFocusId,
} from "@/lib/onboarding";
import { useRookNotifications } from "@/lib/rook-notifications";
import { tint, useRookTheme } from "@/lib/ui";
import { useWorkroom } from "@/lib/workroom-store";

const TOOL_OPTIONS = [
  { id: "gmail", label: "Gmail", icon: "mail-outline" as const },
  { id: "calendar", label: "Calendar", icon: "calendar-month" as const },
  { id: "slack", label: "Slack", icon: "forum" as const },
  { id: "notion", label: "Notion", icon: "description" as const },
  { id: "github", label: "GitHub", icon: "code" as const },
  { id: "drive", label: "Drive", icon: "folder-open" as const },
] as const;

const TOTAL_STEPS = 6;
const DEFAULT_APPROVAL =
  "Ask before contacting anyone, changing a live system, spending money, or making an irreversible decision.";

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors, dark } = useRookTheme();
  const { createBot, addMessage } = useWorkroom();
  const { addBotToChat } = useBotDrag();
  const { enableAlerts, status: notificationStatus } = useRookNotifications();
  const [step, setStep] = useState(0);
  const [focuses, setFocuses] = useState<OnboardingFocusId[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<OnboardingBotTemplate["id"]>("atlas");
  const [name, setName] = useState("Atlas");
  const [role, setRole] = useState("Chief of staff");
  const [purpose, setPurpose] = useState(ONBOARDING_BOT_TEMPLATES[0].purpose);
  const [approvalRule, setApprovalRule] = useState(
    ONBOARDING_BOT_TEMPLATES[0].approvalRule,
  );
  const [firstHandoff, setFirstHandoff] = useState("");
  const [color, setColor] = useState(DEFAULT_BOT_COLOR);
  const [icon, setIcon] = useState(DEFAULT_BOT_ICON);
  const [submitting, setSubmitting] = useState(false);

  const contentWidth = Math.min(width - 36, 620);
  const isCompact = width < 520;
  const selectedTemplate =
    ONBOARDING_BOT_TEMPLATES.find(
      (template) => template.id === selectedTemplateId,
    ) ?? ONBOARDING_BOT_TEMPLATES[0];

  const canContinue =
    step === 1
      ? focuses.length > 0
      : step === 4
        ? Boolean(name.trim() && role.trim() && purpose.trim())
        : true;

  const toggleFocus = (id: OnboardingFocusId) => {
    setFocuses((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const toggleTool = (id: string) => {
    setTools((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const applyTemplate = (template: OnboardingBotTemplate) => {
    setSelectedTemplateId(template.id);
    setName(template.name);
    setRole(template.role);
    setPurpose(template.purpose);
    setApprovalRule(template.approvalRule);
    setColor(template.color);
    setIcon(template.icon);
  };

  const next = () => {
    if (!canContinue) return;
    if (step === 1) {
      const recommendation = recommendedOnboardingTemplate(focuses);
      applyTemplate(recommendation);
    }
    setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
  };

  const startFromScratch = () => {
    setName("");
    setRole("");
    setPurpose("");
    setApprovalRule(DEFAULT_APPROVAL);
    setColor(DEFAULT_BOT_COLOR);
    setIcon(DEFAULT_BOT_ICON);
    setStep(4);
  };

  const finish = async (requestNotifications: boolean) => {
    if (submitting || !name.trim() || !role.trim() || !purpose.trim()) return;
    setSubmitting(true);
    if (requestNotifications && Platform.OS !== "web") {
      await enableAlerts().catch(() => undefined);
    }

    const focusLabels = ONBOARDING_FOCUS_OPTIONS.filter((item) =>
      focuses.includes(item.id),
    ).map((item) => item.label);
    const toolLabels = TOOL_OPTIONS.filter((item) =>
      tools.includes(item.id),
    ).map((item) => item.label);
    const memoryParts = [
      focusLabels.length
        ? `Primary work lanes: ${focusLabels.join(", ")}.`
        : "",
      toolLabels.length ? `Common tools: ${toolLabels.join(", ")}.` : "",
    ].filter(Boolean);

    const bot = createBot({
      name: name.trim(),
      role: role.trim(),
      purpose: purpose.trim(),
      approvalRule: approvalRule.trim() || DEFAULT_APPROVAL,
      color,
      icon,
      memory: memoryParts.join(" ") || "No preferences saved yet.",
    });
    addBotToChat(bot.id);
    addMessage({
      botId: bot.id,
      author: "bot",
      body: `I’m ${bot.name}. I’ll keep ${bot.role.toLowerCase()} work moving and bring you in before anything sensitive.`,
      kind: "message",
    });
    if (firstHandoff.trim()) {
      addMessage({
        botId: bot.id,
        author: "user",
        body: firstHandoff.trim(),
        kind: "message",
      });
      addMessage({
        botId: bot.id,
        author: "bot",
        body: "I’ve got it. I’ll begin with a clear plan, show my work, and ask when your judgment is needed.",
        kind: "message",
      });
    }
    router.replace("/(tabs)");
  };

  const footer = (() => {
    if (step === 0) {
      return <PrimaryAction label="Meet your first Bot" onPress={next} />;
    }
    if (step === 1) {
      return (
        <PrimaryAction
          label={
            focuses.length
              ? `Continue with ${focuses.length} selected`
              : "Choose at least one"
          }
          onPress={next}
          disabled={!canContinue}
        />
      );
    }
    if (step === 2) {
      return <PrimaryAction label="Continue" onPress={next} />;
    }
    if (step === 3) {
      return (
        <View style={styles.footerActions}>
          <PrimaryAction
            label={`Continue with ${selectedTemplate.name}`}
            onPress={next}
          />
          <Pressable
            accessibilityRole="button"
            onPress={startFromScratch}
            style={styles.textAction}
          >
            <Text style={[styles.textActionLabel, { color: colors.textSoft }]}>
              Create my own
            </Text>
          </Pressable>
        </View>
      );
    }
    if (step === 4) {
      return (
        <PrimaryAction
          label="Continue"
          onPress={next}
          disabled={!canContinue}
        />
      );
    }
    const canRequestNotifications =
      Platform.OS !== "web" && notificationStatus !== "Enabled";
    return (
      <View style={styles.footerActions}>
        <PrimaryAction
          label={
            submitting
              ? "Preparing your workroom…"
              : canRequestNotifications
                ? "Enable alerts & start"
                : `Start with ${name.trim()}`
          }
          onPress={() => void finish(canRequestNotifications)}
          disabled={submitting}
          loading={submitting}
        />
        {canRequestNotifications ? (
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void finish(false)}
            style={styles.textAction}
          >
            <Text style={[styles.textActionLabel, { color: colors.textSoft }]}>
              Not now
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  })();

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <View style={[styles.frame, { width: contentWidth }]}>
          <View style={styles.header}>
            {step > 0 ? (
              <CircleButton
                icon="arrow-back"
                label="Go back"
                onPress={() => setStep((current) => current - 1)}
              />
            ) : (
              <View
                style={[
                  styles.brandPill,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.line,
                  },
                ]}
              >
                <RookLogo size={27} />
                <Text style={[styles.brandName, { color: colors.text }]}>
                  Rook
                </Text>
              </View>
            )}
            <View
              style={[
                styles.stepPill,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.line,
                },
              ]}
            >
              <Text style={[styles.stepPillText, { color: colors.textSoft }]}>
                {step + 1} / {TOTAL_STEPS}
              </Text>
            </View>
          </View>

          <View style={styles.body}>
            {step === 0 ? (
              <IntroStep colors={colors} />
            ) : step === 1 ? (
              <FocusStep
                focuses={focuses}
                toggleFocus={toggleFocus}
                compact={isCompact}
                colors={colors}
                dark={dark}
              />
            ) : step === 2 ? (
              <ToolsStep
                selected={tools}
                toggle={toggleTool}
                compact={isCompact}
                colors={colors}
                dark={dark}
              />
            ) : step === 3 ? (
              <TemplateStep
                selectedId={selectedTemplateId}
                select={applyTemplate}
                contentWidth={contentWidth}
                colors={colors}
                dark={dark}
              />
            ) : step === 4 ? (
              <CustomizeStep
                name={name}
                role={role}
                purpose={purpose}
                firstHandoff={firstHandoff}
                color={color}
                icon={icon}
                setName={setName}
                setRole={setRole}
                setPurpose={setPurpose}
                setFirstHandoff={setFirstHandoff}
                setColor={setColor}
                setIcon={setIcon}
                colors={colors}
                dark={dark}
              />
            ) : (
              <NotificationsStep
                botName={name.trim() || "your Bot"}
                color={color}
                icon={icon}
                colors={colors}
                dark={dark}
              />
            )}
          </View>

          <View style={styles.footer}>
            <View
              style={styles.dots}
              accessibilityLabel={`Step ${step + 1} of ${TOTAL_STEPS}`}
            >
              {Array.from({ length: TOTAL_STEPS }, (_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    {
                      width: index === step ? 18 : 5,
                      backgroundColor:
                        index === step ? colors.text : colors.lineStrong,
                    },
                  ]}
                />
              ))}
            </View>
            {footer}
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

function IntroStep({
  colors,
}: {
  colors: ReturnType<typeof useRookTheme>["colors"];
}) {
  return (
    <View style={styles.heroStep}>
      <View style={styles.introCopy}>
        <Text style={[styles.kicker, { color: colors.accent }]}>
          YOUR FIRST TEAMMATE
        </Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>
          Bring one real job. Rook will help shape the Bot.
        </Text>
        <Text style={[styles.heroDetail, { color: colors.textSoft }]}>
          Start narrow, keep decisions visible, and expand your team only when
          another lane earns it.
        </Text>
      </View>
      <View style={styles.orbStage}>
        <BotOrb color="#111318" material="matte" size={188} interactive blink />
      </View>
      <View style={[styles.promiseRow, { borderColor: colors.line }]}>
        <Promise icon="visibility" label="Work stays visible" colors={colors} />
        <Promise
          icon="front-hand"
          label="You set the pause points"
          colors={colors}
        />
        <Promise icon="forum" label="Message it naturally" colors={colors} />
      </View>
    </View>
  );
}

function Promise({
  icon,
  label,
  colors,
}: {
  icon: "visibility" | "front-hand" | "forum";
  label: string;
  colors: ReturnType<typeof useRookTheme>["colors"];
}) {
  return (
    <View style={styles.promise}>
      <MaterialIcons name={icon} size={18} color={colors.text} />
      <Text style={[styles.promiseText, { color: colors.textSoft }]}>
        {label}
      </Text>
    </View>
  );
}

function FocusStep({
  focuses,
  toggleFocus,
  compact,
  colors,
  dark,
}: {
  focuses: OnboardingFocusId[];
  toggleFocus: (id: OnboardingFocusId) => void;
  compact: boolean;
  colors: ReturnType<typeof useRookTheme>["colors"];
  dark: boolean;
}) {
  return (
    <View style={styles.contentStep}>
      <StepHeading
        title="What should feel lighter first?"
        detail="Pick one or two lanes. We’ll recommend a first teammate, not build an army."
        colors={colors}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollPad}
      >
        <View style={styles.choiceGrid}>
          {ONBOARDING_FOCUS_OPTIONS.map((option) => {
            const selected = focuses.includes(option.id);
            return (
              <Pressable
                key={option.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggleFocus(option.id)}
                style={({ pressed }) => [
                  styles.focusCard,
                  compact ? styles.focusCardCompact : styles.focusCardWide,
                  {
                    backgroundColor: selected
                      ? tint(colors.accent, dark ? 0.18 : 0.08)
                      : colors.surface,
                    borderColor: selected ? colors.accent : colors.line,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.choiceIcon,
                    {
                      backgroundColor: selected
                        ? colors.accent
                        : colors.surfaceAlt,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={option.icon}
                    size={21}
                    color={selected ? colors.onInk : colors.text}
                  />
                </View>
                <View style={styles.choiceCopy}>
                  <Text style={[styles.choiceTitle, { color: colors.text }]}>
                    {option.label}
                  </Text>
                  <Text
                    style={[styles.choiceDetail, { color: colors.textSoft }]}
                  >
                    {option.detail}
                  </Text>
                </View>
                <MaterialIcons
                  name={selected ? "check-circle" : "radio-button-unchecked"}
                  size={20}
                  color={selected ? colors.accent : colors.lineStrong}
                />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function ToolsStep({
  selected,
  toggle,
  compact,
  colors,
  dark,
}: {
  selected: string[];
  toggle: (id: string) => void;
  compact: boolean;
  colors: ReturnType<typeof useRookTheme>["colors"];
  dark: boolean;
}) {
  return (
    <View style={styles.contentStep}>
      <StepHeading
        title="Where does your work live?"
        detail="Choose what you use most. Nothing connects yet—we’ll use this only to tailor your Bot."
        colors={colors}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollPad}
      >
        <View style={styles.toolGrid}>
          {TOOL_OPTIONS.map((tool) => {
            const active = selected.includes(tool.id);
            return (
              <Pressable
                key={tool.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                onPress={() => toggle(tool.id)}
                style={({ pressed }) => [
                  styles.toolCard,
                  {
                    width: compact ? "47.5%" : "31.5%",
                    backgroundColor: active
                      ? tint(colors.accent, dark ? 0.18 : 0.07)
                      : colors.surface,
                    borderColor: active ? colors.accent : colors.line,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.toolIcon,
                    {
                      backgroundColor: active
                        ? colors.accent
                        : colors.surfaceAlt,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={tool.icon}
                    size={24}
                    color={active ? colors.onInk : colors.text}
                  />
                </View>
                <Text style={[styles.toolLabel, { color: colors.text }]}>
                  {tool.label}
                </Text>
                {active ? (
                  <MaterialIcons
                    name="check-circle"
                    size={18}
                    color={colors.accent}
                    style={styles.toolCheck}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.quietNote, { color: colors.textFaint }]}>
          Skip any service you do not want Rook to remember.
        </Text>
      </ScrollView>
    </View>
  );
}

function TemplateStep({
  selectedId,
  select,
  contentWidth,
  colors,
  dark,
}: {
  selectedId: OnboardingBotTemplate["id"];
  select: (template: OnboardingBotTemplate) => void;
  contentWidth: number;
  colors: ReturnType<typeof useRookTheme>["colors"];
  dark: boolean;
}) {
  const cardWidth = Math.min(contentWidth - 22, 420);
  return (
    <View style={styles.contentStep}>
      <StepHeading
        title="Meet your first Bot"
        detail="Choose a strong starting point. Every detail stays editable."
        colors={colors}
        centered
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + 12}
        decelerationRate="fast"
        contentContainerStyle={styles.templateRail}
      >
        {ONBOARDING_BOT_TEMPLATES.map((template) => {
          const active = selectedId === template.id;
          return (
            <Pressable
              key={template.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => select(template)}
              style={({ pressed }) => [
                styles.templateCard,
                {
                  width: cardWidth,
                  backgroundColor: colors.surface,
                  borderColor: active ? template.color : colors.line,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.recommendedPill,
                  {
                    backgroundColor: active
                      ? tint(template.color, dark ? 0.23 : 0.1)
                      : colors.surfaceAlt,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.recommendedText,
                    { color: active ? template.color : colors.textFaint },
                  ]}
                >
                  {active ? "SELECTED" : "TAP TO CHOOSE"}
                </Text>
              </View>
              <BotOrb
                color={template.color}
                material={
                  template.icon.includes("iridescent") ? "iridescent" : "matte"
                }
                size={174}
                interactive
                blink={active}
              />
              <Text style={[styles.templateName, { color: colors.text }]}>
                {template.name}
              </Text>
              <Text style={[styles.templateRole, { color: template.color }]}>
                {template.role}
              </Text>
              <Text style={[styles.templateDetail, { color: colors.textSoft }]}>
                {template.detail}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CustomizeStep({
  name,
  role,
  purpose,
  firstHandoff,
  color,
  icon,
  setName,
  setRole,
  setPurpose,
  setFirstHandoff,
  setColor,
  setIcon,
  colors,
  dark,
}: {
  name: string;
  role: string;
  purpose: string;
  firstHandoff: string;
  color: string;
  icon: string;
  setName: (value: string) => void;
  setRole: (value: string) => void;
  setPurpose: (value: string) => void;
  setFirstHandoff: (value: string) => void;
  setColor: (value: string) => void;
  setIcon: (value: string) => void;
  colors: ReturnType<typeof useRookTheme>["colors"];
  dark: boolean;
}) {
  const inputStyle = {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    color: colors.text,
  };
  return (
    <View style={styles.contentStep}>
      <StepHeading
        title="Make the teammate yours"
        detail="A clear job description matters more than a clever name."
        colors={colors}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.customScroll}
      >
        <BotIdentityPicker
          color={color}
          icon={icon}
          onColorChange={setColor}
          onIconChange={setIcon}
        />
        <OnboardingField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Atlas, Scout, Ledger…"
          style={inputStyle}
        />
        <OnboardingField
          label="Role"
          value={role}
          onChangeText={setRole}
          placeholder="Research partner"
          style={inputStyle}
        />
        <OnboardingField
          label="What it owns"
          value={purpose}
          onChangeText={setPurpose}
          placeholder="What should this Bot reliably take off your plate?"
          style={inputStyle}
          multiline
        />
        <OnboardingField
          label="First thing to hand off · optional"
          value={firstHandoff}
          onChangeText={setFirstHandoff}
          placeholder="Prepare a plan for…"
          style={inputStyle}
          multiline
        />
        <View
          style={[
            styles.boundaryNote,
            {
              backgroundColor: tint(color, dark ? 0.16 : 0.07),
              borderColor: tint(color, dark ? 0.32 : 0.2),
            },
          ]}
        >
          <MaterialIcons name="front-hand" size={19} color={color} />
          <Text style={[styles.boundaryText, { color: colors.textSoft }]}>
            Rook will pause before external, irreversible, sensitive, or costly
            actions.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function NotificationsStep({
  botName,
  color,
  icon,
  colors,
  dark,
}: {
  botName: string;
  color: string;
  icon: string;
  colors: ReturnType<typeof useRookTheme>["colors"];
  dark: boolean;
}) {
  const unavailable = Platform.OS === "web";
  return (
    <View style={styles.notificationStep}>
      <View style={styles.notificationCopy}>
        <Text style={[styles.kicker, { color }]}>ONE LAST CHOICE</Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>
          {unavailable
            ? `${botName} is ready.`
            : "Know when your Bot needs you."}
        </Text>
        <Text style={[styles.heroDetail, { color: colors.textSoft }]}>
          {unavailable
            ? "Browser alerts can be configured later. Your first teammate and workroom are ready now."
            : "Rook only alerts you for completed work and decisions that genuinely need your approval."}
        </Text>
      </View>
      <View style={styles.notificationVisual}>
        <View
          style={[
            styles.notificationTile,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        >
          <BotOrb
            color={color}
            material={icon.includes("iridescent") ? "iridescent" : "matte"}
            size={112}
            interactive
            blink
          />
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.coral, borderColor: colors.canvas },
            ]}
          >
            <Text style={styles.badgeText}>1</Text>
          </View>
        </View>
      </View>
      <View
        style={[
          styles.alertExamples,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
        ]}
      >
        <AlertExample
          icon="check-circle"
          title="Work completed"
          detail={`${botName} finished a task and returned the result.`}
          colors={colors}
        />
        <View style={[styles.alertDivider, { backgroundColor: colors.line }]} />
        <AlertExample
          icon="approval"
          title="Your decision is needed"
          detail="A sensitive action is waiting—not happening silently."
          colors={colors}
        />
      </View>
    </View>
  );
}

function AlertExample({
  icon,
  title,
  detail,
  colors,
}: {
  icon: "check-circle" | "approval";
  title: string;
  detail: string;
  colors: ReturnType<typeof useRookTheme>["colors"];
}) {
  return (
    <View style={styles.alertExample}>
      <MaterialIcons name={icon} size={21} color={colors.text} />
      <View style={styles.alertCopy}>
        <Text style={[styles.alertTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.alertDetail, { color: colors.textSoft }]}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

function StepHeading({
  title,
  detail,
  colors,
  centered = false,
}: {
  title: string;
  detail: string;
  colors: ReturnType<typeof useRookTheme>["colors"];
  centered?: boolean;
}) {
  return (
    <View style={[styles.stepHeading, centered && styles.centered]}>
      <Text
        style={[
          styles.stepTitle,
          centered && styles.centered,
          { color: colors.text },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.stepDetail,
          centered && styles.centered,
          { color: colors.textSoft },
        ]}
      >
        {detail}
      </Text>
    </View>
  );
}

function OnboardingField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  style: { backgroundColor: string; borderColor: string; color: string };
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: style.color }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8A9099"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.field, multiline && styles.fieldMultiline, style]}
      />
    </View>
  );
}

function PrimaryAction({
  label,
  onPress,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useRookTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        {
          backgroundColor: disabled ? colors.lineStrong : colors.ink,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={colors.onInk} /> : null}
      <Text style={[styles.primaryActionText, { color: colors.onInk }]}>
        {label}
      </Text>
      {!loading ? (
        <MaterialIcons name="arrow-forward" size={20} color={colors.onInk} />
      ) : null}
    </Pressable>
  );
}

function CircleButton({
  icon,
  label,
  onPress,
}: {
  icon: "arrow-back";
  label: string;
  onPress: () => void;
}) {
  const { colors } = useRookTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.circleButton,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.line,
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <MaterialIcons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center" },
  frame: { flex: 1, paddingHorizontal: 4 },
  header: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandPill: {
    height: 40,
    paddingHorizontal: 11,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  brandName: { fontSize: 14, fontWeight: "700", letterSpacing: -0.2 },
  stepPill: {
    minWidth: 52,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPillText: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.3 },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minHeight: 0 },
  heroStep: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: 28,
    paddingBottom: 16,
  },
  introCopy: { maxWidth: 540 },
  kicker: {
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 1.35,
    marginBottom: 9,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -1.15,
    maxWidth: 560,
  },
  heroDetail: { fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 510 },
  orbStage: {
    flex: 1,
    minHeight: 210,
    alignItems: "center",
    justifyContent: "center",
  },
  promiseRow: {
    borderTopWidth: 1,
    paddingTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  promise: { flex: 1, alignItems: "center", gap: 7 },
  promiseText: {
    fontSize: 10.5,
    lineHeight: 14,
    textAlign: "center",
    maxWidth: 110,
  },
  contentStep: { flex: 1, minHeight: 0, paddingTop: 18 },
  stepHeading: { marginBottom: 20, maxWidth: 540 },
  stepTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.9,
  },
  stepDetail: { fontSize: 13.5, lineHeight: 20, marginTop: 8, maxWidth: 500 },
  centered: { alignSelf: "center", textAlign: "center" },
  scrollPad: { paddingBottom: 18 },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  focusCard: {
    minHeight: 92,
    borderRadius: 20,
    borderWidth: 1,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  focusCardWide: { width: "49%" },
  focusCardCompact: { width: "100%" },
  choiceIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceCopy: { flex: 1 },
  choiceTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  choiceDetail: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  toolGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  toolCard: {
    height: 118,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  toolIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  toolLabel: { fontSize: 12.5, fontWeight: "600" },
  toolCheck: { position: "absolute", right: 9, top: 9 },
  quietNote: { fontSize: 11.5, textAlign: "center", marginTop: 16 },
  templateRail: { paddingHorizontal: 2, paddingBottom: 12, gap: 12 },
  templateCard: {
    minHeight: 400,
    borderRadius: 30,
    borderWidth: 1.5,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendedPill: {
    position: "absolute",
    top: 16,
    right: 16,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  recommendedText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.9 },
  templateName: {
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.7,
    marginTop: 9,
  },
  templateRole: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.75,
    textTransform: "uppercase",
    marginTop: 4,
  },
  templateDetail: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 315,
    marginTop: 10,
  },
  customScroll: { paddingBottom: 22, gap: 13 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 11.5, fontWeight: "700" },
  field: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  fieldMultiline: { minHeight: 88, paddingTop: 13, paddingBottom: 13 },
  boundaryNote: {
    minHeight: 58,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
  },
  boundaryText: { flex: 1, fontSize: 11.5, lineHeight: 17 },
  notificationStep: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: 28,
    paddingBottom: 12,
  },
  notificationCopy: { maxWidth: 540 },
  notificationVisual: {
    flex: 1,
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationTile: {
    width: 174,
    height: 174,
    borderRadius: 45,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -8,
    top: -7,
    minWidth: 42,
    height: 42,
    paddingHorizontal: 8,
    borderRadius: 21,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  alertExamples: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 14 },
  alertExample: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  alertCopy: { flex: 1 },
  alertTitle: { fontSize: 12.5, fontWeight: "700" },
  alertDetail: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  alertDivider: { height: 1 },
  footer: { paddingTop: 10, paddingBottom: Platform.OS === "web" ? 16 : 8 },
  dots: {
    height: 24,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
  },
  dot: { height: 5, borderRadius: 99 },
  footerActions: { gap: 2 },
  primaryAction: {
    height: 56,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryActionText: { fontSize: 15, fontWeight: "700", letterSpacing: -0.15 },
  textAction: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  textActionLabel: { fontSize: 13, fontWeight: "600" },
});
