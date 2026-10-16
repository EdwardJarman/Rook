import { Alert, Platform } from "react-native";

// Alert.alert is a silent no-op on react-native-web, which made connector
// failures invisible on the web app. Route web through window dialogs.

export function rookAlert(title: string, message?: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

export function rookConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { confirmLabel?: string; destructive?: boolean },
) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: options?.confirmLabel ?? "Confirm",
      style: options?.destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}
