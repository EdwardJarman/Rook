import React from "react";
import ReactDOM from "react-dom/client";

import "@/styles/globals.css";
import { App } from "./App";
import { mountSendBridge } from "./lib/send-bridge";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

mountSendBridge();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Keyframes for spinners — kept global because they're referenced from
// inline styles in the primitives module.
const style = document.createElement("style");
style.textContent = `@keyframes rook-spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);
