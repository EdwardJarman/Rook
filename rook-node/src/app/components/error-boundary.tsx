import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render-time errors in the React tree and shows them inline.
 *
 * Tauri 2's webview swallows uncaught errors and shows a blank white
 * page, which is impossible to debug from the user side. This boundary
 * surfaces the error so the user can see what broke and (in dev) the
 * developer can see the stack.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[rook] react error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            height: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#000000",
            color: "#EDEBE6",
            padding: 24,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Text", Roboto, Helvetica, Arial, sans-serif',
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              Rook desktop hit a render error
            </h1>
            <p
              style={{
                marginTop: 10,
                fontSize: 13,
                color: "#9B978E",
                lineHeight: 1.55,
              }}
            >
              The local Rook Node sidecar is still running in the
              background. Reload the window after restarting the app.
            </p>
            <pre
              style={{
                marginTop: 16,
                padding: 14,
                background: "#151515",
                border: "1px solid #2B2B2B",
                borderRadius: 12,
                fontSize: 12,
                color: "#E5735F",
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflow: "auto",
                maxHeight: 320,
              }}
            >
              {String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
            </pre>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && window.location) {
                  window.location.reload();
                }
              }}
              style={{
                marginTop: 18,
                padding: "10px 18px",
                background: "#0C0C0C",
                color: "#EDEBE6",
                border: "1px solid #2B2B2B",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload window
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
