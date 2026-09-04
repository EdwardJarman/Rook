/**
 * Token-aware CSS variables.
 *
 * `data-theme` on <html> drives the active scheme. Components consume the
 * tokens via `var(--rook-*)` so dark mode is theme-correct by construction.
 */
import { useTheme } from "./theme";

export function ThemeStyle() {
  const { tokens, resolved } = useTheme();
  const vars: Record<string, string> = {
    "--rook-canvas": tokens.canvas,
    "--rook-surface": tokens.surface,
    "--rook-surface-alt": tokens.surfaceAlt,
    "--rook-elevated": tokens.elevated,
    "--rook-line": tokens.line,
    "--rook-line-strong": tokens.lineStrong,
    "--rook-text": tokens.text,
    "--rook-text-soft": tokens.textSoft,
    "--rook-text-faint": tokens.textFaint,
    "--rook-ink": tokens.ink,
    "--rook-on-ink": tokens.onInk,
    "--rook-accent": tokens.accent,
    "--rook-accent-soft": tokens.accentSoft,
    "--rook-mint": tokens.mint,
    "--rook-mint-soft": tokens.mintSoft,
    "--rook-amber": tokens.amber,
    "--rook-amber-soft": tokens.amberSoft,
    "--rook-coral": tokens.coral,
    "--rook-coral-soft": tokens.coralSoft,
    "--rook-scrim": tokens.scrim,
    "--rook-grabber": tokens.grabber,
    "--rook-placeholder": tokens.placeholder,
    "--rook-focus": tokens.focus,
  };
  return (
    <style
      data-theme={resolved}
      dangerouslySetInnerHTML={{
        __html: `:root{${Object.entries(vars)
          .map(([k, v]) => `${k}:${v}`)
          .join(";")}}`,
      }}
    />
  );
}
