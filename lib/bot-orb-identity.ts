export const BOT_ORB_PREFIX = "bot-orb:";
export const BOT_ORB_MATERIALS = ["matte", "iridescent"] as const;
export type BotOrbMaterial = (typeof BOT_ORB_MATERIALS)[number];

export const DEFAULT_BOT_ORB_MATERIAL: BotOrbMaterial = "matte";
export const DEFAULT_BOT_ORB_ICON = `${BOT_ORB_PREFIX}${DEFAULT_BOT_ORB_MATERIAL}`;

export function botOrbIcon(material: BotOrbMaterial) {
  return `${BOT_ORB_PREFIX}${material}`;
}

export function getBotOrbMaterial(icon?: string): BotOrbMaterial | null {
  if (!icon?.startsWith(BOT_ORB_PREFIX)) return null;
  const material = icon.slice(BOT_ORB_PREFIX.length) as BotOrbMaterial;
  return BOT_ORB_MATERIALS.includes(material) ? material : null;
}
