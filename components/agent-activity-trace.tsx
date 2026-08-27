import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Linking, Pressable, Text, View } from "react-native";
import { useState } from "react";

import { Avatar } from "@/components/rook-primitives";
import type { AgentTraceStep } from "@/shared/agent-trace";
import { tint, useRookTheme } from "@/lib/ui";
import type { Bot } from "@/lib/workroom-store";

const iconForStep = (kind: AgentTraceStep["kind"]) => {
  if (kind === "search") return "search";
  if (kind === "source") return "language";
  if (kind === "tool") return "task-alt";
  if (kind === "approval") return "shield";
  return "check-circle-outline";
};

export function AgentActivityTrace({
  bot,
  trace,
}: {
  bot: Bot;
  trace: AgentTraceStep[];
}) {
  const { colors } = useRookTheme();
  const [expanded, setExpanded] = useState(false);
  const sourceCount = trace.filter((step) => step.kind === "source").length;
  const searchable = sourceCount > 0;
  const summary = searchable
    ? `${sourceCount} public ${sourceCount === 1 ? "source" : "sources"} found`
    : "Response activity";

  return (
    <View style={{ marginBottom: 9, maxWidth: 520 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${summary.toLowerCase()}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => ({
          minHeight: 30,
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 7,
          paddingVertical: 3,
          paddingRight: 5,
          opacity: pressed ? 0.68 : 1,
        })}
      >
        <Avatar
          label={bot.avatar}
          color={bot.color}
          icon={bot.icon}
          size={20}
        />
        <Text
          style={{ color: colors.textSoft, fontSize: 12, fontWeight: "600" }}
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
          {trace.map((step, index) => {
            const content = (
              <>
                <MaterialIcons
                  name={iconForStep(step.kind)}
                  size={14}
                  color={
                    step.kind === "source" ? colors.accent : colors.textFaint
                  }
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color:
                        step.kind === "source"
                          ? colors.textSoft
                          : colors.textFaint,
                      fontSize: 11.5,
                      fontWeight: step.kind === "source" ? "600" : "500",
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
