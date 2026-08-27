import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import {
  defaultModelForProvider,
  modelsForProvider,
  providerLabel,
  type AiProvider,
} from "@/lib/ai-provider";
import { trpc } from "@/lib/trpc";
import { tint, useRookTheme } from "@/lib/ui";

export function ComposerModelPicker({
  value,
  provider,
  onChange,
}: {
  value: string;
  provider: AiProvider;
  onChange: (modelId: string) => void;
}) {
  const { colors, dark } = useRookTheme();
  const [open, setOpen] = useState(false);
  const catalog = trpc.ai.models.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const models = useMemo(
    () => modelsForProvider(catalog.data?.models ?? [], provider),
    [catalog.data?.models, provider],
  );
  const selected = useMemo(
    () =>
      models.find((model) => model.id === value) ??
      defaultModelForProvider(models, provider),
    [models, provider, value],
  );
  const selectionLabel = selected?.automatic
    ? "Auto"
    : selected?.name || providerLabel(provider);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose ${providerLabel(provider)} model`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            maxWidth: 176,
            minHeight: 34,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: open ? tint(colors.accent, 0.38) : "transparent",
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: tint(colors.text, dark ? 0.1 : 0.05),
          },
          pressed && { opacity: 0.64, transform: [{ scale: 0.98 }] },
        ]}
      >
        <MaterialIcons name="bolt" size={15} color={colors.textSoft} />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: colors.textSoft,
            fontSize: 11.5,
            fontWeight: "700",
          }}
        >
          {catalog.isLoading ? "Loading…" : selectionLabel}
        </Text>
        <MaterialIcons name="expand-more" size={15} color={colors.textFaint} />
      </Pressable>

      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable
          accessibilityLabel="Dismiss model chooser"
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 16,
            backgroundColor: dark
              ? "rgba(2, 4, 7, 0.52)"
              : "rgba(18, 23, 31, 0.18)",
          }}
        >
          <Pressable
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 410,
              maxHeight: "76%",
              overflow: "hidden",
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.canvas,
              padding: 8,
            }}
          >
            <View
              style={{
                minHeight: 42,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 7,
                gap: 9,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    color: colors.textFaint,
                    fontSize: 10.5,
                    fontWeight: "700",
                    letterSpacing: 0.8,
                  }}
                >
                  {providerLabel(provider).toUpperCase()}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.text,
                    fontSize: 14.5,
                    fontWeight: "700",
                    letterSpacing: -0.2,
                    marginTop: 1,
                  }}
                >
                  Choose a model
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close model chooser"
                onPress={() => setOpen(false)}
                style={({ pressed }) => [
                  {
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.surfaceAlt,
                  },
                  pressed && { opacity: 0.62 },
                ]}
              >
                <MaterialIcons name="close" size={17} color={colors.textSoft} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: 350 }}
              contentContainerStyle={{ gap: 3, paddingTop: 3 }}
              showsVerticalScrollIndicator={false}
            >
              {models.map((model) => {
                const active = model.id === selected?.id;
                return (
                  <Pressable
                    key={model.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`Use ${model.name}`}
                    onPress={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      {
                        minHeight: 50,
                        borderRadius: 14,
                        paddingHorizontal: 11,
                        paddingVertical: 9,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 9,
                        backgroundColor: active
                          ? tint(colors.accent, dark ? 0.18 : 0.08)
                          : "transparent",
                      },
                      pressed && { opacity: 0.66 },
                    ]}
                  >
                    <View
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 99,
                        backgroundColor: active ? colors.accent : colors.line,
                      }}
                    />
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
                        numberOfLines={1}
                        style={{
                          color: colors.textFaint,
                          fontSize: 10.5,
                          marginTop: 2,
                        }}
                      >
                        {model.provider} · {model.usageLabel}
                      </Text>
                    </View>
                    {active ? (
                      <MaterialIcons
                        name="check"
                        size={17}
                        color={colors.accent}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
              {!catalog.isLoading && !models.length ? (
                <View
                  style={{
                    paddingHorizontal: 18,
                    paddingTop: 22,
                    paddingBottom: 25,
                    alignItems: "center",
                  }}
                >
                  <MaterialIcons
                    name="link-off"
                    size={21}
                    color={colors.textFaint}
                  />
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 13,
                      fontWeight: "700",
                      marginTop: 9,
                    }}
                  >
                    No {providerLabel(provider)} models available
                  </Text>
                  <Text
                    style={{
                      color: colors.textFaint,
                      fontSize: 11.5,
                      lineHeight: 16,
                      textAlign: "center",
                      marginTop: 5,
                    }}
                  >
                    {provider === "chatgpt"
                      ? "Reconnect ChatGPT from Account, then try again."
                      : "Rook could not load the model list right now."}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
