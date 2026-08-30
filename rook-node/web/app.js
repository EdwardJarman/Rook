// Rook Node desktop UI — full app experience, same language as the web.
(function () {
  "use strict";

  var GATEWAY = "http://127.0.0.1:37831";

  var core = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core : null;
  var invoke = core && typeof core.invoke === "function" ? function (cmd, args) { return core.invoke(cmd, args); } : null;

  // --- DOM ---
  var heroPill = document.getElementById("heroPill");
  var heroName = document.getElementById("heroName");
  var heroTitle = document.getElementById("heroTitle");
  var heroLead = document.getElementById("heroLead");
  var heroPrimary = document.getElementById("heroPrimary");
  var heroSecondary = document.getElementById("heroSecondary");
  var heroError = document.getElementById("heroError");
  var heroManual = document.getElementById("heroManual");
  var heroManualUrl = document.getElementById("heroManualUrl");
  var footDot = document.getElementById("footDot");
  var footText = document.getElementById("footText");
  var footVersion = document.getElementById("footVersion");
  var statBots = document.getElementById("statBots");
  var statTabs = document.getElementById("statTabs");
  var statApprovals = document.getElementById("statApprovals");
  var recentList = document.getElementById("recentList");
  var botsList = document.getElementById("botsList");
  var activityList = document.getElementById("activityList");
  var settingsServer = document.getElementById("settingsServer");
  var settingsNodeId = document.getElementById("settingsNodeId");
  var settingsHome = document.getElementById("settingsHome");
  var settingsPort = document.getElementById("settingsPort");
  var settingsVersion = document.getElementById("settingsVersion");

  var eagerUntil = 0;

  function pill(text, cls) {
    heroPill.textContent = text;
    heroPill.className = "pill " + cls;
  }

  function foot(status, isOn) {
    footDot.className = "dot" + (isOn ? " on" : "");
    footText.textContent = status;
  }

  function showError(text) {
    if (text) {
      heroError.textContent = text;
      heroError.hidden = false;
    } else {
      heroError.hidden = true;
    }
  }

  function gatewayFetch(path) {
    return fetch(GATEWAY + path, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function shellHealth() {
    if (!invoke) return Promise.resolve(null);
    return invoke("health")
      .then(function (raw) { try { return JSON.parse(raw); } catch (e) { return null; } })
      .catch(function () { return null; });
  }

  function renderHero(state) {
    var paired = Boolean(state && state.paired);
    var listening = Boolean(state && state.listening);
    var running = Boolean(state && state.running);

    if (paired) {
      pill("Connected \u2713", "on");
      heroTitle.textContent = "This computer is connected";
      heroLead.textContent = "Your Bots can run here. You can close this window — Rook stays connected in the background.";
      heroPrimary.hidden = true;
      heroSecondary.hidden = false;
      heroSecondary.textContent = "Disconnect";
      heroSecondary.onclick = function () {
        if (!confirm("Disconnect this computer from your Rook account? You can reconnect anytime.")) return;
        gatewayFetch("/api/disconnect").then(function () { refresh(); });
        // Also clear cloud identity via POST
        fetch(GATEWAY + "/api/disconnect", { method: "POST" }).catch(function () {});
      };
      showError("");
      heroManual.hidden = true;
    } else if (listening) {
      pill("Running", "on");
      heroTitle.textContent = "Ready to connect";
      heroLead.textContent = "Press Connect account — your browser opens, you sign in, and this computer joins your account.";
      heroPrimary.hidden = false;
      heroPrimary.disabled = false;
      heroPrimary.textContent = "Connect account";
      heroSecondary.hidden = true;
      showError(state && state.error ? state.error : "");
      heroManual.hidden = true;
    } else if (running) {
      pill("Starting\u2026", "warn");
      heroTitle.textContent = "Starting up";
      heroLead.textContent = "Bringing your Bot computer online.";
      heroPrimary.hidden = true;
      heroSecondary.hidden = true;
      showError(state && state.error ? state.error : "");
    } else {
      pill("Not running", "off");
      heroTitle.textContent = "Rook Node isn\u2019t running";
      heroLead.textContent = "The local Bot computer failed to start.";
      heroPrimary.hidden = true;
      heroSecondary.hidden = true;
      showError(state && state.error ? "Reason: " + state.error : "");
    }

    if (!invoke && listening) {
      heroManual.hidden = false;
      heroManualUrl.textContent = GATEWAY + "/connect";
    }
  }

  function renderStats(status) {
    if (!status || !status.health) {
      statBots.textContent = "—";
      statTabs.textContent = "—";
      statApprovals.textContent = "—";
      return;
    }
    statBots.textContent = String(status.health.bots ?? 0);
    statTabs.textContent = String(status.health.tabs ?? 0);
    statApprovals.textContent = String(status.health.pendingApprovals ?? 0);
  }

  function renderSettings(status) {
    if (!status) return;
    settingsServer.textContent = status.serverUrl || "—";
    settingsNodeId.textContent = status.nodeId || status.cloud?.nodeId || "—";
    settingsHome.textContent = status.dataHome || "—";
    settingsPort.textContent = status.gatewayPort ? String(status.gatewayPort) : "37831";
    settingsVersion.textContent = status.version || status.health?.version || "—";
    footVersion.textContent = status.version ? "v" + status.version : "";
  }

  function renderBots(bots, tabs) {
    botsList.innerHTML = "";
    if (!bots || bots.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No Bots on this machine yet. Create a Bot in the web app and assign it here.";
      botsList.appendChild(empty);
      return;
    }
    bots.forEach(function (bot) {
      var botTabs = (tabs || []).filter(function (t) { return t.botId === bot.id; });
      var row = document.createElement("div");
      row.className = "list-item";
      var dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:999px;background:" + (botTabs.length ? "#0e7c59" : "#c9c8c1") + ";flex-shrink:0;";
      var meta = document.createElement("div");
      meta.className = "meta";
      var title = document.createElement("div");
      title.className = "title";
      title.textContent = bot.name;
      var sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = (bot.role || "Bot") + " · " + botTabs.length + " tab" + (botTabs.length === 1 ? "" : "s");
      meta.appendChild(title);
      meta.appendChild(sub);
      row.appendChild(dot);
      row.appendChild(meta);
      botsList.appendChild(row);
    });
  }

  function renderActivity(events) {
    function renderInto(container) {
      container.innerHTML = "";
      if (!events || events.length === 0) {
        var e = document.createElement("div");
        e.className = "empty";
        e.textContent = "No activity yet. Commands from your Bots will appear here.";
        container.appendChild(e);
        return;
      }
      events.slice(0, 8).forEach(function (ev) {
        var row = document.createElement("div");
        row.className = "list-item";
        var meta = document.createElement("div");
        meta.className = "meta";
        var title = document.createElement("div");
        title.className = "title";
        title.style.fontSize = "12.5px";
        title.textContent = ev.kind || "event";
        var sub = document.createElement("div");
        sub.className = "sub";
        try {
          var payload = ev.payload ? JSON.parse(ev.payload) : null;
          sub.textContent = (payload && payload.summary) || (payload ? JSON.stringify(payload).slice(0, 80) : "") || new Date(ev.createdAt).toLocaleString();
        } catch (_) {
          sub.textContent = String(ev.payload || "").slice(0, 80) || new Date(ev.createdAt).toLocaleString();
        }
        var time = document.createElement("div");
        time.className = "sub";
        time.style.flexShrink = "0";
        time.style.fontSize = "11px";
        try { time.textContent = new Date(ev.createdAt).toLocaleTimeString(); } catch (_) { time.textContent = ""; }
        meta.appendChild(title);
        meta.appendChild(sub);
        row.appendChild(meta);
        row.appendChild(time);
        container.appendChild(row);
      });
    }
    renderInto(recentList);
    renderInto(activityList);
  }

  // Tabs
  var tabs = document.querySelectorAll("[data-tab]");
  var panels = document.querySelectorAll("[data-panel]");
  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tab = btn.getAttribute("data-tab");
      tabs.forEach(function (b) { b.classList.toggle("active", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
      panels.forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== tab; });
    });
  });
  // "View all →" in Overview
  var viewAll = document.querySelector('[data-nav="activity"]');
  if (viewAll) {
    viewAll.addEventListener("click", function (e) {
      e.preventDefault();
      document.querySelector('[data-tab="activity"]').click();
    });
  }

  // Actions
  var connectBtn = document.getElementById("heroPrimary");
  connectBtn.addEventListener("click", function () {
    connectBtn.disabled = true;
    eagerUntil = Date.now() + 120000;
    var reenable = function () { setTimeout(function () { connectBtn.disabled = false; }, 1500); };
    if (invoke) {
      invoke("open_connect").then(reenable, function (err) {
        heroManual.hidden = false;
        heroManualUrl.textContent = GATEWAY + "/connect";
        showError("Could not open your browser: " + err);
        reenable();
      });
    } else {
      showError("Copy the address above into your browser to connect.");
      heroManual.hidden = false;
      heroManualUrl.textContent = GATEWAY + "/connect";
      reenable();
    }
  });

  document.getElementById("footRetry").addEventListener("click", function () {
    var btn = document.getElementById("footRetry");
    btn.disabled = true;
    if (invoke) invoke("start_sidecar").then(function () {}, function () {});
    setTimeout(function () { btn.disabled = false; refresh(); }, 800);
  });

  document.getElementById("footQuit").addEventListener("click", function () {
    if (invoke) invoke("stop_sidecar").catch(function () {});
    // Shell will close after stop; also try to close window
    try { window.close(); } catch (_) {}
  });

  document.getElementById("settingsDisconnect").addEventListener("click", function () {
    if (!confirm("Disconnect this computer? You can reconnect anytime from this window.")) return;
    fetch(GATEWAY + "/api/disconnect", { method: "POST" }).then(function () { refresh(); }).catch(function () { refresh(); });
  });

  document.getElementById("settingsCopyId").addEventListener("click", function () {
    var id = settingsNodeId.textContent || "";
    if (!id || id === "—") return;
    if (navigator.clipboard) navigator.clipboard.writeText(id).catch(function () {});
  });

  // Data refresh — shell health + gateway status
  function refresh() {
    var shell = invoke
      ? invoke("health").then(function (raw) { try { return JSON.parse(raw); } catch (e) { return null; } }).catch(function () { return null; })
      : Promise.resolve(null);

    return shell.then(function (state) {
      return gatewayFetch("/api/status").then(function (status) {
        // Gateway is the source of truth for listening/paired when reachable
        if (status && status.ok) {
          var merged = {
            running: true,
            listening: true,
            paired: Boolean(status.paired),
            error: state ? state.error : undefined,
          };
          renderHero(merged);
          renderStats(status);
          renderSettings(status);
          foot(status.paired ? "Connected \u2713" : "Running", !!status.paired || true);
          // Bots & activity
          return Promise.all([gatewayFetch("/api/bots"), gatewayFetch("/api/events?limit=20")]).then(function (results) {
            var botsRes = results[0];
            var eventsRes = results[1];
            var bots = botsRes ? botsRes.bots : [];
            // Tabs not yet exposed separately; derive from bots if needed
            gatewayFetch("/api/tabs").then(function (tabsRes) {
              renderBots(bots, tabsRes ? tabsRes.tabs : []);
            });
            renderActivity(eventsRes ? eventsRes.events : []);
          });
        } else {
          // Gateway unreachable — fall back to shell health
          var fallback = state || { running: false, listening: false, paired: false, error: invoke ? undefined : "Shell bridge unavailable" };
          // Normalize shell shape to hero shape
          var heroState = {
            running: Boolean(fallback.running),
            listening: false,
            paired: false,
            error: fallback.error,
          };
          renderHero(heroState);
          foot(fallback.running ? "Starting\u2026" : "Not running", false);
          if (!fallback.running) {
            renderStats(null);
            renderBots([], []);
            renderActivity([]);
          }
          // Still update settings from shell if possible
          gatewayFetch("/api/status").then(function (s) { if (s) renderSettings(s); });
        }
      });
    }).catch(function () {});
  }

  function loop() {
    refresh().then(function () {
      var delay = Date.now() < eagerUntil ? 1000 : 3000;
      setTimeout(loop, delay);
    });
  }

  // Hero name
  try { heroName.textContent = "· " + window.navigator.platform; } catch (_) {}

  refresh();
  setTimeout(loop, 1000);
  window.addEventListener("focus", function () { refresh(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
})();
