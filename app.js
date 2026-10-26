
const $ = (id) => document.getElementById(id);

const state = {
  processed: 12840,
  depth: 284,
  failed: 23,
  workers: 8,
  eventNumber: 1048
};

const throughputValues = [38, 44, 40, 54, 49, 61, 57, 69, 62, 76, 70, 85, 73, 91, 82, 96];

function drawThroughputChart() {
  const canvas = $("throughputChart");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const pad = { top: 12, right: 8, bottom: 12, left: 8 };
  const graphWidth = width - pad.left - pad.right;
  const graphHeight = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);

  // Horizontal grid lines
  ctx.strokeStyle = "#263246";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);

  for (let i = 0; i < 5; i++) {
    const y = pad.top + (graphHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.setLineDash([]);

  const points = throughputValues.map((value, index) => ({
    x: pad.left + (index / (throughputValues.length - 1)) * graphWidth,
    y: pad.top + graphHeight - (value / 110) * graphHeight
  }));

  // Filled area under the line
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height);
  gradient.addColorStop(0, "rgba(94, 234, 212, 0.24)");
  gradient.addColorStop(1, "rgba(94, 234, 212, 0)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - pad.bottom);

  points.forEach((point) => ctx.lineTo(point.x, point.y));

  ctx.lineTo(points[points.length - 1].x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Smooth-ish line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const middleX = (previous.x + current.x) / 2;

    ctx.quadraticCurveTo(previous.x, previous.y, middleX, (previous.y + current.y) / 2);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);

  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Latest point
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#5eead4";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(94, 234, 212, 0.28)";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function updateMetrics() {
  $("processed").textContent = state.processed.toLocaleString();
  $("depth").textContent = state.depth.toLocaleString();
  $("failed").textContent = state.failed.toLocaleString();
  $("workers").innerHTML = `${state.workers}<span class="value-unit"> / 10</span>`;
  $("workerBar").style.width = `${state.workers * 10}%`;

  $("throughput").textContent = Math.round(state.processed / 6).toLocaleString();

  const completed = 72;
  const pending = 20;
  const failed = 8;

  $("totalJobs").textContent = completed + pending + failed;
  $("completedPct").textContent = `${completed}%`;
  $("pendingPct").textContent = `${pending}%`;
  $("failedPct").textContent = `${failed}%`;

  $("jobDonut").style.background =
    `conic-gradient(#5eead4 0 ${completed}%, #a78bfa ${completed}% ${completed + pending}%, #fb923c ${completed + pending}% 100%)`;
}

function addActivityEvent() {
  state.eventNumber++;

  const tbody = $("activityBody");
  const row = document.createElement("tr");

  const jobId = `JOB-${state.eventNumber}`;
  const eventNames = [
    "Image processing",
    "Email delivery",
    "Report generation",
    "Data synchronization",
    "Thumbnail creation"
  ];
  const queues = ["media-worker", "notifications", "background"];
  const eventName = eventNames[Math.floor(Math.random() * eventNames.length)];
  const queue = queues[Math.floor(Math.random() * queues.length)];

  const outcome = Math.random();
  let status = "Completed";
  let statusClass = "success";

  if (outcome > 0.88) {
    status = "Failed";
    statusClass = "failed";
    state.failed++;
  } else if (outcome > 0.65) {
    status = "Pending";
    statusClass = "pending";
  } else {
    state.processed += Math.floor(Math.random() * 8) + 1;
  }

  const values = [jobId, eventName, queue];

  values.forEach((value, index) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (index === 0) cell.className = "job-id";
    row.appendChild(cell);
  });

  const statusCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `status ${statusClass}`;
  badge.textContent = status;
  statusCell.appendChild(badge);
  row.appendChild(statusCell);

  const timeCell = document.createElement("td");
  timeCell.textContent = "Just now";
  row.appendChild(timeCell);

  tbody.prepend(row);

  while (tbody.children.length > 5) {
    tbody.removeChild(tbody.lastElementChild);
  }

  updateMetrics();
}

function refreshDashboard() {
  state.processed += Math.floor(Math.random() * 80) + 20;
  state.depth = Math.max(20, state.depth + Math.floor(Math.random() * 31) - 20);
  state.workers = Math.floor(Math.random() * 3) + 7;

  for (let i = 0; i < throughputValues.length; i++) {
    throughputValues[i] = Math.max(
      20,
      Math.min(105, throughputValues[i] + Math.floor(Math.random() * 25) - 12)
    );
  }

  updateMetrics();
  drawThroughputChart();

  const button = $("refreshBtn");
  button.textContent = "✓ Updated";
  setTimeout(() => {
    button.textContent = "↻ Refresh data";
  }, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  updateMetrics();
  drawThroughputChart();

  $("refreshBtn").addEventListener("click", refreshDashboard);
  $("demoBtn").addEventListener("click", addActivityEvent);

  window.addEventListener("resize", drawThroughputChart);
});
