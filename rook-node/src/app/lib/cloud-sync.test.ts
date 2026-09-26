import { describe, expect, it } from "vitest";

import {
  mapCloudBot,
  mapCloudMessage,
  mapCloudTask,
  unmapDesktopBot,
  unmapDesktopMessage,
  unmapDesktopTask,
} from "./cloud-sync";

describe("cloud bot mapping", () => {
  it("adopts mobile bots and derives an avatar", () => {
    const bot = mapCloudBot({
      id: "b1",
      name: "Scout",
      role: "researcher",
      purpose: "p",
      color: "#123456",
      icon: "orb",
      status: "Working",
      model: "openrouter/free",
      lastActive: "now",
      memory: "prefers bullets",
      approvalRule: "ask",
    });
    expect(bot).toMatchObject({ id: "b1", name: "Scout", memory: "prefers bullets" });
  });

  it("rejects records without identity", () => {
    expect(mapCloudBot(null)).toBeNull();
    expect(mapCloudBot({ name: "NoId" })).toBeNull();
    expect(mapCloudBot({ id: "x" })).toBeNull();
  });

  it("round-trips a desktop bot without losing fields", () => {
    const desktop = {
      id: "b1",
      name: "Scout",
      role: "r",
      purpose: "p",
      color: "#177149",
      icon: "sparkles",
      status: "Ready" as const,
      model: "auto",
      lastActive: "now",
      memory: "m",
      approvalRule: "ask",
    };
    const back = mapCloudBot(unmapDesktopBot(desktop));
    expect(back).toMatchObject({ id: "b1", name: "Scout", memory: "m", model: "auto" });
  });
});

describe("cloud message mapping", () => {
  it("keeps trace, kind, and images; drops pending", () => {
    const message = mapCloudMessage({
      id: "m1",
      botId: "b1",
      author: "bot",
      body: "hi",
      createdAt: "t",
      kind: "approval",
      taskId: "task-1",
      trace: [{ kind: "tool", title: "Checked" }],
      pending: true,
    });
    expect(message).toMatchObject({ id: "m1", kind: "approval", taskId: "task-1" });
    expect(message?.trace).toHaveLength(1);
    expect(message).not.toHaveProperty("pending");
  });

  it("rejects malformed rows", () => {
    expect(mapCloudMessage(null)).toBeNull();
    expect(mapCloudMessage({ id: "m", author: "bot" })).toBeNull();
    expect(mapCloudMessage({ id: "m", author: "alien", body: "x" })).toBeNull();
  });

  it("drops transient pending messages on upload", () => {
    expect(
      unmapDesktopMessage({
        id: "m",
        botId: "b",
        author: "bot",
        body: "",
        createdAt: "t",
        pending: true,
      }),
    ).toBeNull();
  });
});

describe("cloud task mapping", () => {
  it("keeps risk/steps and defaults sensibly", () => {
    const task = mapCloudTask({
      id: "t1",
      botId: "b1",
      title: "Do it",
      status: "Working",
      risk: "High",
      steps: [{ id: "s", label: "L", state: "active" }],
    });
    expect(task).toMatchObject({ id: "t1", risk: "High" });
    expect(task?.steps).toHaveLength(1);
    expect(
      unmapDesktopTask({
        id: "t1",
        botId: "b1",
        title: "Do it",
        status: "Working",
        summary: "",
        startedAt: "t",
        nextAction: "",
        risk: "Low",
        steps: [],
      }),
    ).toMatchObject({ id: "t1", botClientId: "b1" });
  });

  it("rejects records without identity", () => {
    expect(mapCloudTask({ title: "NoId" })).toBeNull();
  });
});
