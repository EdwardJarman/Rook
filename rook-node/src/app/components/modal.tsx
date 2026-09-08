import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

import { Button, IconButton } from "./primitives";
import { useTheme } from "@/lib/theme";

export function Modal({
  open,
  onClose,
  title,
  lead,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const { tokens } = useTheme();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: tokens.scrim,
        display: "grid",
        placeItems: "center",
        zIndex: 80,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "90vh",
          overflow: "auto",
          background: tokens.surface,
          border: `1px solid ${tokens.line}`,
          borderRadius: 20,
          boxShadow: "0 30px 80px rgba(0,0,0,0.18)",
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${tokens.line}`,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: -0.2,
                color: tokens.text,
              }}
            >
              {title}
            </h2>
            {lead ? (
              <p
                style={{
                  margin: "4px 0 0",
                  color: tokens.textSoft,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                {lead}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div style={{ padding: 18 }}>{children}</div>
        {footer ? (
          <footer
            style={{
              padding: "12px 18px",
              borderTop: `1px solid ${tokens.line}`,
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
