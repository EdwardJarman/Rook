import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/rook-primitives";
import type { AgentTraceStep } from "@/shared/agent-trace";
import { formatWorkingElapsed } from "@/lib/ai-working";
import { tint, useRookTheme } from "@/lib/ui";
import type { Bot } from "@/lib/workroom-store";

const iconForStep = (kind: AgentTraceStep["kind"]) => {
  if (kind === "search") return "search";
  if (kind === "source") return "language";
  if (kind === "tool") return "task-alt";
  if (kind === "approval") return "shield";
  if (kind === "context") return "forum";
  return "check-circle-outline";
};

/**
 * Settled agent activity under a reply. Same ThinkingState look as the live
 * indicator (sparkle header, chevron, vertical trace rail) but driven only by
 * real completed steps: searches, sources, concrete tool calls, and failures.
 * Boilerplate rows ("read the room context", "preparing a response", …) are
 * dropped at render so the expander never repeats mock text, and each step's
 * server timestamp renders as a quiet elapsed time.
 */
export function AgentActivityTrace({
  bot,
  trace,
}: {
  bot: Bot;
  trace: AgentTraceStep[];
}) {
  const { colors } = useRookTheme();
  const [expanded, setExpanded] = useState(false);
  const steps = trace.filter((step) => !isBoilerplate(step));
  if (!steps.length) return null;

  const first = steps[0];
  const summary =
    steps.length === 1
      ? first.title
      : `${first.title} · +${steps.length - 1} more`;

  return (
    <View style={{ marginBottom: 9, maxWidth: 520 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} response activity`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => ({
          minHeight: 30,
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 7,
          paddingVertical: 3,
          paddingHorizontal: 6,
          marginHorizontal: -6,
          borderRadius: 8,
          opacity: pressed ? 0.68 : 1,
        })}
      >
        <Text style={{ color: colors.textFaint, fontSize: 15, lineHeight: 18 }}>
          ✦
        </Text>
        <Avatar
          label={bot.avatar}
          color={bot.color}
          icon={bot.icon}
          size={20}
        />
        <Text
          numberOfLines={1}
          style={{
            color: colors.textSoft,
            fontSize: 12,
            fontWeight: "600",
            maxWidth: 320,
          }}
        >
          {summary}
        </Text>
        <MaterialIcons
          name={expanded ? "expand-less" : "expand-more"}
          size={17}
          color={colors.textFaint}
        />
      </Pressable>

      {expanded ? (
        <View
          style={{
            marginTop: 5,
            marginLeft: 10,
            borderLeftWidth: 1,
            borderLeftColor: tint(colors.text, 0.14),
            gap: 7,
            paddingLeft: 11,
            paddingVertical: 3,
          }}
        >
          {steps.map((step, index) => {
            const content = (
              <>
                <MaterialIcons
                  name={iconForStep(step.kind)}
                  size={14}
                  color={colors.textFaint}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: colors.textSoft,
                      fontSize: 11.5,
                      fontWeight: "500",
                    }}
                  >
                    {step.title}
                  </Text>
                  {step.detail ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        color: colors.textFaint,
                        fontSize: 10.5,
                        marginTop: 1,
                      }}
                    >
                      {step.detail}
                    </Text>
                  ) : null}
                </View>
                {typeof step.atMs === "number" ? (
                  <Text
                    style={{
                      color: colors.textFaint,
                      fontSize: 10.5,
                      fontVariant: ["tabular-nums"],
                      marginLeft: 6,
                    }}
                  >
                    {formatWorkingElapsed(step.atMs)}
                  </Text>
                ) : null}
                {step.url ? (
                  <MaterialIcons
                    name="open-in-new"
                    size={13}
                    color={colors.textFaint}
                  />
                ) : null}
              </>
            );

            return step.url ? (
              <Pressable
                key={`${step.kind}-${step.url}-${index}`}
                accessibilityRole="link"
                accessibilityLabel={`Open source: ${step.title}`}
                onPress={() => void Linking.openURL(step.url!)}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 7 },
                  pressed && { opacity: 0.64 },
                ]}
              >
                {content}
              </Pressable>
            ) : (
              <View
                key={`${step.kind}-${step.title}-${index}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
              >
                {content}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const BOILERPLATE_TITLES = new Set([
  "Read the room context",
  "Read the current conversation",
  "Prepared a response",
  "Preparing a response",
  "Reading your request",
  "Response activity",
  "Checked connected Excel data",
  "Sent your message to the model",
  "Thinking through a plan",
  "Checking connected tools",
]);

function isBoilerplate(step: AgentTraceStep) {
  if (step.url) return false;
  if (step.kind === "source" || step.kind === "search") return false;
  return BOILERPLATE_TITLES.has(step.title.trim());
}
