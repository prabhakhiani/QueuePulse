/* QueuePulse Job Lab — UI for the working queue engine.
   Two backends behind one interface:
   - local : engine.js running in this tab (works on GitHub Pages)
   - remote: server/server.js over HTTP (real-time engine running on your machine)
   Uses drawLineChart() from app.js. */
"use strict";
(function () {
  var QN = ["media-worker", "notifications", "background"];
  var local = { engine: null, speed: 1, paused: false, last: 0, timer: null };
  var backend = { mode: "local", base: "" };
  var latest = null, cfgFilled = false, failedFetches = 0;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(id, fallback) { var v = parseFloat(el(id).value); return isFinite(v) ? v : fallback; }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function sec(n) { return (Math.round(n * 10) / 10) + "s"; }

  /* ---------- backends ---------- */

  function startLocal() {
    if (!window.QPEngine) return;
    local.engine = window.QPEngine.createEngine({ seed: Date.now() % 100000 });
    local.last = Date.now();
    clearInterval(local.timer);
    local.timer = setInterval(function () {
      var t = Date.now(), dt = t - local.last; local.last = t;
      if (!local.paused) local.engine.advance(dt * local.speed);
    }, 100);
  }

  function call(action, p) {
    p = p || {};
    if (backend.mode === "local") {
      var e = local.engine, r;
      if (action === "submit") r = e.submit(p);
      else if (action === "burst") r = e.burst(p);
      else if (action === "config") r = e.setConfig(p);
      else if (action === "kill") r = e.killWorker(p.id);
      else if (action === "pause") r = e.pauseWorker(p.id);
      else if (action === "recover") r = e.recoverWorker(p.id);
      else if (action === "redrive") r = e.redrive(p.queue, true);
      else if (action === "reset") { e.reset(); r = { ok: true }; }
      else if (action === "speed") { local.speed = p.speed || 1; local.paused = !!p.paused; r = { ok: true }; }
      refresh();
      return Promise.resolve(r);
    }
    var route = { submit: "jobs", burst: "burst", config: "config", reset: "reset", speed: "speed" }[action], url;
    if (route) url = "/api/" + route;
    else if (action === "redrive") url = "/api/dlq/" + encodeURIComponent(p.queue) + "/redrive";
    else url = "/api/workers/" + encodeURIComponent(p.id) + "/" + action;
    return fetch(backend.base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) })
      .then(function (r) { return r.json(); })
      .then(function (r) { refresh(); return r; });
  }

  function refresh() {
    if (backend.mode === "local") {
      if (local.engine) { latest = local.engine.snapshot(); latest.server = { speed: local.speed, paused: local.paused }; render(latest); }
      return;
    }
    fetch(backend.base + "/api/state").then(function (r) { return r.json(); }).then(function (s) {
      failedFetches = 0; latest = s; render(s);
    }).catch(function () {
      if (++failedFetches > 4) { setMode("local"); toast("Server stopped answering. Switched back to the browser engine."); }
    });
  }

  function toast(m) { if (typeof showToast === "function") showToast(m); }

  function setMode(mode, base) {
    backend.mode = mode; backend.base = base || ""; cfgFilled = false; failedFetches = 0;
    var remote = mode === "remote";
    el("modeBadge").textContent = remote ? "LIVE SERVER" : "BROWSER ENGINE";
    el("modeTag").textContent = remote ? "RUNS ON A SERVER" : "RUNS IN YOUR BROWSER";
    el("modeTitle").textContent = remote ? "Connected to a real-time server" : "Real queue logic, simulated cloud";
    el("modeNote").textContent = remote
      ? "The same engine is running in a Node.js process at " + (base || "this address") + ". Jobs you submit here are processed there, in real time, by its worker pool."
      : "A working engine runs in this tab: visibility timeouts, retries with backoff, dead-letter queues, idempotent claims and backlog-based auto-scaling. It models AWS SQS and ECS behaviour but does not call AWS.";
    if (!remote && !local.engine) startLocal();
    refresh();
  }

  /* ---------- rendering ---------- */

  function kpi(label, value, note, tone) {
    return '<article class="lab-kpi' + (tone ? " " + tone : "") + '"><span>' + label + '</span><strong>' + value + "</strong><small>" + note + "</small></article>";
  }

  function render(s) {
    var q = s.queues, t = s.totals;
    var waiting = 0, inflight = 0, dlq = 0, busy = 0, up = 0;
    q.forEach(function (x) { waiting += x.visible; inflight += x.inflight; dlq += x.dlq; });
    s.workers.forEach(function (w) { if (w.state !== "failed") up++; if (w.state === "busy") busy++; });
    el("kpis").innerHTML =
      kpi("Waiting", fmt(waiting), "visible in queues") +
      kpi("In flight", fmt(inflight), "being worked on") +
      kpi("Completed", fmt(t.completed), fmt(t.submitted) + " submitted") +
      kpi("Retries", fmt(t.retries), fmt(t.redelivered) + " timed out", t.retries ? "warn" : "") +
      kpi("Dead-letter", fmt(dlq), "need attention", dlq ? "bad" : "") +
      kpi("Workers busy", busy + " / " + up, "live of all fleets") +
      kpi("Wait, 95th pct", sec(s.latency.waitP95), "submit to first start");
    el("depthNow").textContent = fmt(waiting) + " NOW";
    el("workersNow").textContent = up + " NOW";

    var h = s.history.slice(-300);
    if (h.length > 1 && typeof drawLineChart === "function") {
      drawLineChart(el("depthChart"), h.map(function (p) { return p.depth; }), { color: "#5eead4", max: Math.max(10, Math.max.apply(null, h.map(function (p) { return p.depth; })) * 1.15) });
      drawLineChart(el("workerChart"), h.map(function (p) { return p.workers; }), { color: "#a78bfa", max: Math.max(5, Math.max.apply(null, h.map(function (p) { return p.workers; })) * 1.2) });
    }

    el("queueCards").innerHTML = q.map(function (x) {
      var w = x.workers, live = w.starting + w.idle + w.busy + w.paused;
      return '<article class="lab-queue"><header><strong>' + x.name + '</strong><span class="status ' + (x.dlq ? "failed" : "success") + '">' + (x.dlq ? "DLQ " + x.dlq : "Healthy") + "</span></header>" +
        '<dl><div><dt>Waiting</dt><dd>' + fmt(x.visible) + "</dd></div><div><dt>In flight</dt><dd>" + x.inflight + "</dd></div><div><dt>Retry delay</dt><dd>" + x.delayed + "</dd></div><div><dt>Done</dt><dd>" + fmt(x.completed) + "</dd></div></dl>" +
        '<p class="lab-scale">Workers: <b>' + live + "</b> live (" + w.busy + " busy, " + w.starting + " starting)" + (w.failed ? ", <b class=\"warn-text\">" + w.failed + " failed</b>" : "") + "<br>Scaler wants <b>" + x.desired + "</b> · rule says " + x.requiredNow + " now (s = " + x.secPerJob + "s)</p>" +
        (x.dlq ? '<button class="danger-button btn-sm" data-redrive="' + x.name + '" type="button">Fix cause and redrive ' + x.dlq + " job" + (x.dlq > 1 ? "s" : "") + "</button>" : "") + "</article>";
    }).join("");

    el("fleetCount").textContent = up + " LIVE";
    el("fleet").innerHTML = s.workers.map(function (w) {
      var tone = w.state === "failed" ? "failed" : (w.state === "busy" ? "pending" : (w.state === "starting" ? "idle" : "success"));
      return '<div class="lab-worker ' + w.state + '"><div><strong>' + w.id + '</strong><span class="status ' + tone + '">' + w.state + "</span></div>" +
        "<small>" + (w.job ? "Running " + w.job : w.state === "failed" ? "Waiting for replacement" : w.processed + " jobs done") + "</small>" +
        '<div class="lab-bar"><i style="width:' + w.util + '%"></i></div>' +
        '<div class="worker-actions">' + (w.state !== "failed"
          ? '<button class="danger-button btn-sm" data-kill="' + w.id + '" type="button">Crash</button><button class="secondary-button btn-sm" data-pause="' + w.id + '" type="button">' + (w.state === "paused" ? "Resume" : "Pause") + "</button>"
          : '<button class="secondary-button btn-sm" data-recover="' + w.id + '" type="button">Replace now</button>') + "</div></div>";
    }).join("");

    el("alarms").innerHTML = s.alarms.map(function (a) {
      return '<li class="' + (a.firing ? "firing" : "ok") + '"><span class="status ' + (a.firing ? "failed" : "success") + '">' + (a.firing ? "FIRING" : "OK") + "</span> " + esc(a.name) + " <small>" + esc(a.detail) + "</small></li>";
    }).join("");

    el("log").innerHTML = s.events.slice(0, 40).map(function (ev) {
      return "<li class=\"ev-" + ev.type + "\"><time>" + sec(ev.t / 1000) + "</time> " + esc(ev.text) + "</li>";
    }).join("") || '<li class="muted">No events yet. Submit a job to begin.</li>';

    var c = s.config, B = waiting, sp = q.reduce(function (m, x) { return Math.max(m, x.secPerJob); }, 0);
    el("formula").innerHTML = "workers = ceil(B × s ÷ T) = ceil(" + B + " × " + sp + " ÷ " + c.targetWaitSec + ") = <b>" + Math.ceil(B * sp / c.targetWaitSec) + "</b> <small>per busiest queue, kept between " + c.minWorkers + " and " + c.maxWorkers + "</small>";

    if (!cfgFilled) {
      el("cfgT").value = c.targetWaitSec; el("cfgVis").value = c.visibilityTimeoutMs / 1000; el("cfgMin").value = c.minWorkers;
      el("cfgMax").value = c.maxWorkers; el("cfgStart").value = c.startupMs / 1000; el("cfgTries").value = c.maxReceiveCount;
      el("cfgDup").value = Math.round(c.duplicateDeliveryProb * 100); el("cfgAuto").checked = c.autoscale; el("cfgBeat").checked = c.heartbeat;
      cfgFilled = true;
    }
    var degraded = s.alarms.filter(function (a) { return a.firing; }).length, dot = el("statusDot"), txt = el("demoStatus");
    if (txt) { txt.textContent = degraded ? degraded + " alarm" + (degraded > 1 ? "s" : "") + " firing" : "All alarms clear"; }
    if (dot) { var col = degraded ? "#fb923c" : "#4ade80"; dot.style.background = col; dot.style.boxShadow = "0 0 12px " + col + "60"; }
    var pb = el("pauseBtn"); if (pb) pb.textContent = s.server && s.server.paused ? "▶ Resume" : "Ⅱ Pause";
  }

  /* ---------- user input ---------- */

  function bind() {
    el("jobForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = el("jobName").value.trim() || "Job";
      call("submit", { queue: el("jobQueue").value, name: name, durationMs: num("jobDur", 2) * 1000, failProb: num("jobFail", 0) / 100, idemKey: el("jobKey").value.trim() })
        .then(function (r) {
          el("jobResult").textContent = !r || !r.ok ? "Could not submit." : r.duplicate ? "Ignored: key already used by " + r.id + ". The job will run once." : "Accepted as " + r.id + " in " + r.queue + ".";
        }).catch(function () { el("jobResult").textContent = "Could not reach the server."; });
    });
    el("burstForm").addEventListener("submit", function (e) {
      e.preventDefault();
      call("burst", { queue: el("burstQueue").value, count: num("burstCount", 100), durationMs: num("burstDur", 2) * 1000, failProb: num("burstFail", 0) / 100, name: "Burst job" });
    });
    document.querySelector(".lab-presets").addEventListener("click", function (e) {
      var b = e.target.closest("[data-preset]"); if (!b) return;
      var p = b.dataset.preset;
      if (p === "rush") { call("burst", { queue: "notifications", count: 300, durationMs: 500, name: "Appointment confirmation" }); call("burst", { queue: "background", count: 60, durationMs: 3000, name: "Daily report" }); }
      if (p === "upload") call("burst", { queue: "media-worker", count: 80, durationMs: 6000, name: "Video conversion" });
      if (p === "poison") call("burst", { queue: "media-worker", count: 10, durationMs: 1500, failProb: 1, name: "Corrupt file" });
    });
    el("cfgForm").addEventListener("submit", function (e) {
      e.preventDefault();
      call("config", { targetWaitSec: num("cfgT", 30), visibilityTimeoutMs: num("cfgVis", 15) * 1000, minWorkers: num("cfgMin", 1), maxWorkers: num("cfgMax", 20),
        startupMs: num("cfgStart", 3) * 1000, maxReceiveCount: num("cfgTries", 5), duplicateDeliveryProb: num("cfgDup", 0) / 100,
        autoscale: el("cfgAuto").checked, heartbeat: el("cfgBeat").checked }).then(function () { toast("Settings applied"); });
    });
    el("speedGroup").addEventListener("click", function (e) {
      var b = e.target.closest("[data-speed]"); if (!b) return;
      [].forEach.call(el("speedGroup").children, function (c) { c.classList.toggle("active", c === b); });
      call("speed", { speed: Number(b.dataset.speed), paused: latest && latest.server && latest.server.paused });
    });
    el("pauseBtn").addEventListener("click", function () {
      var sp = latest && latest.server ? latest.server.speed : 1, p = !(latest && latest.server && latest.server.paused);
      call("speed", { speed: sp, paused: p });
    });
    el("resetBtn").addEventListener("click", function () { call("reset").then(function () { toast("Engine reset"); }); });
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-kill],[data-pause],[data-recover],[data-redrive]"); if (!t) return;
      if (t.dataset.kill) call("kill", { id: t.dataset.kill });
      if (t.dataset.pause) call("pause", { id: t.dataset.pause });
      if (t.dataset.recover) call("recover", { id: t.dataset.recover });
      if (t.dataset.redrive) call("redrive", { queue: t.dataset.redrive });
    });
    el("serverForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var base = el("serverUrl").value.trim().replace(/\/+$/, "");
      if (!base) { el("serverResult").textContent = "Enter the server address first."; return; }
      el("serverResult").textContent = "Connecting…";
      fetch(base + "/api/state").then(function (r) { return r.json(); }).then(function (s) {
        if (!s.queues) throw new Error("bad");
        el("serverResult").textContent = "Connected."; setMode("remote", base);
      }).catch(function () { el("serverResult").textContent = "No QueuePulse server at that address. Run: node server/server.js"; });
    });
    el("localBtn").addEventListener("click", function () { el("serverResult").textContent = ""; setMode("local"); });
    el("exportBtn").addEventListener("click", function () {
      if (!latest) return;
      var out = { exportedAt: new Date().toISOString(), mode: backend.mode, config: latest.config, totals: latest.totals, latency: latest.latency, queues: latest.queues, history: latest.history };
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
      a.download = "queuepulse-run.json"; a.click(); URL.revokeObjectURL(a.href);
    });
    window.addEventListener("resize", function () { if (latest) render(latest); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bind();
    var param = new URLSearchParams(location.search).get("api");
    startLocal();
    setMode("local");
    var probe = param || (location.protocol.indexOf("http") === 0 ? "" : null);
    if (probe !== null) {
      fetch(probe + "/api/state").then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (s) {
        if (s && s.queues) { el("serverUrl").value = probe || location.origin; setMode("remote", probe); }
      }).catch(function () { /* no server: stay on the browser engine */ });
    }
    setInterval(function () { if (!document.hidden) refresh(); }, 500);
  });
})();
