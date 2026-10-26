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
  var failed = state.workers.filter(function (w) { return w.status === "failed"; }).length;
  var idle = state.workers.filter(function (w) { return w.status === "idle"; }).length;
  var text, color;
  if (failed) { text = "Degraded — simulated failure active"; color = "#fb923c"; }
  else if (idle) { text = "Partially available — demo only"; color = "#fb923c"; }
  else { text = "All systems operational"; color = "#4ade80"; }
  el.textContent = text;
  if (dot) {
    dot.style.background = color;
    dot.style.boxShadow = "0 0 12px " + color + "60";
  }
}

function updateOverviewMetrics(state) {
  var processedEl = $("processed");
  if (processedEl) processedEl.textContent = formatNumber(state.processed);
  var depthEl = $("depth");
  if (depthEl) depthEl.textContent = formatNumber(state.depth);
  var failedEl = $("failed");
  if (failedEl) failedEl.textContent = formatNumber(state.failed);

  var activeCount = state.workers.filter(function (w) { return w.status === "active"; }).length;
  var workerPct = Math.round((activeCount / state.totalWorkers) * 100);
  var workersEl = $("workers");
  if (workersEl) workersEl.innerHTML = activeCount + '<span class="value-unit"> / ' + state.totalWorkers + "</span>";
  var workerBar = $("workerBar");
  if (workerBar) workerBar.style.width = workerPct + "%";
  var ovWorkerPct = $("ovWorkerPct");
  if (ovWorkerPct) ovWorkerPct.textContent = workerPct + "%";

  var failureRate = (state.failed / (state.processed + state.failed)) * 100;
  var ovFailPct = $("ovFailPct");
  if (ovFailPct) ovFailPct.textContent = failureRate.toFixed(2) + "%";

  var throughputEl = $("throughput");
  if (throughputEl) throughputEl.textContent = formatNumber(Math.round(average(state.history["1H"].throughput)));

  // job distribution derived from the most recent logged events
  var recent = state.events.slice(0, 25);
  var completedCount = 0, pendingCount = 0, failedCount = 0;
  recent.forEach(function (e) {
    if (e.status === "Completed") completedCount++;
    else if (e.status === "Pending") pendingCount++;
    else failedCount++;
  });
  var total = recent.length || 1;
  var completedFrac = (completedCount / total) * 100;
  var pendingFrac = (pendingCount / total) * 100;
  var failedFrac = (failedCount / total) * 100;
  var donut = $("jobDonut");
  if (donut) {
    donut.style.background = "conic-gradient(#5eead4 0 " + completedFrac + "%, #a78bfa " +
      completedFrac + "% " + (completedFrac + pendingFrac) + "%, #fb923c " +
      (completedFrac + pendingFrac) + "% 100%)";
  }
  var completedPctValue = Math.round(completedFrac);
  var pendingPctValue = Math.round(pendingFrac);
  var failedPctValue = Math.round(failedFrac);
  var totalJobs = $("totalJobs");
  if (totalJobs) totalJobs.textContent = String(total);
  var completedPct = $("completedPct");
  if (completedPct) completedPct.textContent = completedPctValue + "%";
  var pendingPct = $("pendingPct");
  if (pendingPct) pendingPct.textContent = pendingPctValue + "%";
  var failedPct = $("failedPct");
  if (failedPct) failedPct.textContent = failedPctValue + "%";

  updateSystemStatus(state);
}

function renderRecentActivity(state) {
  var tbody = $("activityBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  var events = state.events.slice().sort(function (a, b) { return b.time - a.time; });
  events.slice(0, 6).forEach(function (event) {
    var tr = document.createElement("tr");
    tr.innerHTML = '<td class="job-id">' + event.id + "</td><td>" + event.name +
      "</td><td>" + event.queue + "</td><td>" + statusBadge(event.status) +
      "</td><td>" + formatRelativeTime(event.time) + "</td>";
    tbody.appendChild(tr);
  });
}

function initOverview(state) {
  updateOverviewMetrics(state);
  renderRecentActivity(state);
  drawLineChart($("throughputChart"), state.history["1H"].throughput);

  var refreshBtn = $("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", function () {
    refreshState(state);
    updateOverviewMetrics(state);
    renderRecentActivity(state);
    drawLineChart($("throughputChart"), state.history["1H"].throughput);
    refreshBtn.textContent = "✓ Updated";
    setTimeout(function () { refreshBtn.textContent = "↻ Refresh data"; }, 1000);
  });

  var demoBtn = $("demoBtn");
  if (demoBtn) demoBtn.addEventListener("click", function () {
    createEvent(state, 0);
    saveState(state);
    renderRecentActivity(state);
    updateOverviewMetrics(state);
    showToast("Demo event generated (simulated)");
  });

  window.addEventListener("resize", function () {
    drawLineChart($("throughputChart"), state.history["1H"].throughput);
  });
}

/* ---------- metrics page ---------- */

var RANGE_LABELS = {
  "1H":  ["-60m", "-50m", "-40m", "-30m", "-20m", "-10m", "Now"],
  "6H":  ["-6h", "-5h", "-4h", "-3h", "-2h", "-1h", "Now"],
  "24H": ["-24h", "-20h", "-16h", "-12h", "-8h", "-4h", "Now"],
  "7D":  ["-7d", "-6d", "-5d", "-4d", "-3d", "-2d", "Now"]
};
var RANGE_PERIOD_LABEL = {
  "1H": "LAST 60 MINUTES", "6H": "LAST 6 HOURS", "24H": "LAST 24 HOURS", "7D": "LAST 7 DAYS"
};

function setAxis(id, range) {
  var axis = $(id);
  if (!axis) return;
  axis.innerHTML = "";
  (RANGE_LABELS[range] || []).forEach(function (label) {
    var span = document.createElement("span");
    span.textContent = label;
    axis.appendChild(span);
  });
}

function average(values) {
  return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
}

function renderUtilizationList(state) {
  var list = $("utilizationList");
  if (!list) return;
  list.innerHTML = "";
  state.workers.forEach(function (w) {
    var pct = w.status === "active" ? w.util : 0;
    var row = document.createElement("div");
    row.className = "util-row";
    row.innerHTML = '<span class="util-name">' + w.name + '</span>' +
      '<div class="util-track"><span style="width:' + pct + '%"></span></div>' +
      '<span class="util-pct">' + pct + "%</span>";
    list.appendChild(row);
  });
}

function renderMetrics(state, range) {
  var data = state.history[range];
  drawLineChart($("metricsThroughput"), data.throughput, { color: "#5eead4" });
  drawLineChart($("depthChart"), data.depth, { color: "#a78bfa" });
  drawLineChart($("failureChart"), data.failure, { color: "#fb923c" });
  setAxis("throughputAxis", range);
  setAxis("depthAxis", range);
  setAxis("failureAxis", range);

  var mAvgThroughput = $("mAvgThroughput");
  if (mAvgThroughput) mAvgThroughput.textContent = formatNumber(Math.round(average(data.throughput)));
  var mPeakDepth = $("mPeakDepth");
  if (mPeakDepth) mPeakDepth.textContent = formatNumber(Math.round(Math.max.apply(null, data.depth)));
  var failureAvg = average(data.failure);
  var mFailureRate = $("mFailureRate");
  if (mFailureRate) mFailureRate.textContent = failureAvg.toFixed(2) + "%";

  var activeWorkers = state.workers.filter(function (w) { return w.status === "active"; });
  var avgUtil = activeWorkers.length
    ? Math.round(activeWorkers.reduce(function (sum, w) { return sum + w.util; }, 0) / activeWorkers.length)
    : 0;
  var mAvgUtil = $("mAvgUtil");
  if (mAvgUtil) mAvgUtil.textContent = avgUtil + "%";
  var mAvgUtilBar = $("mAvgUtilBar");
  if (mAvgUtilBar) mAvgUtilBar.style.width = avgUtil + "%";

  var mTotalFailed = $("mTotalFailed");
  if (mTotalFailed) mTotalFailed.textContent = formatNumber(state.failed);
  var mFailRate = $("mFailRate");
  if (mFailRate) mFailRate.textContent = failureAvg.toFixed(2) + "%";
  var mLastFailure = $("mLastFailure");
  if (mLastFailure) {
    var failedEvents = state.events.filter(function (e) { return e.status === "Failed"; })
      .sort(function (a, b) { return b.time - a.time; });
    mLastFailure.textContent = failedEvents.length ? formatRelativeTime(failedEvents[0].time) : "—";
  }
  var summaryPeriod = $("summaryPeriod");
  if (summaryPeriod) summaryPeriod.textContent = RANGE_PERIOD_LABEL[range] || "";

  renderUtilizationList(state);
}

function initMetrics(state) {
  var range = "1H";
  renderMetrics(state, range);

  var rangeGroup = $("rangeGroup");
  if (rangeGroup) rangeGroup.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".range-btn") : null;
    if (!btn) return;
    range = btn.dataset.range;
    rangeGroup.querySelectorAll(".range-btn").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
    renderMetrics(state, range);
  });

  var refreshBtn = $("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", function () {
    refreshState(state);
    renderMetrics(state, range);
    refreshBtn.textContent = "✓ Updated";
    setTimeout(function () { refreshBtn.textContent = "↻ Refresh data"; }, 1000);
  });

  window.addEventListener("resize", function () { renderMetrics(state, range); });
}

/* ---------- activity page ---------- */

function setSortHeader(th, dir) {
  if (!th) return;
  th.setAttribute("aria-sort", dir === "asc" ? "ascending" : (dir === "desc" ? "descending" : "none"));
  var arrow = th.querySelector(".sort-arrow");
  if (arrow) arrow.textContent = dir === "asc" ? "▲" : (dir === "desc" ? "▼" : "↕");
}

function renderActivity(state, filters) {
  var tbody = $("activityBody");
  if (!tbody) return;
  var events = state.events.slice();
  if (filters.search) {
    events = events.filter(function (e) {
      return e.id.toLowerCase().indexOf(filters.search) !== -1 ||
        e.name.toLowerCase().indexOf(filters.search) !== -1;
    });
  }
  if (filters.status !== "all") {
    events = events.filter(function (e) { return e.status === filters.status; });
  }
  events.sort(function (a, b) {
    var result;
    if (filters.sortKey === "time") result = a.time - b.time;
    else if (filters.sortKey === "id") {
      result = parseInt(a.id.replace("JOB-", ""), 10) - parseInt(b.id.replace("JOB-", ""), 10);
    } else {
      result = String(a[filters.sortKey]).localeCompare(String(b[filters.sortKey]));
    }
    return filters.sortDir === "asc" ? result : -result;
  });

  tbody.innerHTML = "";
  events.forEach(function (event) {
    var tr = document.createElement("tr");
    tr.innerHTML = '<td class="job-id">' + event.id + "</td><td>" + event.name +
      "</td><td>" + event.queue + "</td><td>" + statusBadge(event.status) +
      '</td><td title="' + new Date(event.time).toLocaleString() + '">' +
      formatRelativeTime(event.time) + "</td>";
    tbody.appendChild(tr);
  });

  var emptyState = $("emptyState");
  if (emptyState) emptyState.hidden = events.length > 0;
  var resultCount = $("resultCount");
  if (resultCount) {
    resultCount.textContent = "Showing " + events.length + " of " + state.events.length + " events";
  }
}

function initActivity(state) {
  var filters = { search: "", status: "all", sortKey: "time", sortDir: "desc" };
  renderActivity(state, filters);

  var searchInput = $("searchInput");
  if (searchInput) searchInput.addEventListener("input", function () {
    filters.search = searchInput.value.trim().toLowerCase();
    renderActivity(state, filters);
  });

  var statusFilter = $("statusFilter");
  if (statusFilter) statusFilter.addEventListener("click", function (e) {
    var chip = e.target.closest ? e.target.closest(".chip") : null;
    if (!chip) return;
    filters.status = chip.dataset.status;
    statusFilter.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("active", c === chip);
    });
    renderActivity(state, filters);
  });

  function clearFilters() {
    filters.search = "";
    filters.status = "all";
    filters.sortKey = "time";
    filters.sortDir = "desc";
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.status === "all");
    });
    document.querySelectorAll("#activityTable th").forEach(function (th) {
      setSortHeader(th, th.dataset.sort === "time" ? "desc" : null);
    });
    renderActivity(state, filters);
  }

  var clearFiltersBtn = $("clearFiltersBtn");
  if (clearFiltersBtn) clearFiltersBtn.addEventListener("click", clearFilters);
  var emptyClearBtn = $("emptyClearBtn");
  if (emptyClearBtn) emptyClearBtn.addEventListener("click", clearFilters);

  document.querySelectorAll("#activityTable th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.sort;
      if (filters.sortKey === key) {
        filters.sortDir = filters.sortDir === "asc" ? "desc" : "asc";
      } else {
        filters.sortKey = key;
        filters.sortDir = (key === "time" || key === "id") ? "desc" : "asc";
      }
      document.querySelectorAll("#activityTable th").forEach(function (h) {
        setSortHeader(h, h === th ? filters.sortDir : null);
      });
      renderActivity(state, filters);
    });
  });

  var generateEventsBtn = $("generateEventsBtn");
  if (generateEventsBtn) generateEventsBtn.addEventListener("click", function () {
    createEvent(state, 0);
    createEvent(state, 0);
    createEvent(state, 0);
    saveState(state);
    renderActivity(state, filters);
    showToast("3 demo events generated (simulated)");
  });
}

/* ---------- workers page ---------- */

function workerStatusBadge(status) {
  var map = {
    active: ["Active", "success"],
    idle: ["Idle", "idle"],
    failed: ["Failed", "failed"]
  };
  var entry = map[status] || ["Unknown", "idle"];
  return '<span class="status ' + entry[1] + '">' + entry[0] + "</span>";
}

function renderWorkers(state) {
  var grid = $("workerGrid");
  if (!grid) return;
  grid.innerHTML = "";
  state.workers.forEach(function (w) {
    var actions = "";
    if (w.status === "active") {
      actions = '<button class="btn-sm secondary-button" data-action="pause" data-worker="' + w.id + '">Pause</button>' +
        '<button class="btn-sm danger-button" data-action="fail" data-worker="' + w.id + '">Simulate failure</button>';
    } else if (w.status === "idle") {
      actions = '<button class="btn-sm primary-button" data-action="resume" data-worker="' + w.id + '">Resume</button>' +
        '<button class="btn-sm danger-button" data-action="fail" data-worker="' + w.id + '">Simulate failure</button>';
    } else {
      actions = '<button class="btn-sm primary-button" data-action="recover" data-worker="' + w.id + '">Recover worker</button>';
    }
    var card = document.createElement("article");
    card.className = "worker-card";
    card.innerHTML =
      '<div class="worker-head"><div><strong>' + w.name + "</strong><small>queue: " + w.queue + "</small></div>" +
      workerStatusBadge(w.status) + "</div>" +
      '<div class="worker-stats"><div><span>JOBS PROCESSED</span><strong>' + formatNumber(w.jobs) + "</strong></div>" +
      '<div><span>UTILIZATION</span><strong>' + (w.status === "active" ? w.util + "%" : "—") + "</strong></div></div>" +
      '<div class="utilization-track"><span style="width:' + (w.status === "active" ? w.util : 0) + '%"></span></div>' +
      '<div class="worker-actions">' + actions + "</div>";
    grid.appendChild(card);
  });
  var summary = $("workerSummary");
  if (summary) {
    var active = state.workers.filter(function (w) { return w.status === "active"; }).length;
    var idle = state.workers.filter(function (w) { return w.status === "idle"; }).length;
    var failed = state.workers.filter(function (w) { return w.status === "failed"; }).length;
    summary.textContent = active + " active · " + idle + " idle · " + failed + " failed";
  }
  updateSystemStatus(state);
}

function renderQueues(state) {
  var grid = $("queueGrid");
  if (!grid) return;
  grid.innerHTML = "";
  state.queues.forEach(function (q) {
    var card = document.createElement("article");
    card.className = "queue-card";
    card.innerHTML =
      '<div class="worker-head"><div><strong>' + q.name + "</strong><small>queue</small></div>" +
      '<span class="status pending">' + formatNumber(q.pending) + " pending</span></div>" +
      '<div class="worker-stats"><div><span>PROCESSING</span><strong>' + q.processing + "</strong></div>" +
      '<div><span>WAITING</span><strong>' + q.pending + "</strong></div></div>" +
      '<button class="btn-sm secondary-button" data-action="add-job" data-queue="' + q.name + '">+ Add job</button>';
    grid.appendChild(card);
  });
}

function initWorkers(state) {
  renderWorkers(state);
  renderQueues(state);

  var workerGrid = $("workerGrid");
  if (workerGrid) workerGrid.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
    if (!btn) return;
    var worker = state.workers.find(function (w) { return w.id === btn.dataset.worker; });
    if (!worker) return;
    var action = btn.dataset.action;
    if (action === "pause") {
      worker.status = "idle";
      worker.util = 0;
      showToast(worker.name + " paused (simulated)");
    } else if (action === "resume" || action === "recover") {
      worker.status = "active";
      worker.util = 55 + Math.floor(Math.random() * 30);
      showToast(worker.name + (action === "resume" ? " resumed" : " recovered") + " (simulated)");
    } else if (action === "fail") {
      worker.status = "failed";
      worker.util = 0;
      showToast(worker.name + " failure simulated");
    }
    saveState(state);
    renderWorkers(state);
  });

  var queueGrid = $("queueGrid");
  if (queueGrid) queueGrid.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button[data-action='add-job']") : null;
    if (!btn) return;
    var queue = state.queues.find(function (q) { return q.name === btn.dataset.queue; });
    if (!queue) return;
    queue.pending++;
    state.depth = state.queues.reduce(function (sum, q) { return sum + q.pending; }, 0);
    saveState(state);
    renderQueues(state);
    showToast("Job added to " + queue.name + " queue (simulated)");
  });

  var refreshBtn = $("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", function () {
    refreshState(state);
    renderWorkers(state);
    renderQueues(state);
    refreshBtn.textContent = "✓ Updated";
    setTimeout(function () { refreshBtn.textContent = "↻ Refresh data"; }, 1000);
  });
}

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", function () {
  var state = loadState();
  updateSystemStatus(state);
  var page = document.body.dataset.page || "overview";
  if (page === "overview") initOverview(state);
  else if (page === "metrics") initMetrics(state);
  else if (page === "activity") initActivity(state);
  else if (page === "workers") initWorkers(state);
  // about page needs no scripts — shared layout only
});
