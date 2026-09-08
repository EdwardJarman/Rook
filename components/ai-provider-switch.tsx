import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Alert, Pressable, Text, View } from "react-native";

import { Card } from "@/components/rook-primitives";
import {
  modelsForProvider,
  providerLabel,
  type AiProvider,
} from "@/lib/ai-provider";
import { trpc } from "@/lib/trpc";
import { useRookTheme } from "@/lib/ui";
import { useWorkroom } from "@/lib/workroom-store";

const PROVIDERS: AiProvider[] = [
  "openrouter",
  "orcarouter",
  "tokenrouter",
  "chatgpt",
];

const providerIcon = (provider: AiProvider) => {
  if (provider === "chatgpt") return "chat-bubble-outline" as const;
  if (provider === "orcarouter") return "waves" as const;
  if (provider === "tokenrouter") return "toll" as const;
  return "hub" as const;
};

const providerNote = (provider: AiProvider) => {
  if (provider === "chatgpt")
    return "Uses your connected ChatGPT plan. Rook falls back safely if the plan session expires.";
  if (provider === "orcarouter")
    return "Uses Rook’s OrcaRouter key and the exact free model you choose—never an OpenRouter substitute.";
  if (provider === "tokenrouter")
    return "Uses Rook’s TokenRouter key and the exact free model you choose—never an OpenRouter substitute.";
  return "Uses Rook’s shared free OpenRouter allowance.";
};

export function AiProviderSwitch() {
  const { colors, dark } = useRookTheme();
  const { aiProvider, setAiProvider } = useWorkroom();
  const catalog = trpc.ai.models.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const models = catalog.data?.models ?? [];

  const choose = (provider: AiProvider) => {
    if (!modelsForProvider(models, provider).length) {
      Alert.alert(
        `${providerLabel(provider)} is not ready`,
        provider === "chatgpt"
          ? "Use the ChatGPT card below to connect your plan, then select ChatGPT here."
          : `Add the ${providerLabel(provider)} server key in Vercel, redeploy Rook, then select it here.`,
      );
      return;
    }
    setAiProvider(provider);
  };

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 13,
            backgroundColor: colors.surfaceAlt,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialIcons name="route" size={19} color={colors.textSoft} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>
            Default AI provider
          </Text>
          <Text
            style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}
          >
            All Bot messages use {providerLabel(aiProvider)} until you switch.
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          borderRadius: 16,
          backgroundColor: colors.surfaceAlt,
          padding: 4,
          gap: 4,
        }}
      >
        {PROVIDERS.map((provider) => {
          const active = aiProvider === provider;
          const unavailable = !modelsForProvider(models, provider).length;
          return (
            <Pressable
              key={provider}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: unavailable }}
              accessibilityLabel={`Use ${providerLabel(provider)} for AI`}
              onPress={() => choose(provider)}
              style={({ pressed }) => ({
                flexGrow: 1,
                flexBasis: "47%",
                minHeight: 46,
                borderRadius: 13,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                backgroundColor: active ? colors.surface : "transparent",
                borderWidth: active ? 1 : 0,
                borderColor: active ? colors.lineStrong : "transparent",
                opacity: unavailable ? 0.45 : pressed ? 0.68 : 1,
                ...(active && PlatformShadow(dark)),
              })}
            >
              <MaterialIcons
                name={providerIcon(provider)}
                size={16}
                color={active ? colors.text : colors.textFaint}
              />
              <Text
                style={{
                  color: active ? colors.text : colors.textSoft,
                  fontSize: 12.5,
                  fontWeight: active ? "700" : "600",
                }}
              >
                {providerLabel(provider)}
              </Text>
              {active ? (
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: colors.mint,
                  }}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
        <MaterialIcons name="info-outline" size={14} color={colors.textFaint} />
        <Text
          style={{
            flex: 1,
            color: colors.textFaint,
            fontSize: 10.5,
            lineHeight: 15,
          }}
        >
          {providerNote(aiProvider)}
        </Text>
      </View>
    </Card>
  );
}

const PlatformShadow = (dark: boolean) => ({
  shadowColor: dark ? "#000000" : "#18201C",
  shadowOpacity: dark ? 0.28 : 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
});
