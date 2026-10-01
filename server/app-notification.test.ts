import assert from "node:assert/strict";
import test from "node:test";

import {
  NotificationBridgeError,
  notificationDeviceForPrincipal,
  upsertNotificationDevice,
} from "./app-notification";

const previousOrigin = process.env.APP_NOTIFICATION_API_ORIGIN;
const previousToken = process.env.APP_NOTIFICATION_SERVICE_TOKEN;
process.env.APP_NOTIFICATION_API_ORIGIN = "http://app-cms.test";
process.env.APP_NOTIFICATION_SERVICE_TOKEN = "service-secret";

test.after(() => {
  restoreEnv("APP_NOTIFICATION_API_ORIGIN", previousOrigin);
  restoreEnv("APP_NOTIFICATION_SERVICE_TOKEN", previousToken);
});

test("proxy derives dealer identity instead of trusting request body", async () => {
  let sent: Record<string, unknown> | undefined;
  await upsertNotificationDevice("D001", {
    installationID: "install-1",
    expoPushToken: "ExponentPushToken[abc]",
    platform: "android",
    subjectID: "attacker",
  }, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.equal(sent?.subjectID, "D001");
  assert.equal(sent?.appKey, "teamup");
  assert.equal(sent?.subjectType, "dealer");
});

test("proxy rejects invalid tokens before calling app-cms", async () => {
  await assert.rejects(
    () => upsertNotificationDevice("D001", {
      installationID: "install-1",
      expoPushToken: "bad-token",
      platform: "ios",
    }, async () => { throw new Error("must not run"); }),
    /Expo push token/,
  );
});

test("staff cannot reach the notification-device proxy", async () => {
  let calls = 0;
  await assert.rejects(
    () => notificationDeviceForPrincipal(
      { role: "staff", subjectId: "E001" },
      "PUT",
      { installationID: "install-1", expoPushToken: "ExponentPushToken[abc]", platform: "ios" },
      async () => { calls += 1; return new Response(null, { status: 200 }); },
    ),
    (error: unknown) => error instanceof NotificationBridgeError && error.status === 403,
  );
  assert.equal(calls, 0);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}
