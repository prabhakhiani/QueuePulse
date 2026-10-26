
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const state = {
    step: 0,
    backlog: 0,
    incoming: 10,
    completed: 10,
    failed: 0,
    workers: 4,
    totalWorkers: 4,
    traffic: 50,
    strategy: "round-robin",
    dbSlow: false,
    running: false,
    cost: 0.02,
    totalIncoming: 10,
    totalCompleted: 10,
    history: [{step:0,incoming:10,completed:10,backlog:0}],
    events: [],
    timer: null,
    spike: false
  };

  const strategyNames = {
    "round-robin": "Round Robin",
    "least-loaded": "Least Loaded",
    "fifo": "First In, First Out (FIFO)"
  };

  const strategyHelp = {
    "round-robin": "Distributes requests across workers in rotation.",
    "least-loaded": "Prioritizes the worker with the lowest simulated load.",
    "fifo": "Processes waiting requests in first-in, first-out order."
  };

  function timeNow() {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[char]);
  }

  function showToast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove("show"), 2500);
  }

  function addEvent(name, outcome, risk="low", decision="Continue") {
    state.events.unshift({
      time: timeNow(), name, outcome, risk, decision
    });
    state.events = state.events.slice(0, 100);
    renderEvents();
  }

  function renderEvents() {
    const list = $("event-list");
    const table = $("event-table-body");

    list.innerHTML = "";
    if (!state.events.length) {
      list.innerHTML = '<div class="empty-state"><strong>No events yet</strong><p>Run a simulation to see activity.</p></div>';
    }

    state.events.slice(0, 5).forEach(event => {
      const row = document.createElement("div");
      row.className = "event-item";
      row.innerHTML = `
        <span class="event-indicator ${event.risk}"></span>
        <div><strong>${escapeHtml(event.name)}</strong>
        <p>${escapeHtml(event.outcome)}</p></div>
        <time>${escapeHtml(event.time)}</time>`;
      list.appendChild(row);
    });

    table.innerHTML = "";
    if (!state.events.length) {
      table.innerHTML = '<tr><td colspan="5" class="table-empty">No events recorded yet.</td></tr>';
    }

    state.events.forEach(event => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(event.time)}</td>
        <td>${escapeHtml(event.name)}</td>
        <td>${escapeHtml(event.outcome)}</td>
        <td><span class="risk risk-${event.risk}">${escapeHtml(event.risk)}</span></td>
        <td>${escapeHtml(event.decision)}</td>`;
      table.appendChild(row);
    });
  }

  function recordHistory() {
    state.history.push({
      step: state.step,
      incoming: state.incoming,
      completed: state.completed,
      backlog: state.backlog
    });
    if (state.history.length > 30) state.history.shift();
  }

  function runStep() {
    state.step++;

    const base = Math.round(state.traffic * 0.22);
    const jitter = Math.floor(Math.random() * 4);
    state.incoming = Math.max(0, base + jitter + (state.spike ? 12 : 0));

    const capacityPerWorker = state.dbSlow ? 4 : 8;
    const strategyBonus = state.strategy === "least-loaded" ? 1 : 0;
    const capacity = Math.max(0, state.workers * capacityPerWorker + strategyBonus);
    const available = state.backlog + state.incoming;

    state.completed = Math.min(available, capacity);
    state.backlog = Math.max(0, available - state.completed);

    if (state.workers === 0) state.failed += state.incoming;

    state.totalIncoming += state.incoming;
    state.totalCompleted += state.completed;
    state.cost += state.workers * 0.0008 + (state.dbSlow ? 0.001 : 0);

    state.spike = false;
    recordHistory();

    const risk = state.backlog > 20 ? "high" : state.backlog > 8 ? "medium" : "low";
    const decision = risk === "high" ? "Monitor capacity" : "Continue";
    addEvent("Workload step",
      `${state.incoming} incoming, ${state.completed} completed, ${state.backlog} queued`,
      risk, decision);

    render();
  }

  function renderMetrics() {
    const capacity = Math.max(1, state.workers * (state.dbSlow ? 4 : 8));
    const cpu = Math.min(100, Math.round(state.completed / capacity * 100));
    const latency = Math.round(20 + state.backlog * 2.7 +
      (state.dbSlow ? 85 : 0) + (state.workers < 4 ? 25 : 0));

    $("metric-incoming").textContent = state.incoming;
    $("metric-completed").textContent = state.completed;
    $("metric-backlog").textContent = state.backlog;
    $("metric-cpu").textContent = `${cpu}%`;
    $("metric-latency").innerHTML = `${latency} <small>ms</small>`;
    $("metric-workers").innerHTML = `${state.workers} <small>/ ${state.totalWorkers}</small>`;
    $("metric-cost").textContent = `₹${state.cost.toFixed(2)}`;

    $("traffic-value").textContent = `${state.traffic}%`;
    $("traffic-level").value = state.traffic;
    $("strategy-select").value = state.strategy;
    $("strategy-info").textContent = strategyHelp[state.strategy];

    $("overview-total").textContent = state.totalIncoming;
    $("overview-completed").textContent = state.totalCompleted;
    $("overview-failed").textContent = state.failed;
    $("overview-strategy").textContent = strategyNames[state.strategy];
    $("history-steps").textContent = state.step;

    $("pipeline-ingress").textContent = `${state.incoming} requests / step`;
    $("pipeline-strategy").textContent = `${strategyNames[state.strategy]} strategy`;
    $("worker-pool-count").textContent = `${state.workers} / ${state.totalWorkers} online`;
    $("chart-summary").textContent = `Step ${state.step} · Queue ${state.backlog}`;
    $("backlog-summary").textContent = state.backlog > 20
      ? "Queue pressure high" : state.backlog > 8 ? "Queue growing" : "Queue stable";

    for (let i = 1; i <= state.totalWorkers; i++) {
      const worker = $(`worker-node-${i}`);
      worker.classList.toggle("offline", i > state.workers);
      worker.title = i > state.workers ? "Worker offline (simulated)" : "Worker online (simulated)";
    }

    const database = $("database-status");
    database.classList.toggle("slowed", state.dbSlow);
    $("database-label").textContent = state.dbSlow
      ? "Slow response · simulated" : "Simulated dependency";

    $("system-status").textContent =
      state.workers === 0 ? "CAPACITY CRITICAL" :
      state.dbSlow ? "DEGRADED MODE" :
      state.backlog > 20 ? "HIGH QUEUE LOAD" : "SYSTEM READY";
  }

  function drawChart(canvasId, series, showLabels=true) {
    const canvas = $(canvasId);
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width, height = rect.height;
    const pad = {left:36, right:12, top:14, bottom:showLabels ? 28 : 14};
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    ctx.clearRect(0, 0, width, height);

    const allValues = series.flatMap(item => item.values);
    const maxValue = Math.max(10, Math.ceil(Math.max(...allValues, 1) / 5) * 5);
    const count = Math.max(1, series[0].values.length);

    ctx.font = '9px "DM Mono", monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const value = maxValue - maxValue * i / 4;
      const y = pad.top + plotHeight * i / 4;
      ctx.strokeStyle = "#223149";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "#7187a4";
      ctx.fillText(String(Math.round(value)), pad.left - 8, y);
    }

    if (showLabels) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ticks = Math.min(6, count);
      for (let i = 0; i < ticks; i++) {
        const index = ticks === 1 ? 0 : Math.round(i * (count - 1) / (ticks - 1));
        const x = pad.left + (count === 1 ? plotWidth / 2 : index / (count - 1) * plotWidth);
        ctx.fillStyle = "#7187a4";
        ctx.fillText(`S${series[0].steps[index] ?? index}`, x, height - 17);
      }
    }

    series.forEach(item => {
      if (!item.values.length) return;

      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();

      item.values.forEach((value, index) => {
        const x = pad.left + (count === 1 ? plotWidth / 2 : index / (count - 1) * plotWidth);
        const y = pad.top + plotHeight - value / maxValue * plotHeight;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();

      const last = item.values.length - 1;
      const x = pad.left + (count === 1 ? plotWidth / 2 : last / (count - 1) * plotWidth);
      const y = pad.top + plotHeight - item.values[last] / maxValue * plotHeight;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderCharts() {
    const history = state.history;

    drawChart("workload-chart", [
      {color:"#60a5fa", values:history.map(x => x.incoming), steps:history.map(x => x.step)},
      {color:"#5eead4", values:history.map(x => x.completed), steps:history.map(x => x.step)},
      {color:"#a78bfa", values:history.map(x => x.backlog), steps:history.map(x => x.step)}
    ]);

    drawChart("history-chart", [
      {color:"#a78bfa", values:history.map(x => x.backlog), steps:history.map(x => x.step)}
    ]);
  }

  function render() {
    renderMetrics();
    renderCharts();
    renderEvents();
  }

  function stopSimulation() {
    state.running = false;
    clearInterval(state.timer);
    state.timer = null;
    $("start-pause").textContent = "▶ Start simulation";
  }

  function toggleSimulation() {
    if (state.running) {
      stopSimulation();
      showToast("Simulation paused.");
    } else {
      state.running = true;
      $("start-pause").textContent = "Ⅱ Pause simulation";
      state.timer = setInterval(runStep, 1300);
      showToast("Simulation running.");
    }
  }

  function resetSimulation() {
    stopSimulation();

    Object.assign(state, {
      step:0, backlog:0, incoming:10, completed:10, failed:0,
      workers:4, traffic:50, strategy:"round-robin", dbSlow:false,
      spike:false, cost:0.02, totalIncoming:10, totalCompleted:10,
      history:[{step:0,incoming:10,completed:10,backlog:0}],
      events:[]
    });

    addEvent("Simulation reset",
      "Queue cleared, workers restored and database normal", "low", "Baseline restored");
    render();
    showToast("Simulation reset to baseline.");
  }

  function injectFault(type) {
    if (type === "spike") {
      state.spike = true;
      state.backlog += 8;
      addEvent("Traffic spike", "Incoming load increased; queue pressure may rise",
        "medium", "Monitor queue");
    } else if (type === "worker") {
      if (state.workers > 0) state.workers--;
      state.backlog += 3;
      addEvent("Worker failure", `${state.workers} of ${state.totalWorkers} workers available`,
        "high", "Capacity reduced");
    } else if (type === "database") {
      state.dbSlow = true;
      addEvent("Database slowdown", "Effective processing capacity reduced",
        "high", "Inspect dependency");
    }

    recordHistory();
    render();
    showToast("Scenario applied to simulated system.");
  }

  function recoverSystem() {
    state.workers = state.totalWorkers;
    state.dbSlow = false;
    state.spike = false;
    addEvent("System recovery", "Workers restored and database returned to normal",
      "low", "Resume workload");
    render();
    showToast("Simulated system recovered.");
  }

  function exportCsv() {
    const rows = [
      ["Time","Event","Outcome","Risk","Decision"],
      ...state.events.slice().reverse().map(e =>
        [e.time,e.name,e.outcome,e.risk,e.decision])
    ];

    const csv = rows.map(row =>
      row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")
    ).join("\r\n");

    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "queuepulse_events.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Event log exported as CSV.");
  }

  function showView(view) {
    const titles = {
      dashboard:["Dashboard","Simulated workload telemetry and system health."],
      simulation:["Simulation Lab","Configure traffic and introduce controlled faults."],
      architecture:["Architecture","Logical components of the QueuePulse simulation."]
    };

    document.querySelectorAll(".view-section").forEach(section => {
      section.hidden = section.id !== `${view}-view`;
    });

    document.querySelectorAll("[data-view]").forEach(button => {
      button.classList.toggle("active", button.dataset.view === view);
    });

    $("page-title").textContent = titles[view][0];
    $("page-subtitle").textContent = titles[view][1];

    if (view === "dashboard") requestAnimationFrame(renderCharts);
  }

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      showView(button.dataset.view);
    });
  });

  $("traffic-level").addEventListener("input", event => {
    state.traffic = Number(event.target.value);
    renderMetrics();
  });

  $("strategy-select").addEventListener("change", event => {
    state.strategy = event.target.value;
    addEvent("Scheduling strategy changed",
      `Strategy set to ${strategyNames[state.strategy]}`, "low", "Apply next step");
    render();
  });

  $("start-pause").addEventListener("click", toggleSimulation);
  $("step-simulation").addEventListener("click", runStep);
  $("reset-simulation").addEventListener("click", resetSimulation);
  $("traffic-spike").addEventListener("click", () => injectFault("spike"));
  $("worker-crash").addEventListener("click", () => injectFault("worker"));
  $("db-slowdown").addEventListener("click", () => injectFault("database"));
  $("recover-faults").addEventListener("click", recoverSystem);
  $("dashboard-export").addEventListener("click", exportCsv);
  $("simulation-export").addEventListener("click", exportCsv);

  window.addEventListener("resize", () => requestAnimationFrame(renderCharts));

  addEvent("System initialized",
    "Baseline workload ready: 4 workers, normal database, 50% traffic",
    "low", "Await input");

  render();
})();
