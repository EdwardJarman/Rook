export type TaskAlert = {
  expoPushToken: string;
  kind: "approval" | "completion";
  title: string;
  body: string;
  url: string;
};

export function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

export function buildExpoPushPayload(alert: TaskAlert) {
  return {
    to: alert.expoPushToken,
    sound: "default",
    title: alert.title,
    body: alert.body,
    priority: "high",
    channelId: "workroom-alerts",
    data: { kind: alert.kind, url: alert.url },
  };
}

export async function sendExpoPushAlert(alert: TaskAlert, signal?: AbortSignal): Promise<{ accepted: boolean; reason?: string }> {
  if (!isExpoPushToken(alert.expoPushToken)) return { accepted: false, reason: "No valid device push token is registered." };
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(buildExpoPushPayload(alert)),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return { accepted: false, reason: `Expo Push returned ${response.status}.` };
    const body = await response.json() as { data?: { status?: string; message?: string } };
    return body.data?.status === "ok" ? { accepted: true } : { accepted: false, reason: body.data?.message ?? "Expo Push did not accept the alert." };
  } catch {
    return { accepted: false, reason: "Remote push delivery is temporarily unavailable." };
  }
}
