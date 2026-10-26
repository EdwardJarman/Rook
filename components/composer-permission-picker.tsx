import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, Text, View, useWindowDimensions } from "react-native";

import {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_HINTS,
  PERMISSION_LEVEL_LABELS,
  type PermissionLevel,
} from "@/shared/permission-level";
import { trpc } from "@/lib/trpc";
import { tint, useRookTheme } from "@/lib/ui";

const SHORT_LABEL: Record<PermissionLevel, string> = { always_ask: "Ask", auto: "Auto", full: "Full" };
const ICON: Record<PermissionLevel, "front-hand" | "tune" | "bolt"> = {
  always_ask: "front-hand",
  auto: "tune",
  full: "bolt",
};

/** Compact segmented control: one tap changes the level, the current level is always visible. */
export function ComposerPermissionPicker() {
  const { colors, dark } = useRookTheme();
  const { width } = useWindowDimensions();
  const showLabels = width >= 430;
  const utils = trpc.useUtils();
  const query = trpc.permissions.get.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const mutation = trpc.permissions.set.useMutation({
    onMutate: async ({ level }) => {
      await utils.permissions.get.cancel();
      const previous = utils.permissions.get.getData();
      utils.permissions.get.setData(undefined, (old) => ({ ceiling: "full" as const, ...old, level }));
      return { previous };
    },
    onError: (_error, _vars, context) => utils.permissions.get.setData(undefined, context?.previous),
    onSettled: () => void utils.permissions.get.invalidate(),
  });
  const current: PermissionLevel = query.data?.level ?? "always_ask";

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Permission level"
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 999,
        padding: 2,
        marginLeft: 4,
        backgroundColor: tint(colors.text, dark ? 0.1 : 0.05),
      }}
    >
      {PERMISSION_LEVELS.map((level) => {
        const active = level === current;
        return (
          <Pressable
            key={level}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, busy: mutation.isPending }}
            accessibilityLabel={`${PERMISSION_LEVEL_LABELS[level]}. ${PERMISSION_LEVEL_HINTS[level]}`}
            onPress={() => !active && mutation.mutate({ level })}
            style={({ pressed }) => [
              {
                minHeight: 30,
                minWidth: 30,
                borderRadius: 999,
                paddingHorizontal: showLabels ? 9 : 7,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                backgroundColor: active ? colors.canvas : "transparent",
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            <MaterialIcons name={ICON[level]} size={14} color={active ? colors.accent : colors.textFaint} />
            {showLabels || active ? (
              <Text
                numberOfLines={1}
                style={{ fontSize: 11.5, fontWeight: "700", color: active ? colors.text : colors.textFaint }}
              >
                {SHORT_LABEL[level]}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
