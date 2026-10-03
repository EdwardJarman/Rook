/**
 * Live drill for the OpenCode path: sends "hi" to every model in Rook's
 * OpenCode catalog through the real `invokeOpenCode` and reports, per model,
 * either an answer or the true reason it can't answer. Exits 1 if any model
 * ends in the generic "couldn't produce a usable answer" shrug or an
 * untyped error. Run: `pnpm drill:opencode-models`.
 *
 * Needs only a reachable `opencode serve` (no Clerk session, no Rook login):
 *   OPENCODE_BASE_URL=http://127.0.0.1:4123  (or OPENCODE_MANAGED=1 + the opencode binary)
 *   OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME   only if that server is secured
 * Optional: OPENCODE_TURN_TIMEOUT_MS (default 90000 here), ROOK_DRILL_ALL=1 to
 * also send "hi" to models the catalog already labels unavailable,
 * ROOK_DRILL_MODELS=opencode:a,opencode:b to restrict the run.
 * Spends a few free-tier tokens per model; prints no secrets (reasons are redacted).
 */
import "dotenv/config";

type Verdict = {
  model: string;
  verdict: "ok" | "UNAVAILABLE" | "FAILED" | "SHRUG";
  detail: string;
  layer?: string;
  kind?: string;
  status?: number;
  code?: string;
  ms: number;
};

async function main() {
  process.env.OPENCODE_TURN_TIMEOUT_MS ??= "90000";
  process.env.ROOK_AI_DEBUG ??= "1";
  const { effectiveOpenCodeBase, fetchServedModels, invokeOpenCode, listOpenCodeModelsLive, opencodeStatus } = await import("../server/ai/opencode");
  const { friendlyAgentError } = await import("../server/ai/agent-reliability");
  const { ProviderError, redactAndTruncate } = await import("../server/ai/provider-error");
  const { modelHealth } = await import("../server/ai/model-health");

  const base = effectiveOpenCodeBase();
  if (!base) throw new Error("Set OPENCODE_BASE_URL (or OPENCODE_MANAGED=1 with the opencode binary installed).");

  console.info(`0) Server ${base}`);
  const status = await opencodeStatus();
  console.info(`   ${status.operational ? "online" : "NOT operational"}: ${status.message}`);

  console.info("1) Catalog vs what the server actually serves…");
  const served = await fetchServedModels({ force: true });
  const catalog = await listOpenCodeModelsLive();
  console.table(
    catalog.map((model) => {
      const upstream = model.id.slice("opencode:".length);
      return {
        id: model.id,
        name: model.name,
        servedByServer: served ? (served.has(upstream) ? "yes" : "NO") : "unknown",
        serverStatus: served?.get(upstream)?.status ?? "",
        label: model.unavailable ? `UNAVAILABLE: ${model.unavailableReason}` : "offered",
      };
    }),
  );

  const only = process.env.ROOK_DRILL_MODELS?.split(",").map((id) => id.trim()).filter(Boolean);
  const results: Verdict[] = [];
  console.info('2) Sending "hi" to each model (sequential)…');
  for (const model of catalog) {
    if (only?.length && !only.includes(model.id)) continue;
    if (model.unavailable && !/^(1|true|on)$/i.test(process.env.ROOK_DRILL_ALL ?? "")) {
      results.push({ model: model.id, verdict: "UNAVAILABLE", detail: model.unavailableReason ?? "", ms: 0 });
      continue;
    }
    const started = Date.now();
    // One retry for transient upstream wobbles: the drill should report a model's state, not a blip.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const reply = await invokeOpenCode({ model: model.id, messages: [{ role: "user", content: "hi" }] });
        modelHealth.record({ provider: "opencode", model: model.id, ok: true });
        const text = String(reply.choices[0]?.message.content ?? "").trim();
        results.push({ model: model.id, verdict: text ? "ok" : "SHRUG", detail: text ? text.slice(0, 80) : "empty text", ms: Date.now() - started });
        break;
      } catch (error) {
        if (error instanceof ProviderError) {
          modelHealth.record({ provider: "opencode", model: model.id, ok: false, kind: error.kind, status: error.info.status, code: error.info.code });
          if (error.kind === "transient" && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            continue;
          }
          const line = friendlyAgentError(error);
          const shrug = /couldn't produce a usable answer/.test(line);
          results.push({
            model: model.id,
            verdict: shrug ? "SHRUG" : error.kind === "model-unavailable" ? "UNAVAILABLE" : "FAILED",
            detail: redactAndTruncate(line, 200),
            layer: error.info.layer,
            kind: error.kind,
            status: error.info.status,
            code: error.info.code,
            ms: Date.now() - started,
          });
        } else {
          results.push({ model: model.id, verdict: "SHRUG", detail: `untyped error: ${redactAndTruncate(error instanceof Error ? error.message : String(error))}`, ms: Date.now() - started });
        }
        break;
      }
    }
    const last = results.at(-1)!;
    console.info(`   ${last.model}: ${last.verdict} (${last.ms}ms)`);
  }

  console.info("3) Result per model:");
  console.table(results);
  console.info("4) Per-model health (what trpc.ai.turns reports):");
  console.table(modelHealth.snapshot());

  console.info("5) Catalog as the picker would now show it:");
  console.table((await listOpenCodeModelsLive()).map((model) => ({ id: model.id, label: model.unavailable ? `UNAVAILABLE: ${model.unavailableReason}` : "offered" })));

  const shrugs = results.filter((result) => result.verdict === "SHRUG");
  if (!results.some((entry) => entry.verdict === "ok")) {
    console.error("DRILL FAILED: no model answered — see the reasons above (server down, credentials, or every model unavailable).");
    process.exitCode = 1;
  } else if (shrugs.length) {
    console.error(`DRILL FAILED: ${shrugs.length} model(s) ended without a true reason: ${shrugs.map((entry) => entry.model).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.info(`DRILL OK: ${results.filter((entry) => entry.verdict === "ok").length}/${results.length} answered; every other model has a stated reason.`);
  }
}

main().catch((error) => {
  console.error("DRILL FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
