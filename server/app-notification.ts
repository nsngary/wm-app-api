type Fetch = typeof fetch;
type NotificationMethod = "PUT" | "DELETE";

export class NotificationBridgeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parseNotificationDeviceInput(value: unknown) {
  const input = objectValue(value);
  const installationID = boundedString(input.installationID, "installation ID", 100);
  const expoPushToken = boundedString(input.expoPushToken, "Expo push token", 300);
  const platform = boundedString(input.platform, "platform", 10);
  if (!/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(expoPushToken)) {
    throw new NotificationBridgeError(400, "Invalid Expo push token");
  }
  if (platform !== "ios" && platform !== "android") {
    throw new NotificationBridgeError(400, "Invalid platform");
  }
  return { installationID, expoPushToken, platform };
}

export async function upsertNotificationDevice(
  subjectID: string,
  value: unknown,
  fetchImpl: Fetch = fetch,
) {
  const input = parseNotificationDeviceInput(value);
  await notificationRequest("PUT", {
    appKey: "teamup",
    subjectType: "dealer",
    subjectID,
    ...input,
  }, fetchImpl);
}

export async function disableNotificationDevice(
  subjectID: string,
  value: unknown,
  fetchImpl: Fetch = fetch,
) {
  const input = objectValue(value);
  await notificationRequest("DELETE", {
    appKey: "teamup",
    subjectType: "dealer",
    subjectID,
    installationID: boundedString(input.installationID, "installation ID", 100),
  }, fetchImpl);
}

export async function notificationDeviceForPrincipal(
  principal: { role: string; subjectId: string },
  method: NotificationMethod,
  value: unknown,
  fetchImpl: Fetch = fetch,
) {
  if (principal.role !== "dealer") throw new NotificationBridgeError(403, "沒有操作權限");
  if (method === "PUT") return upsertNotificationDevice(principal.subjectId, value, fetchImpl);
  return disableNotificationDevice(principal.subjectId, value, fetchImpl);
}

async function notificationRequest(method: NotificationMethod, body: object, fetchImpl: Fetch) {
  const origin = process.env.APP_NOTIFICATION_API_ORIGIN?.replace(/\/+$/, "");
  const token = process.env.APP_NOTIFICATION_SERVICE_TOKEN;
  if (!origin || !token) {
    throw new NotificationBridgeError(503, "Notification service is not configured");
  }
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/api/internal/device-registrations`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-app-notification-token": token,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NotificationBridgeError(503, "Notification service unavailable");
  }
  if (!response.ok) throw new NotificationBridgeError(503, "Notification service unavailable");
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NotificationBridgeError(400, "Invalid notification device input");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new NotificationBridgeError(400, `Invalid ${name}`);
  }
  return value.trim();
}
