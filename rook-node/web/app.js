// Rook Node shell UI.
//
// Determines status from two independent sources so no single failure can
// freeze the page:
//   1. the Tauri shell ("health" command — knows about the sidecar process
//      and probes the gateway itself), and
//   2. the gateway directly over loopback HTTP (works even if the Tauri
//      bridge is missing; also catches an adopted/orphaned gateway).
//
// States: Starting… → Running → Connect account → (browser) → Connected ✓.
(function () {
  "use strict";

  // Must match DEFAULT_GATEWAY_PORT in the sidecar config.
  var GATEWAY = "http://127.0.0.1:37831";

  var statusEl = document.getElementById("status");
  var connectBtn = document.getElementById("connect");
  var retryBtn = document.getElementById("retry");
  var errorEl = document.getElementById("error");
  var manualEl = document.getElementById("manual");
  var manualUrlEl = document.getElementById("manualUrl");
  var hintEl = document.getElementById("hint");

  var core = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core : null;
  var invoke =
    core && typeof core.invoke === "function"
      ? function (cmd) {
          return core.invoke(cmd);
        }
      : null;

  if (!invoke) {
    // Shell bridge unavailable — surface the loopback URL instead of a dead
    // button, so pairing is still possible from a normal browser.
    manualEl.hidden = false;
    manualUrlEl.textContent = GATEWAY + "/connect";
  }

  // Set after "Connect account": poll fast so the window flips to Connected
  // the moment the browser round-trip finishes.
  var eagerUntil = 0;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "pill " + cls;
  }

  function showError(text) {
    errorEl.textContent = text || "";
  }

  function showManual() {
    manualEl.hidden = false;
    manualUrlEl.textContent = GATEWAY + "/connect";
  }

  function render(state) {
    var paired = Boolean(state && state.listening && state.paired);
    var listening = Boolean(state && state.listening);
    var running = Boolean(state && state.running);

    retryBtn.hidden = !(running === false && listening === false);
    connectBtn.hidden = paired;
    hintEl.textContent = paired
      ? "This computer is connected to your Rook account. You can close this window."
      : "Connecting opens your browser and comes right back.";

    if (paired) {
      setStatus("Connected ✓", "on");
      connectBtn.disabled = true;
      showError("");
    } else if (listening) {
      setStatus("Running", "on");
      connectBtn.disabled = false;
      showError(state && state.error ? state.error : "");
    } else if (running) {
      setStatus("Starting…", "warn");
      connectBtn.disabled = true;
      // The shell's 15s watchdog reports a real reason if the node never
      // opens its gateway — surface it instead of spinning silently.
      showError(state && state.error ? state.error : "");
    } else {
      setStatus("Not running", "off");
      connectBtn.disabled = true;
      showError(state && state.error ? "Reason: " + state.error : "");
    }
  }

  function probeGateway() {
    return fetch(GATEWAY + "/healthz", { cache: "no-store" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function refresh() {
    var shell = invoke
      ? invoke("health")
          .then(function (raw) {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })
          .catch(function () {
            return null;
          })
      : Promise.resolve(null);

    return shell
      .then(function (state) {
        return probeGateway().then(function (gateway) {
          if (gateway && gateway.ok) {
            // The gateway itself is the source of truth for listening/paired;
            // a shell health answer can be stale by up to one poll interval.
            state = {
              running: true,
              listening: true,
              paired: Boolean(gateway.paired),
              error: state ? state.error : undefined,
            };
          }
          render(
            state || {
              running: false,
              listening: false,
              paired: false,
              error: invoke ? undefined : "Shell bridge unavailable",
            },
          );
        });
      })
      .catch(function () {
        /* never let the loop die */
      });
  }

  connectBtn.addEventListener("click", function () {
    connectBtn.disabled = true;
    eagerUntil = Date.now() + 120000; // fast-poll for 2 minutes
    var reenable = function () {
      setTimeout(function () {
        connectBtn.disabled = false;
      }, 1500);
    };
    if (invoke) {
      invoke("open_connect").then(reenable, function (error) {
        showError("Could not open your browser: " + error);
        showManual();
        reenable();
      });
    } else {
      showError("Copy the address above into your browser to connect.");
      showManual();
      reenable();
    }
  });

  retryBtn.addEventListener("click", function () {
    retryBtn.disabled = true;
    setStatus("Starting…", "warn");
    showError("");
    var done = function () {
      retryBtn.disabled = false;
      refresh();
    };
    if (invoke) {
      invoke("start_sidecar").then(done, done);
    } else {
      done();
    }
  });

  function loop() {
    refresh().then(function () {
      var delay = Date.now() < eagerUntil ? 1000 : 3000;
      setTimeout(loop, delay);
    });
  }

  refresh();
  setTimeout(loop, 1000);
  // Pairing completes in the browser — refresh immediately on focus.
  window.addEventListener("focus", function () {
    refresh();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh();
  });
})();