import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { emptyWorkroomSnapshot } from "../shared/workroom-snapshot";
import * as store from "../server/db";

async function main() {
  const suffix = randomUUID();
  const openId = `smoke:${suffix}`;
  let userId: string | undefined;

  try {
  await store.upsertUser({
    openId,
    name: "InstantDB Smoke Test",
    email: `${suffix}@example.invalid`,
    loginMethod: "smoke",
    lastSignedIn: new Date(),
  });
  const user = await store.getUserByOpenId(openId);
  assert(user, "user upsert/query failed");
  userId = user.id;
  assert.equal(typeof user.id, "string");
  assert.equal(user.name, "InstantDB Smoke Test");

  await store.upsertNotificationPreferences(user.id, {
    approvalEnabled: false,
    completionEnabled: true,
  });
  const preferences = await store.getNotificationPreferences(user.id);
  assert.equal(preferences?.approvalEnabled, false);
  assert.equal(preferences?.completionEnabled, true);

  const installationId = `smoke-installation-${suffix}`;
  await store.upsertPushDevice(user.id, {
    installationId,
    expoPushToken: `ExponentPushToken[${suffix}]`,
    approvalEnabled: true,
    completionEnabled: false,
  });
  assert.equal((await store.getPushDevice(installationId))?.userId, user.id);

  const snapshot = {
    ...emptyWorkroomSnapshot(),
    onboardingComplete: true,
    bots: [
      {
        id: `bot-${suffix}`,
        name: "Smoke Bot",
        role: "Tester",
        status: "Ready",
        color: "#7563F5",
        icon: "auto-awesome",
      },
    ],
    tasks: [
      {
        id: `task-${suffix}`,
        botId: `bot-${suffix}`,
        title: "Verify InstantDB",
        status: "Draft",
        risk: "Low",
      },
    ],
    files: [
      {
        id: `file-${suffix}`,
        name: "smoke.txt",
        owner: "Smoke Bot",
        scope: "Bot-private",
      },
    ],
  };
  await store.upsertWorkroomSnapshot(user.id, snapshot);
  await store.syncNormalizedWorkroomRecords(user.id, snapshot);
  await store.upsertWorkroomSnapshot(user.id, snapshot);
  await store.syncNormalizedWorkroomRecords(user.id, snapshot);
  const records = await store.listNormalizedWorkroomRecords(user.id);
  assert.equal(records.bots.length, 1);
  assert.equal(records.tasks.length, 1);
  assert.equal(records.files.length, 1);

  const alternateSnapshot = {
    ...snapshot,
    bots: [{ ...snapshot.bots[0], name: "Concurrent Smoke Bot" }],
  };
  await Promise.all([
    store.saveWorkroomState(user.id, snapshot),
    store.saveWorkroomState(user.id, alternateSnapshot),
  ]);
  const concurrentSnapshot = await store.getWorkroomSnapshot(user.id);
  const concurrentRecords = await store.listNormalizedWorkroomRecords(user.id);
  assert.equal(concurrentRecords.bots.length, 1);
  assert.equal(
    (concurrentRecords.bots[0].payload as { name?: string }).name,
    (concurrentSnapshot?.snapshot.bots[0] as { name?: string }).name,
  );

  const state = `smoke-state-${suffix}`;
  await store.createMicrosoftOAuthState({
    state,
    userId: user.id,
    codeVerifier: `smoke-verifier-${suffix}`,
    returnTo: "https://www.rook.lighting/account",
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal((await store.consumeMicrosoftOAuthState(state))?.userId, user.id);
  assert.equal(await store.consumeMicrosoftOAuthState(state), undefined);

  // GitHub connector entities — a schema gap here fails only the GitHub
  // surfaces, so they are exercised explicitly rather than assumed present.
  const githubState = `smoke-github-state-${suffix}`;
  await store.createGithubOAuthState({
    state: githubState,
    userId: user.id,
    returnTo: "https://www.rook.lighting/account",
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(
    (await store.consumeGithubOAuthState(githubState))?.userId,
    user.id,
  );
  assert.equal(await store.consumeGithubOAuthState(githubState), undefined);

  await store.upsertGithubConnection({
    userId: user.id,
    githubUserId: `smoke-gh-${suffix}`,
    login: "smoke-user",
    displayName: "Smoke User",
    avatarUrl: null,
    encryptedAccessToken: "smoke-access-token",
    encryptedRefreshToken: "smoke-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
    scopes: "repo read:user offline_access",
    status: "connected",
  });
  assert.equal(
    (await store.getGithubConnection(user.id))?.login,
    "smoke-user",
  );
  await store.addGithubSelectedRepo(user.id, {
    fullName: "smoke-owner/smoke-repo",
    repoId: 123456,
    privateRepo: true,
    defaultBranch: "main",
    description: "Smoke-test GitHub repo selection.",
  });
  const selectedRepos = await store.listGithubSelectedRepos(user.id);
  assert.equal(selectedRepos.length, 1);
  assert.equal(selectedRepos[0].fullName, "smoke-owner/smoke-repo");
  await store.removeGithubSelectedRepo(user.id, "smoke-owner/smoke-repo");
  assert.equal((await store.listGithubSelectedRepos(user.id)).length, 0);
  await store.deleteGithubConnection(user.id);
  assert.equal(await store.getGithubConnection(user.id), undefined);

  const actionId = `smoke-action-${suffix}`;
  await store.createExcelPendingAction({
    id: actionId,
    userId: user.id,
    botClientId: `bot-${suffix}`,
    taskClientId: `task-${suffix}`,
    toolName: "excel_update_range",
    arguments: { address: "A1" },
    summary: "Smoke-test an approval-gated Excel write.",
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal((await store.getExcelPendingAction(user.id, actionId))?.state, "pending");
  await store.resolveExcelPendingAction(user.id, actionId, { state: "declined" });
  assert.equal((await store.getExcelPendingAction(user.id, actionId))?.state, "declined");

  const claimedActionId = `smoke-claim-${suffix}`;
  await store.createExcelPendingAction({
    id: claimedActionId,
    userId: user.id,
    botClientId: `bot-${suffix}`,
    taskClientId: `task-${suffix}`,
    toolName: "excel_update_range",
    arguments: { address: "B2" },
    summary: "Smoke-test exclusive Excel write ownership.",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const claims = await Promise.all([
    store.claimExcelPendingAction(user.id, claimedActionId),
    store.claimExcelPendingAction(user.id, claimedActionId),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  await store.finishExcelPendingAction(user.id, claimedActionId, { state: "declined" });

  const exported = await store.exportAccountWorkroomData(user.id);
  assert.equal(exported.snapshot?.onboardingComplete, true);
  assert.equal(exported.notificationPreferences.approval, false);

  const database = await store.getDb();
  assert(database, "InstantDB admin client was not initialized");
  const guestResult = await database.asUser({ guest: true }).query({ users: {} });
  assert.equal(guestResult.users.length, 0, "guest permissions exposed user data");

  console.log("InstantDB smoke test passed");
  } finally {
    if (userId) {
      await store.deleteAccountWorkroomData(userId).catch(() => undefined);
    }
    const database = await store.getDb();
    if (database) {
      const { users } = await database.query({
        users: { $: { where: { openId } } },
      });
      if (users.length) {
        await database.transact(
          users.map((user) => database.tx.users[user.id].delete()),
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
