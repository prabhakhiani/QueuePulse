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
      if (parsed && parsed.history && parsed.events &&
