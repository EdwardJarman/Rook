import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Card, StatusPill } from "@/components/rook-primitives";
import { providerLabel } from "@/lib/ai-provider";
import { buildOpenCodeSetupPrompt } from "@/lib/opencode-setup";
import { trpc } from "@/lib/trpc";
import { tint, useRookTheme } from "@/lib/ui";

export function AiBackendCard({
  provider = "openrouter",
}: {
  provider?: "openrouter" | "orcarouter" | "tokenrouter" | "opencode";
}) {
  const { colors, dark } = useRookTheme();
  const status = trpc.ai.status.useQuery({ provider }, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const data = status.data;
  const ready = data?.operational === true;
  const [copied, setCopied] = useState(false);

  const copySetupPrompt = async () => {
    const prompt = buildOpenCodeSetupPrompt();
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(prompt);
      } else {
        const Clipboard = await import("expo-clipboard");
        await Clipboard.setStringAsync(prompt);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const label = status.isLoading
    ? "Checking"
    : ready
      ? "Online"
      : data?.configured
        ? "Needs attention"
        : "Setup required";

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 16,
            backgroundColor: tint(colors.accent, dark ? 0.2 : 0.1),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialIcons name={provider === "orcarouter" ? "public" : provider === "tokenrouter" ? "toll" : provider === "opencode" ? "terminal" : "hub"} size={21} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 15,
              fontWeight: "700",
              letterSpacing: -0.2,
            }}
          >
            {providerLabel(provider)}
          </Text>
          <Text
            numberOfLines={2}
            style={{
              color: colors.textFaint,
              fontSize: 11.5,
              lineHeight: 16,
              marginTop: 3,
            }}
          >
            {provider === "opencode"
              ? "Your own OpenCode server — a real local CLI agent. Needs `opencode serve` + OPENCODE_BASE_URL on the Rook server."
              : "Server-managed access to selected free models. Keys never reach the app."}
          </Text>
        </View>
        <StatusPill label={label} tone={ready ? "mint" : data?.configured ? "amber" : "muted"} />
      </View>

      <View style={{ height: 1, backgroundColor: colors.line }} />

      <View style={{ flexDirection: "row", gap: 12 }}>
        <Metric
          label="Free models"
          value={data ? String(data.freeModels) : "—"}
        />
        <View style={{ width: 1, backgroundColor: colors.line }} />
        <Metric
          label="Daily free requests"
          value={
            data?.dailyFreeRequestAllowance
              ? String(data.dailyFreeRequestAllowance)
              : "—"
          }
        />
        <View style={{ width: 1, backgroundColor: colors.line }} />
        <Metric label="User cost" value="$0" />
      </View>

      <View
        style={{
          borderRadius: 14,
          backgroundColor: colors.surfaceAlt,
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          gap: 9,
          alignItems: "flex-start",
        }}
      >
        <MaterialIcons
          name={ready ? "verified" : "info-outline"}
          size={16}
          color={ready ? colors.mint : colors.textFaint}
        />
        <Text style={{ color: colors.textSoft, fontSize: 11.5, lineHeight: 16, flex: 1 }}>
          {status.isError
            ? `Rook could not check ${providerLabel(provider)} right now.`
            : data?.message || "Checking the live free-model catalog…"}
        </Text>
      </View>

      {provider === "opencode" && !ready && !status.isLoading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Setup prompt copied" : "Copy setup prompt for your OpenCode assistant"}
          onPress={() => void copySetupPrompt()}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            minHeight: 42,
            borderRadius: 13,
            backgroundColor: tint(colors.accent, dark ? 0.16 : 0.08),
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <MaterialIcons
            name={copied ? "check" : "content-copy"}
            size={15}
            color={colors.accent}
          />
          <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: "700" }}>
            {copied ? "Copied — paste it to your OpenCode assistant" : "Copy setup prompt for my OpenCode assistant"}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useRookTheme();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{value}</Text>
      <Text
        numberOfLines={2}
        style={{ color: colors.textFaint, fontSize: 10.5, lineHeight: 14, marginTop: 2 }}
      >
        {label}
      </Text>
    </View>
  );
}
