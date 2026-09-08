import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";
import { canonicalModelForProvider, defaultModelForProvider, modelsForProvider, providerLabel, type AiProvider } from "@/lib/ai-provider";
import { tint, useRookTheme } from "@/lib/ui";

export function AiModelSelector({
  value,
  provider,
  onChange,
}: {
  value: string;
  provider: AiProvider;
  onChange: (modelId: string) => void;
}) {
  const { colors, dark } = useRookTheme();
  const [expanded, setExpanded] = useState(false);
  const catalog = trpc.ai.models.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const models = useMemo(
    () => modelsForProvider(catalog.data?.models ?? [], provider),
    [catalog.data?.models, provider],
  );
  const selected = useMemo(
    () =>
      models.find((model) => model.id === canonicalModelForProvider(value, provider)) ??
      defaultModelForProvider(models, provider),
    [models, provider, value],
  );

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: colors.accent,
          fontSize: 11.5,
          fontWeight: "700",
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        AI model
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose AI model"
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          {
            minHeight: 58,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: expanded ? tint(colors.accent, 0.4) : colors.line,
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          },
          pressed && { opacity: 0.72 },
        ]}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            backgroundColor: tint(colors.accent, dark ? 0.2 : 0.1),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialIcons name="auto-awesome" size={17} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontSize: 13.5, fontWeight: "600" }}
          >
            {catalog.isLoading
              ? "Loading free models…"
              : selected?.name || "Auto · Best available"}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}
          >
            {selected
              ? `${selected.provider} · ${selected.usageLabel}${selected.supportsVision ? " · Vision" : ""}`
              : catalog.isError
                ? "Live model list is temporarily unavailable"
                : `${providerLabel(provider)} · Free`}
          </Text>
        </View>
        <MaterialIcons
          name={expanded ? "expand-less" : "expand-more"}
          size={20}
          color={colors.textFaint}
        />
      </Pressable>

      {expanded ? (
        <View
          style={{
            borderRadius: 17,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
            overflow: "hidden",
          }}
        >
          <ScrollView
            style={{ maxHeight: 270 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {models.map((model, index) => {
              const active = model.id === (selected?.id || value);
              return (
                <Pressable
                  key={model.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    onChange(model.id);
                    setExpanded(false);
                  }}
                  style={({ pressed }) => [
                    {
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 11,
                      borderTopWidth: index ? 1 : 0,
                      borderTopColor: colors.line,
                      backgroundColor: active
                        ? tint(colors.accent, dark ? 0.18 : 0.08)
                        : colors.surface,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: colors.text,
                        fontSize: 13,
                        fontWeight: active ? "700" : "600",
                      }}
                    >
                      {model.name}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.textFaint,
                        fontSize: 11,
                        lineHeight: 15,
                        marginTop: 2,
                      }}
                    >
                      {model.provider} · {model.usageLabel}
                      {model.contextLength ? ` · ${formatContext(model.contextLength)} context` : ""}
                      {model.supportsVision ? " · Vision" : ""}
                    </Text>
                  </View>
                  {active ? (
                    <MaterialIcons name="check" size={18} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
            {!catalog.isLoading && !models.length ? (
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 12,
                  lineHeight: 18,
                  padding: 15,
                }}
              >
                Rook could not load {providerLabel(provider)} models. Check the provider connection in Account.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const formatContext = (tokens: number) => {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens || "—");
};
