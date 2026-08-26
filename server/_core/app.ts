import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

import { appRouter } from "../routers";
import { getAiBackendStatus } from "../ai";
import { handleChatGPTRoute } from "../ai/chatgpt";
import { createContext } from "./context";
import { registerOAuthRoutes } from "./oauth";
import { registerNodeDownloadRoutes } from "../download-routes";
import { registerNodeRelayRoutes } from "../node-relay-routes";
import * as db from "../db";
import { registerStorageProxy } from "./storageProxy";

function allowedOrigins() {
  return new Set([
    "https://rook.lighting",
    "https://www.rook.lighting",
    process.env.APP_ORIGIN?.replace(/\/$/, "") || "",
    process.env.EXPO_WEB_PREVIEW_URL?.replace(/\/$/, "") || "",
    "http://localhost:8081",
    "http://localhost:8082",
  ].filter(Boolean));
}

export function createApp() {
  const app = express();
  const origins = allowedOrigins();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(origin && !origins.has(origin) ? 403 : 204);
      return;
    }
    next();
  });

  app.all("/api/chatgpt/*", (req, res) => {
    void handleChatGPTRoute(req, res);
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerNodeDownloadRoutes(app);
  registerNodeRelayRoutes(app, {
    consumePairingToken: (token) => db.consumePairingToken(token),
    markPairingTokenUsed: (token, nodeId) => db.markPairingTokenUsed(token, nodeId),
    createDesktopPairingRequest: (input) => db.createDesktopPairingRequest(input),
    consumeDesktopPairingCode: (input) => db.consumeDesktopPairingCode(input),
    createRookNode: (input) => db.createRookNode(input),
    getRookNode: async (nodeId) => {
      const auth = await db.getRookNodeAuth(nodeId);
      return auth;
    },
    touchRookNode: (nodeId, version) => db.touchRookNode(nodeId, version),
    completeNodeCommand: (commandId, report) => db.completeNodeCommand(commandId, report),
    takePendingNodeCommands: (nodeId) => db.takePendingNodeCommands(nodeId),
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get("/api/health/ai", async (req, res) => {
    const provider = req.query.provider === "orcarouter"
      ? "orcarouter"
      : req.query.provider === "tokenrouter"
        ? "tokenrouter"
        : "openrouter";
    try {
      const status = await getAiBackendStatus(provider);
      res.status(status.operational ? 200 : 503).json(status);
    } catch {
      res.status(503).json({
        provider,
        configured: provider === "orcarouter"
          ? Boolean(process.env.ORCAROUTER_API_KEY)
          : provider === "tokenrouter"
            ? Boolean(process.env.TOKENROUTER_API_KEY)
            : Boolean(process.env.OPENROUTER_API_KEY),
        operational: false,
        freeModels: 0,
        dailyFreeRequestAllowance: null,
        message: `${provider === "orcarouter" ? "OrcaRouter" : provider === "tokenrouter" ? "TokenRouter" : "OpenRouter"} health check failed.`,
      });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  return app;
}
