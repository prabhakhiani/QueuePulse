/* QueuePulse — shared dashboard script (used by every page).
   Detects the current page via <body data-page="..."> and runs only
   what that page needs. Demo data is stored in sessionStorage so all
   pages show consistent simulated numbers. No external libraries. */
"use strict";

var $ = function (id) { return document.getElementById(id); };
var STORAGE_KEY = "queuepulse-state-v1";

var EVENT_NAMES = [
  "Image processing",
  "Email delivery",
  "Report generation",
  "Data synchronization",
  "Thumbnail creation",
  "Video transcoding",
  "CSV export",
  "Webhook delivery"
];
var QUEUES = ["media-worker", "notifications", "background"];

/* ---------- helpers ---------- */

function randomItem(list) { return list[Math.floor(Math.random() * list.length)]; }

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function formatNumber(value) { return value.toLocaleString("en-US"); }

function formatRelativeTime(time) {
  var diff = Date.now() - time;
  if (diff < 60000) return "Just now";
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + " min ago";
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + " h ago";
  return Math.floor(hours / 24) + " d ago";
}

var toastTimer = null;
function showToast(message) {
  var toast = $("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
}

/* ---------- shared demo state ---------- */

/* Deterministic pseudo-random generator — every page load seeds the same
   default demo data, so pages look consistent even without storage. */
function seededRandom(seed) {
  var s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function seedSeries(base, spread, count, rnd) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push(Math.round((base + (rnd() - 0.5) * spread) * 100) / 100);
  }
  return out;
}

function defaultState() {
  var now = Date.now();
  var rnd = seededRandom(20260101);
  var state = {
    processed: 12840,
    depth: 284,
    failed: 23,
    totalWorkers: 10,
    eventNumber: 1048,
    history: {
      "1H":  { throughput: seedSeries(2100, 180, 16, rnd), depth: seedSeries(284, 40, 16, rnd),  failure: seedSeries(0.22, 0.12, 16, rnd) },
      "6H":  { throughput: seedSeries(1950, 260, 16, rnd), depth: seedSeries(300, 70, 16, rnd),  failure: seedSeries(0.26, 0.16, 16, rnd) },
      "24H": { throughput: seedSeries(1800, 340, 16, rnd), depth: seedSeries(330, 110, 16, rnd), failure: seedSeries(0.31, 0.20, 16, rnd) },
      "7D":  { throughput: seedSeries(1650, 420, 16, rnd), depth: seedSeries(360, 150, 16, rnd), failure: seedSeries(0.35, 0.22, 16, rnd) }
    },
    events: [],
    workers: [],
    queues: [
      { name: "media-worker",  pending: 64,  processing: 12 },
      { name: "notifications", pending: 42,  processing: 8 },
      { name: "background",    pending: 178, processing: 18 }
    ]
  };

  var workerDefs = [
    ["media-worker-01", "media-worker"],
    ["media-worker-02", "media-worker"],
    ["media-worker-03", "media-worker"],
    ["background-01", "background"],
    ["background-02", "background"],
    ["background-03", "background"],
    ["notifications-01", "notifications"],
    ["notifications-02", "notifications"],
    ["reports-01", "background"],
    ["reports-02", "background"]
  ];
  workerDefs.forEach(function (def, index) {
    var status = index === 6 ? "idle" : (index === 9 ? "failed" : "active");
    state.workers.push({
      id: "w" + (index + 1),
      name: def[0],
      queue: def[1],
      status: status,
      jobs: 1150 + Math.floor(rnd() * 700),
      util: status === "active" ? 58 + Math.floor(rnd() * 35) : 0
    });
  });

  var seedStatuses = ["Completed", "Completed", "Pending", "Completed", "Failed",
    "Completed", "Completed", "Pending", "Completed", "Completed",
    "Completed", "Failed", "Completed", "Pending"];
  for (var i = 13; i >= 0; i--) {
    state.events.push({
      id: "JOB-" + (1035 + i),
      name: EVENT_NAMES[i % EVENT_NAMES.length],
      queue: QUEUES[i % QUEUES.length],
      status: seedStatuses[13 - i],
      time: now - (14 - i) * 105000
    });
  }
  return state;
}

function loadState() {
  try {
    var raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.history && parsed.events && parsed.workers) return parsed;
    }
  } catch (err) { /* fall through to a fresh state */ }
  var fresh = defaultState();
  saveState(fresh);
  return fresh;
}

function saveState(state) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* ignore */ }
}

function refreshState(state) {
  state.processed += Math.floor(Math.random() * 80) + 20;
  Object.keys(state.history).forEach(function (range) {
    var series = state.history[range];
    series.throughput = series.throughput.map(function (v) {
      return Math.round(clamp(v + (Math.random() - 0.5) * 120, 900, 2600));
    });
    series.depth = series.depth.map(function (v) {
      return Math.round(clamp(v + (Math.random() - 0.5) * 40, 150, 520));
    });
    series.failure = series.failure.map(function (v) {
      return Math.round(clamp(v + (Math.random() - 0.5) * 0.08, 0.05, 0.9) * 100) / 100;
    });
  });
  state.workers.forEach(function (w) {
    if (w.status === "active") {
      w.util = Math.round(clamp(w.util + (Math.random() - 0.5) * 18, 45, 96));
      w.jobs += Math.floor(Math.random() * 6);
    }
  });
  state.queues.forEach(function (q) {
    q.pending = Math.max(4, q.pending + Math.floor(Math.random() * 15) - 7);
    q.processing = Math.max(1, q.processing + Math.floor(Math.random() * 5) - 2);
  });
  state.depth = state.queues.reduce(function (sum, q) { return sum + q.pending; }, 0);
  saveState(state);
}

/* ---------- events ---------- */

function createEvent(state, minutesAgo) {
  state.eventNumber++;
  var outcome = Math.random();
  var status = "Completed";
  if (outcome > 0.88) { status = "Failed"; state.failed++; }
  else if (outcome > 0.65) { status = "Pending"; }
  else { state.processed += Math.floor(Math.random() * 8) + 1; }
  var queueName = randomItem(QUEUES);
  var event = {
    id: "JOB-" + state.eventNumber,
    name: randomItem(EVENT_NAMES),
    queue: queueName,
    status: status,
    time: Date.now() - (minutesAgo || 0) * 60000
  };
  if (status === "Pending") {
    var queue = state.queues.find(function (q) { return q.name === queueName; });
    if (queue) {
      queue.pending++;
      state.depth = state.queues.reduce(function (sum, q) { return sum + q.pending; }, 0);
    }
  }
  state.events.unshift(event);
  if (state.events.length > 40) state.events.length = 40;
  return event;
}

function statusBadge(status) {
  var cls = status === "Completed" ? "success" : (status === "Pending" ? "pending" : "failed");
  return '<span class="status ' + cls + '">' + status + "</span>";
}

/* ---------- canvas line chart (shared) ---------- */

function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
}

function drawLineChart(canvas, values, options) {
  if (!canvas || !values || values.length < 2) return;
  var rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  var opts = options || {};
  var color = opts.color || "#5eead4";
  var dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  var ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var width = rect.width;
  var height = rect.height;
  var pad = { top: 12, right: 8, bottom: 12, left: 8 };
  var graphWidth = width - pad.left - pad.right;
  var graphHeight = height - pad.top - pad.bottom;
  var dataMax = Math.max.apply(null, values);
  var max = opts.max || (dataMax * 1.15 || 1);
  ctx.clearRect(0, 0, width, height);
  // horizontal grid lines
  ctx.strokeStyle = "#263246";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  for (var i = 0; i < 5; i++) {
    var gy = pad.top + (graphHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(width - pad.right, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  var points = values.map(function (value, index) {
    return {
      x: pad.left + (index / (values.length - 1)) * graphWidth,
      y: pad.top + graphHeight - (value / max) * graphHeight
    };
  });
  // filled area under the line
  var gradient = ctx.createLinearGradient(0, pad.top, 0, height);
  gradient.addColorStop(0, hexToRgba(color, 0.24));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.beginPath();
  ctx.moveTo(points[0].x, height - pad.bottom);
  points.forEach(function (p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(points[points.length - 1].x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  // smooth line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (var j = 1; j < points.length; j++) {
    var prev = points[j - 1];
    var cur = points[j];
    var midX = (prev.x + cur.x) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, (prev.y + cur.y) / 2);
  }
  var last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  // latest point marker
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.strokeStyle = hexToRgba(color, 0.28);
  ctx.lineWidth = 4;
  ctx.stroke();
}

/* ---------- overview page ---------- */

function updateSystemStatus(state) {
  var el = $("demoStatus");
  if (!el) return;
  var dot = $("statusDot");
  var failed = state.workers.filter(function
