/* QueuePulse engine — a working model of the queue-driven job pipeline in ARCHITECTURE.md.
   One file, no dependencies. It runs in the browser (Job Lab), in Node (server/server.js),
   and in automated tests (test/engine.test.js).

   It models SQS standard-queue behaviour in virtual time:
   visibility timeout, at-least-once delivery, receive counts, dead-letter queues,
   exponential backoff with jitter, idempotent job claims, worker crashes, and
   backlog-based auto-scaling:  workers = ceil(B x s / T).
   It does NOT talk to AWS. Numbers it produces describe the design's behaviour, not AWS latency. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QPEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var QUEUES = ["media-worker", "notifications", "background"];
  var STEP_MS = 100;

  var DEFAULTS = {
    targetWaitSec: 30,            // T: longest acceptable wait
    autoscale: true,
    minWorkers: 1,
    maxWorkers: 20,
    evalIntervalMs: 5000,         // how often the scaler looks at each queue
    scaleInCooldownMs: 30000,     // stops flapping
    startupMs: 3000,              // Fargate task start-up time
    visibilityTimeoutMs: 15000,
    maxReceiveCount: 5,           // then the message moves to the dead-letter queue
    backoffBaseMs: 1000,
    backoffCapMs: 30000,
    heartbeat: true,              // worker extends visibility while it is still working
    duplicateDeliveryProb: 0,     // chance SQS delivers a finished job again
    healthCheckMs: 6000,          // failed worker is detected and replaced after this
    queueDurationMs: { "media-worker": 4000, "notifications": 500, "background": 2000 }
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* The scaling rule from the design: workers = ceil(B x s / T). */
  function requiredWorkers(backlog, secPerJob, targetWaitSec) {
    if (backlog <= 0) return 0;
    return Math.ceil(Math.round((backlog * secPerJob / targetWaitSec) * 1e6) / 1e6);
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }

  function createEngine(options) {
    options = options || {};
    var seed = options.seed == null ? 1 : options.seed;
    var rnd, cfg, now, q, workers, jobs, idem, stats, events, samples, lat, counters, nextSample, jobSeq;

    function reset() {
      rnd = mulberry32(seed);
      cfg = JSON.parse(JSON.stringify(DEFAULTS));
      Object.keys(options.config || {}).forEach(function (k) { cfg[k] = options.config[k]; });
      now = 0; jobSeq = 1000; nextSample = 0;
      jobs = {}; idem = {}; events = []; samples = []; lat = { wait: [], total: [] };
      stats = { submitted: 0, completed: 0, attempts: 0, failedAttempts: 0, retries: 0, dead: 0,
                redelivered: 0, suppressed: 0, deduped: 0, redriven: 0, crashes: 0 };
      counters = {};
      q = {};
      QUEUES.forEach(function (name) {
        q[name] = { name: name, ready: [], head: 0, hidden: [], dlq: [],
                    ema: cfg.queueDurationMs[name] / 1000, nextEval: cfg.evalIntervalMs,
                    lastScaleAt: 0, desired: cfg.minWorkers, completed: 0 };
        counters[name] = 0;
      });
      workers = [];
      QUEUES.forEach(function (name) {
        for (var i = 0; i < cfg.minWorkers; i++) spawn(name, true);
      });
    }

    function log(type, text, queue) {
      events.unshift({ t: now, type: type, text: text, queue: queue || "" });
      if (events.length > 200) events.length = 200;
    }

    function spawn(queue, warm) {
      counters[queue]++;
      var w = { id: queue + "-" + (counters[queue] < 10 ? "0" : "") + counters[queue], queue: queue,
                state: warm ? "idle" : "starting", readyAt: warm ? 0 : now + cfg.startupMs,
                paused: false, job: null, msg: null, receipt: 0, finishAt: 0, willFail: false,
                failedAt: 0, processed: 0, util: 0, started: now };
      workers.push(w);
      return w;
    }

    function readyCount(qq) { return qq.ready.length - qq.head; }

    function enqueue(qq, msg) {
      msg.state = "ready";
      qq.ready.push(msg);
    }

    function hide(qq, msg, until, why) {
      msg.state = why;               // "inflight" or "delayed"
      msg.visibleAt = until;
      qq.hidden.push(msg);
    }

    /* ---------- public actions ---------- */

    function submit(job) {
      job = job || {};
      var queue = QUEUES.indexOf(job.queue) >= 0 ? job.queue : "background";
      var key = job.idemKey ? String(job.idemKey).slice(0, 64) : "";
      if (key && idem[key]) {
        stats.deduped++;
        log("duplicate", "Submission ignored: key \"" + key + "\" already used by " + idem[key], queue);
        return { ok: true, duplicate: true, id: idem[key], queue: jobs[idem[key]].queue };
      }
      jobSeq++;
      var id = "JOB-" + jobSeq;
      var dur = Number(job.durationMs);
      if (!isFinite(dur) || dur <= 0) dur = cfg.queueDurationMs[queue];
      var rec = { id: id, queue: queue, name: String(job.name || "Job").slice(0, 60),
                  durationMs: clamp(dur, 50, 120000), failProb: clamp(Number(job.failProb) || 0, 0, 1),
                  createdAt: now, firstStartAt: null, completedAt: null, status: "queued", receives: 0 };
      jobs[id] = rec;
      if (key) idem[key] = id;
      stats.submitted++;
      enqueue(q[queue], { id: id, queue: queue, receiveCount: 0, visibleAt: 0 });
      return { ok: true, duplicate: false, id: id, queue: queue };
    }

    function burst(spec) {
      spec = spec || {};
      var n = clamp(Math.floor(Number(spec.count) || 0), 0, 5000);
      var ids = [];
      for (var i = 0; i < n; i++) {
        var queue = spec.queue === "mixed" || !spec.queue ? QUEUES[i % QUEUES.length] : spec.queue;
        ids.push(submit({ queue: queue, name: spec.name || "Burst job", durationMs: spec.durationMs, failProb: spec.failProb }).id);
      }
      if (n) log("submit", "Burst of " + n + " jobs submitted" + (spec.queue && spec.queue !== "mixed" ? " to " + spec.queue : ""), spec.queue);
      return { ok: true, count: n };
    }

    function findWorker(id) { return workers.filter(function (w) { return w.id === id; })[0]; }

    function killWorker(id) {
      var w = findWorker(id);
      if (!w || w.state === "failed") return { ok: false };
      w.state = "failed"; w.failedAt = now; stats.crashes++;
      // The job it held is NOT released: it stays hidden until its visibility timeout runs out.
      log("worker-failed", w.id + " crashed" + (w.job ? " while running " + w.job : ""), w.queue);
      return { ok: true };
    }

    function recoverWorker(id) {
      var w = findWorker(id);
      if (!w || w.state !== "failed") return { ok: false };
      replace(w);
      return { ok: true };
    }

    function replace(w) {
      workers.splice(workers.indexOf(w), 1);
      var n = spawn(w.queue, false);
      log("worker-replaced", w.id + " replaced by " + n.id, w.queue);
    }

    function pauseWorker(id) {
      var w = findWorker(id);
      if (!w) return { ok: false };
      w.paused = !w.paused;
      log("worker-paused", w.id + (w.paused ? " paused" : " resumed"), w.queue);
      return { ok: true, paused: w.paused };
    }

    /* Operator fixes the root cause (failProb -> 0) and moves dead jobs back to the source queue. */
    function redrive(queue, fixCause) {
      var qq = q[queue];
      if (!qq) return { ok: false };
      var n = qq.dlq.length;
      qq.dlq.forEach(function (m) {
        var j = jobs[m.id];
        if (fixCause) j.failProb = 0;
        j.status = "queued";
        m.receiveCount = 0; stats.dead--; stats.redriven++;
        enqueue(qq, m);
      });
      qq.dlq = [];
      if (n) log("redrive", n + " job" + (n > 1 ? "s" : "") + " redriven from DLQ" + (fixCause ? " after fixing the cause" : ""), queue);
      return { ok: true, count: n };
    }

    function setConfig(patch) {
      patch = patch || {};
      var num = function (k, lo, hi) { if (patch[k] != null && isFinite(Number(patch[k]))) cfg[k] = clamp(Number(patch[k]), lo, hi); };
      num("targetWaitSec", 1, 3600); num("minWorkers", 0, 50); num("maxWorkers", 1, 100);
      num("evalIntervalMs", 500, 60000); num("scaleInCooldownMs", 0, 600000); num("startupMs", 0, 60000);
      num("visibilityTimeoutMs", 1000, 600000); num("maxReceiveCount", 1, 20);
      num("duplicateDeliveryProb", 0, 1); num("healthCheckMs", 500, 120000);
      if (patch.autoscale != null) cfg.autoscale = !!patch.autoscale;
      if (patch.heartbeat != null) cfg.heartbeat = !!patch.heartbeat;
      if (cfg.maxWorkers < cfg.minWorkers) cfg.maxWorkers = cfg.minWorkers;
      return { ok: true, config: cfg };
    }

    /* ---------- the simulation step ---------- */

    function receive(w) {
      var qq = q[w.queue];
      while (qq.head < qq.ready.length) {
        var m = qq.ready[qq.head++];
        if (qq.head > 512 && qq.head * 2 > qq.ready.length) { qq.ready = qq.ready.slice(qq.head); qq.head = 0; }
        var j = jobs[m.id];
        if (j.status === "completed") {            // a repeat delivery of finished work
          stats.suppressed++;
          log("suppressed", m.id + " delivered again; already done, dropped without re-running", w.queue);
          continue;
        }
        if (m.receiveCount >= cfg.maxReceiveCount) {  // too many tries: move aside
          j.status = "dead"; stats.dead++; qq.dlq.push(m); m.state = "dead";
          log("dead", m.id + " moved to dead-letter queue after " + m.receiveCount + " tries", w.queue);
          continue;
        }
        m.receiveCount++; j.receives++; stats.attempts++;
        if (j.firstStartAt == null) { j.firstStartAt = now; lat.wait.push((now - j.createdAt) / 1000); if (lat.wait.length > 2000) lat.wait.shift(); }
        j.status = "processing";
        w.job = m.id; w.msg = m; w.receipt = ++receiptSeq;
        m.receipt = w.receipt;
        hide(qq, m, now + cfg.visibilityTimeoutMs, "inflight");
        w.willFail = rnd() < j.failProb;
        w.finishAt = now + j.durationMs * (0.8 + rnd() * 0.4);
        w.state = "busy";
        return;
      }
    }
    var receiptSeq = 0;

    function finish(w) {
      var m = w.msg, j = jobs[m.id], qq = q[w.queue];
      var mine = m.receipt === w.receipt && m.state === "inflight";
      if (w.willFail) {
        stats.failedAttempts++; stats.retries++;
        j.status = "queued";
        if (mine) {
          var back = Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * Math.pow(2, m.receiveCount - 1)) * (0.5 + rnd() * 0.5);
          qq.hidden.splice(qq.hidden.indexOf(m), 1);
          hide(qq, m, now + back, "delayed");
        }
        log("retry", m.id + " failed on try " + m.receiveCount + "; retry in " + (mine ? Math.round(Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * Math.pow(2, m.receiveCount - 1)) / 1000 * 10) / 10 + "s max" : "timeout"), w.queue);
      } else {
        if (j.status !== "completed") {            // idempotent: first writer wins
          j.status = "completed"; j.completedAt = now; stats.completed++; qq.completed++;
          lat.total.push((now - j.createdAt) / 1000); if (lat.total.length > 2000) lat.total.shift();
          qq.ema = qq.ema * 0.8 + (j.durationMs / 1000) * 0.2;
          if (rnd() < cfg.duplicateDeliveryProb) enqueue(qq, { id: m.id, queue: w.queue, receiveCount: 0, visibleAt: 0 });
        }
        if (mine) { qq.hidden.splice(qq.hidden.indexOf(m), 1); m.state = "deleted"; }
        log("complete", m.id + " completed by " + w.id, w.queue);
      }
      w.processed++; w.job = null; w.msg = null;
      w.state = "idle";
    }

    function liveCount(name) {
      return workers.filter(function (w) { return w.queue === name && w.state !== "failed"; }).length;
    }

    function scale(name) {
      var qq = q[name];
      var B = readyCount(qq);
      var need = requiredWorkers(B, qq.ema, cfg.targetWaitSec);
      var desired = clamp(need, cfg.minWorkers, cfg.maxWorkers);
      qq.desired = desired;
      if (!cfg.autoscale) return;
      var have = liveCount(name);
      if (desired > have) {
        for (var i = 0; i < desired - have; i++) spawn(name, false);
        qq.lastScaleAt = now;
        log("scale-out", name + ": backlog " + B + " needs " + desired + " workers, adding " + (desired - have), name);
      } else if (desired < have && now - qq.lastScaleAt >= cfg.scaleInCooldownMs) {
        var idle = workers.filter(function (w) { return w.queue === name && (w.state === "idle" || w.state === "starting"); });
        var drop = Math.min(have - desired, idle.length);
        for (var k = 0; k < drop; k++) workers.splice(workers.indexOf(idle[k]), 1);
        if (drop) { qq.lastScaleAt = now; log("scale-in", name + ": backlog cleared, removing " + drop + " idle worker" + (drop > 1 ? "s" : ""), name); }
      }
    }

    function sample() {
      var depth = 0, inflight = 0, dlq = 0, up = 0, busy = 0;
      QUEUES.forEach(function (n) { depth += readyCount(q[n]); dlq += q[n].dlq.length;
        inflight += q[n].hidden.filter(function (m) { return m.state === "inflight"; }).length; });
      workers.forEach(function (w) { if (w.state !== "failed") up++; if (w.state === "busy") busy++; });
      var prev = samples.length ? samples[samples.length - 1] : null;
      samples.push({ t: now / 1000, depth: depth, inflight: inflight, dlq: dlq, workers: up, busy: busy,
                     throughput: prev ? stats.completed - prev.completedTotal : 0, completedTotal: stats.completed });
      if (samples.length > 300) samples.shift();
    }

    function step() {
      now += STEP_MS;
      QUEUES.forEach(function (n) {
        var qq = q[n], keep = [];
        qq.hidden.forEach(function (m) {
          if (m.state === "deleted") return;
          if (now >= m.visibleAt) {
            if (m.state === "inflight") { stats.redelivered++; log("redelivered", m.id + " visibility timeout expired; back in the queue", n); }
            enqueue(qq, m);
          } else keep.push(m);
        });
        qq.hidden = keep;
      });
      workers.slice().forEach(function (w) {
        if (w.state === "failed") { if (now - w.failedAt >= cfg.healthCheckMs) replace(w); return; }
        if (w.state === "starting" && now >= w.readyAt) w.state = "idle";
        if (w.state === "busy") {
          if (cfg.heartbeat && w.msg.receipt === w.receipt && w.msg.state === "inflight") w.msg.visibleAt = now + cfg.visibilityTimeoutMs;
          if (now >= w.finishAt) finish(w);
        }
        if (w.state === "idle" && !w.paused) receive(w);
        w.util += ((w.state === "busy" ? 1 : 0) - w.util) * 0.02;
      });
      QUEUES.forEach(function (n) {
        if (now >= q[n].nextEval) { q[n].nextEval = now + cfg.evalIntervalMs; scale(n); }
      });
      if (now >= nextSample) { nextSample = now + 1000; sample(); }
    }

    function advance(ms) {
      var steps = Math.floor(ms / STEP_MS);
      for (var i = 0; i < steps; i++) step();
    }

    /* Run until nothing is waiting or running (for tests and benchmarks). */
    function runUntilIdle(maxMs) {
      var limit = now + (maxMs || 3600000);
      while (now < limit) {
        step();
        var busy = QUEUES.some(function (n) { return readyCount(q[n]) || q[n].hidden.length; }) || workers.some(function (w) { return w.state === "busy"; });
        if (!busy) break;
      }
    }

    function snapshot() {
      var sw = lat.wait.slice().sort(function (a, b) { return a - b; });
      var st = lat.total.slice().sort(function (a, b) { return a - b; });
      var qs = QUEUES.map(function (n) {
        var qq = q[n], ws = { starting: 0, idle: 0, busy: 0, paused: 0, failed: 0 };
        workers.forEach(function (w) { if (w.queue === n) ws[w.paused && w.state === "idle" ? "paused" : w.state]++; });
        var oldest = 0;
        for (var i = qq.head; i < Math.min(qq.ready.length, qq.head + 1); i++) oldest = (now - jobs[qq.ready[i].id].createdAt) / 1000;
        return { name: n, visible: readyCount(qq), inflight: qq.hidden.filter(function (m) { return m.state === "inflight"; }).length,
                 delayed: qq.hidden.filter(function (m) { return m.state === "delayed"; }).length, dlq: qq.dlq.length,
                 workers: ws, desired: qq.desired, secPerJob: Math.round(qq.ema * 100) / 100,
                 requiredNow: requiredWorkers(readyCount(qq), qq.ema, cfg.targetWaitSec), oldestAgeSec: Math.round(oldest * 10) / 10,
                 completed: qq.completed };
      });
      var recent = samples.slice(-60), att = 0, fail = 0;
      var alarms = [];
      qs.forEach(function (x) {
        alarms.push({ name: "DLQ not empty (" + x.name + ")", firing: x.dlq > 0, detail: x.dlq + " dead job" + (x.dlq === 1 ? "" : "s") });
        alarms.push({ name: "Backlog age high (" + x.name + ")", firing: x.oldestAgeSec > cfg.targetWaitSec * 2, detail: x.oldestAgeSec + "s oldest, limit " + cfg.targetWaitSec * 2 + "s" });
        alarms.push({ name: "Fleet below minimum (" + x.name + ")", firing: liveCount(x.name) < cfg.minWorkers, detail: liveCount(x.name) + " live, min " + cfg.minWorkers });
      });
      var failRate = stats.attempts ? stats.failedAttempts / stats.attempts : 0;
      alarms.push({ name: "Failure rate above 5%", firing: stats.attempts >= 20 && failRate > 0.05, detail: Math.round(failRate * 1000) / 10 + "% of attempts" });
      return {
        timeSec: now / 1000, config: JSON.parse(JSON.stringify(cfg)), queues: qs, totals: JSON.parse(JSON.stringify(stats)),
        workers: workers.map(function (w) { return { id: w.id, queue: w.queue, state: w.paused && w.state === "idle" ? "paused" : w.state,
                                                  job: w.job, processed: w.processed, util: Math.round(w.util * 100) }; }),
        latency: { waitP50: percentile(sw, 0.5), waitP95: percentile(sw, 0.95), totalP50: percentile(st, 0.5), totalP95: percentile(st, 0.95) },
        history: samples, events: events.slice(0, 60), alarms: alarms, failRate: failRate
      };
    }

    reset();
    return { submit: submit, burst: burst, advance: advance, runUntilIdle: runUntilIdle, killWorker: killWorker,
             recoverWorker: recoverWorker, pauseWorker: pauseWorker, redrive: redrive, setConfig: setConfig,
             snapshot: snapshot, reset: reset, now: function () { return now; }, job: function (id) { return jobs[id]; } };
  }

  return { createEngine: createEngine, requiredWorkers: requiredWorkers, QUEUES: QUEUES, DEFAULTS: DEFAULTS };
});
