import { describe, expect, it } from "vitest";

import {
  BOT_ORB_MATERIALS,
  DEFAULT_BOT_ORB_ICON,
  botOrbIcon,
  getBotOrbMaterial,
} from "../lib/bot-orb-identity";

describe("Bot orb identity", () => {
  it("serializes every supported material into the stored icon field", () => {
    expect(BOT_ORB_MATERIALS.map(botOrbIcon)).toEqual([
      "bot-orb:matte",
      "bot-orb:iridescent",
    ]);
  });

  it("uses a valid material for new Bots", () => {
    expect(getBotOrbMaterial(DEFAULT_BOT_ORB_ICON)).toBe("matte");
  });

  it("does not reinterpret legacy icons as orb materials", () => {
    expect(getBotOrbMaterial("auto-awesome")).toBeNull();
    expect(getBotOrbMaterial("bot-shape:drop")).toBeNull();
    expect(getBotOrbMaterial("bot-orb:unknown")).toBeNull();
  });
});
