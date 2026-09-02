import React from "react";
import ReactDOM from "react-dom/client";

import "@/styles/globals.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { mountSendBridge } from "./lib/send-bridge";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

mountSendBridge();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Keyframes for spinners — kept global because they're referenced from
// inline styles in the primitives module.
const style = document.createElement("style");
style.textContent = `@keyframes rook-spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);

// Global error handler — the Tauri webview swallows uncaught errors and
// shows a blank white page. Surface them so the user can see what broke.
window.addEventListener("error", (event) => {
  // eslint-disable-next-line no-console
  console.error("[rook] uncaught error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  // eslint-disable-next-line no-console
  console.error("[rook] unhandled rejection:", event.reason);
});
