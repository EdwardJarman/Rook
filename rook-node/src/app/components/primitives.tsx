import { type CSSProperties, type ReactNode, forwardRef } from "react";

import { Avatar as _Avatar } from "./avatar";
import { Modal as _Modal } from "./modal";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

export const Avatar = _Avatar;
export const Modal = _Modal;

type DivProps = React.HTMLAttributes<HTMLDivElement>;

const baseSurface: CSSProperties = {
  background: "var(--rook-surface)",
  border: "1px solid var(--rook-line)",
  borderRadius: 18,
};

export function Card({
  className,
  style,
  children,
  padding = 18,
  ...rest
}: DivProps & { padding?: number }) {
  return (
    <div
      className={cn("card", className)}
      style={{
        ...baseSurface,
        padding,
        boxShadow: "var(--shell-shadow)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  lead,
  action,
  className,
}: {
  title: string;
  lead?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("panel-header", className)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: -0.3,
            color: "var(--rook-text)",
          }}
        >
          {title}
        </h2>
        {lead ? (
          <p
            style={{
              margin: "4px 0 0",
              color: "var(--rook-text-soft)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {lead}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

type Tone = "mint" | "amber" | "coral" | "muted" | "accent";

export function Pill({
  label,
  tone = "mint",
  className,
  style,
}: {
  label: ReactNode;
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
}) {
  const fg =
    tone === "amber"
      ? "var(--rook-amber)"
      : tone === "coral"
        ? "var(--rook-coral)"
        : tone === "muted"
          ? "var(--rook-text-soft)"
          : tone === "accent"
            ? "var(--rook-accent)"
            : "var(--rook-mint)";
  const bg =
    tone === "amber"
      ? "var(--rook-amber-soft)"
      : tone === "coral"
        ? "var(--rook-coral-soft)"
        : tone === "muted"
          ? "var(--rook-surface-alt)"
          : "var(--rook-mint-soft)";
  return (
    <span
      className={cn("pill", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: fg,
        background: bg,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: fg,
        }}
      />
      {label}
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  full?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    loading,
    full,
    className,
    children,
    disabled,
    style,
    ...rest
  },
  ref,
) {
  const padding =
    size === "sm" ? "6px 12px" : size === "lg" ? "12px 22px" : "9px 16px";
  const fontSize = size === "sm" ? 12.5 : size === "lg" ? 15 : 13.5;
  const radii = size === "sm" ? 10 : size === "lg" ? 14 : 12;

  const visuals: CSSProperties = (() => {
    if (variant === "primary") {
      return {
        background: "var(--rook-ink)",
        color: "var(--rook-on-ink)",
        border: "1px solid var(--rook-ink)",
      };
    }
    if (variant === "secondary") {
      return {
        background: "var(--rook-surface)",
        color: "var(--rook-text)",
        border: "1px solid var(--rook-line-strong)",
      };
    }
    if (variant === "danger") {
      return {
        background: "var(--rook-coral-soft)",
        color: "var(--rook-coral)",
        border: "1px solid transparent",
      };
    }
    return {
      background: "transparent",
      color: "var(--rook-text-soft)",
      border: "1px solid transparent",
    };
  })();

  return (
    <button
      ref={ref}
      className={cn("btn", className)}
      disabled={disabled || loading}
      style={{
        ...visuals,
        borderRadius: radii,
        padding,
        fontSize,
        fontWeight: 600,
        letterSpacing: -0.1,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        width: full ? "100%" : undefined,
        transition: "transform 80ms ease, opacity 80ms ease, background 120ms ease",
        ...style,
      }}
      onMouseDown={(e) => {
        if (e.currentTarget.style.transform === "") {
          e.currentTarget.style.transform = "scale(0.985)";
        }
        rest.onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "";
        rest.onMouseUp?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        rest.onMouseLeave?.(e);
      }}
      {...rest}
    >
      {loading ? <Spinner size={fontSize + 2} /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

export function IconButton({
  label,
  children,
  onClick,
  active,
  tone = "default",
  size = 36,
  className,
  style,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  tone?: "default" | "accent" | "danger";
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const color =
    tone === "accent"
      ? "var(--rook-accent)"
      : tone === "danger"
        ? "var(--rook-coral)"
        : active
          ? "var(--rook-text)"
          : "var(--rook-text-soft)";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("icon-btn", className)}
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        border: "1px solid var(--rook-line)",
        background: active ? "var(--rook-surface-alt)" : "var(--rook-surface)",
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        display: "inline-block",
        animation: "rook-spin 0.7s linear infinite",
      }}
    />
  );
}

export function Divider({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: "var(--rook-line)",
        ...style,
      }}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--rook-line-strong)",
        borderRadius: 16,
        background: "var(--rook-surface)",
        padding: 28,
        textAlign: "center",
        color: "var(--rook-text-soft)",
      }}
    >
      {icon ? (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: "var(--rook-accent-soft)",
            color: "var(--rook-accent)",
            margin: "0 auto 12px",
            display: "grid",
            placeItems: "center",
          }}
        >
          {icon}
        </div>
      ) : null}
      <h3
        style={{
          margin: 0,
          color: "var(--rook-text)",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: -0.2,
        }}
      >
        {title}
      </h3>
      {body ? (
        <p
          style={{
            margin: "6px auto 0",
            color: "var(--rook-text-soft)",
            fontSize: 12.5,
            lineHeight: 1.55,
            maxWidth: 360,
          }}
        >
          {body}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("field", className)} style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--rook-text-faint)",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span
          style={{
            display: "block",
            color: "var(--rook-coral)",
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {error}
        </span>
      ) : hint ? (
        <span
          style={{
            display: "block",
            color: "var(--rook-text-faint)",
            fontSize: 11.5,
            marginTop: 4,
          }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean },
) {
  const { className, style, invalid, ...rest } = props;
  return (
    <input
      className={cn("rook-input", className)}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${invalid ? "var(--rook-coral)" : "var(--rook-line-strong)"}`,
        background: "var(--rook-surface)",
        color: "var(--rook-text)",
        outline: "none",
        ...style,
      }}
      {...rest}
    />
  );
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    invalid?: boolean;
  },
) {
  const { className, style, invalid, ...rest } = props;
  return (
    <textarea
      className={cn("rook-textarea", className)}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${invalid ? "var(--rook-coral)" : "var(--rook-line-strong)"}`,
        background: "var(--rook-surface)",
        color: "var(--rook-text)",
        outline: "none",
        resize: "vertical",
        minHeight: 72,
        ...style,
      }}
      {...rest}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
  size?: "sm" | "md";
}) {
  const { tokens } = useTheme();
  const pad = size === "sm" ? "5px 11px" : "7px 14px";
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: tokens.surfaceAlt,
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: pad,
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 8,
              background: active ? tokens.surface : "transparent",
              color: active ? tokens.text : tokens.textSoft,
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 36,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--rook-accent)" : "var(--rook-line-strong)",
          position: "relative",
          transition: "background 120ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 16 : 2,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "var(--rook-on-ink)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            transition: "left 120ms",
          }}
        />
      </span>
      {label ? (
        <span style={{ fontSize: 13, color: "var(--rook-text)" }}>{label}</span>
      ) : null}
    </label>
  );
}
