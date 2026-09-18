import {
  BotGlyph,
  DEFAULT_BOT_SHAPE,
  getBotShape,
} from "@/components/bot-glyph";
import { LiveOrb } from "@/components/live-orb";
import {
  DEFAULT_BOT_ORB_MATERIAL,
  getBotOrbMaterial,
  type BotOrbMaterial,
} from "@/lib/bot-orb-identity";
import { shade } from "@/lib/ui";

export {
  BOT_ORB_MATERIALS,
  DEFAULT_BOT_ORB_ICON,
  DEFAULT_BOT_ORB_MATERIAL,
  botOrbIcon,
  getBotOrbMaterial,
  type BotOrbMaterial,
} from "@/lib/bot-orb-identity";

function eyeColorFor(background: string) {
  const value = background.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return "#FFFFFF";
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.66 ? "#111318" : "#FFFFFF";
}

export function BotOrb({
  color,
  material = DEFAULT_BOT_ORB_MATERIAL,
  size,
  interactive = true,
  blink = true,
}: {
  color: string;
  material?: BotOrbMaterial;
  size: number;
  interactive?: boolean;
  blink?: boolean;
}) {
  if (material === "iridescent") {
    return (
      <LiveOrb
        size={size}
        variant="webgl"
        colors={[shade(color, 0.24), color, shade(color, -0.36)]}
        eyeColor={eyeColorFor(color)}
        interactive={interactive}
        blink={blink}
      />
    );
  }

  return (
    <LiveOrb
      size={size}
      variant="custom"
      color={color}
      eyeColor={eyeColorFor(color)}
      interactive={interactive}
      blink={blink}
    />
  );
}

/** Render new 3D orb identities while preserving legacy geometric Bot marks. */
export function BotIdentityMark({
  icon,
  color,
  size,
  interactive = false,
  blink = false,
}: {
  icon?: string;
  color: string;
  size: number;
  interactive?: boolean;
  blink?: boolean;
}) {
  const material = getBotOrbMaterial(icon);
  if (material) {
    return (
      <BotOrb
        color={color}
        material={material}
        size={size}
        interactive={interactive}
        blink={blink}
      />
    );
  }

  return (
    <BotGlyph
      shape={getBotShape(icon) ?? DEFAULT_BOT_SHAPE}
      color={color}
      size={size}
    />
  );
}
