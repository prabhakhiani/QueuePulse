
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    running: false,
    timer: null,
    tick: 0,
    backlog: 20,
    latency: 105,
    workers: 4,
    maxWorkers: 4,
    traffic: 50,
    databaseSlow: false,
    events: [],
    cost: 0,
    incoming: 0,
    completed: 0,
    failed: 0,
    cpu: 0,
    history: [],
    roundRobinIndex: 0
  };

  const strategyDescriptions = {
    'round-robin':
      'Distributes requests across available workers in rotation.',
    'least-loaded':
      'Assigns work to the worker with the lowest current load.',
    'fifo':
      'Processes queued requests in first-in, first-out order.'
  };

  const MAX_HISTORY = 20;
  const WORKER_CAPACITY = 8;
  const COST_PER_WORKER_STEP = 0.006;

  function nowTime() {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(notify.timeout);
    notify.timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2600);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function addEvent(event, outcome, risk = 'Low', decision = 'Continue') {
    state.events.unshift({
      time: nowTime(),
      event,
      outcome,
      risk,
      decision,
      tick: state.tick,
      backlog: state.backlog,
      latency: state.latency,
      workers: state.workers,
      incoming: state.incoming,
      completed: state.completed,
      cpu: state.cpu
    });

    if (state.events.length > 200) {
      state.events.length = 200;
    }

    renderEvents();
  }

  function renderEvents() {
    const list = $('event-list');
    const body = $('event-table-body');

    if (list) {
      list.innerHTML = state.events.length
        ? state.events.slice(0, 6).map(event => {
            const marker = event.risk === 'High'
              ? 'danger'
              : event.risk === 'Medium' ? 'warn' : '';

            return `
              <div class="event-item">
                <span class="event-marker ${marker}"></span>
                <div>
                  <strong>${escapeHtml(event.event)}</strong>
                  <small>${escapeHtml(event.outcome)}</small>
                </div>
                <span class="event-time">${escapeHtml(event.time)}</span>
              </div>`;
          }).join('')
        : `<div class="empty-state">
             <span>⌁</span>
             <strong>No events yet</strong>
             <p>Start a simulation to see activity here.</p>
           </div>`;
    }

    if (body) {
      body.innerHTML = state.events.length
        ? state.events.slice(0, 100).map(event => `
            <tr>
              <td>${escapeHtml(event.time)}</td>
              <td>${escapeHtml(event.event)}</td>
              <td>${escapeHtml(event.outcome)}</td>
              <td><span class="risk risk-${event.risk.toLowerCase()}">
                ${escapeHtml(event.risk)}
              </span></td>
              <td>${escapeHtml(event.decision)}</td>
            </tr>`).join('')
        : `<tr><td colspan="5" class="table-empty">
             No events recorded yet.
           </td></tr>`;
    }
  }

  // Add extra numerical cards without replacing the existing HTML.
  function createExtraMetricCards() {
    const grid = document.querySelector('.metrics-grid');
    if (!grid) return;

    const metrics = [
      {
        id: 'metric-incoming',
        label: 'INCOMING REQUESTS',
        icon: '↗',
        color: 'teal',
        value: '0',
        foot: 'Requests arriving this step'
      },
      {
        id: 'metric-completed',
        label: 'COMPLETED REQUESTS',
        icon: '✓',
        color: 'blue',
        value: '0',
        foot: 'Requests processed this step'
      },
      {
        id: 'metric-cpu',
        label: 'CPU UTILIZATION',
        icon: '▥',
        color: 'purple',
        value: '0%',
        foot: 'Estimated worker utilization'
      }
    ];

    metrics.forEach(metric => {
      if ($(metric.id)) return;

      const card = document.createElement('article');
      card.className = 'metric-card';
      card.innerHTML = `
        <div class="metric-top">
          <span>${metric.label}</span>
          <span class="metric-icon ${metric.color}">${metric.icon}</span>
        </div>
        <div class="metric-value" id="${metric.id}">${metric.value}</div>
        <div class="metric-foot">${metric.foot}</div>`;

      grid.appendChild(card);
    });

    // Allow the extra cards to fit the existing dashboard layout.
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(190px, 1fr))';
  }

  function renderMetrics() {
    const setText = (id, value) => {
      if ($(id)) $(id).textContent = value;
    };

    setText('metric-backlog', state.backlog);

    if ($('metric-latency')) {
      $('metric-latency').innerHTML =
        `${state.latency} <small>ms</small>`;
    }

    if ($('metric-workers')) {
      $('metric-workers').innerHTML =
        `${state.workers} <small>/ ${state.maxWorkers}</small>`;
    }

    setText('metric-cost', `₹${state.cost.toFixed(2)}`);
    setText('metric-incoming', state.incoming);
    setText('metric-completed', state.completed);
    setText('metric-cpu', `${state.cpu}%`);
    setText('traffic-value', `${state.traffic}%`);

    if ($('chart-summary')) {
      $('chart-summary').textContent =
        `Step ${state.tick} · Queue ${state.backlog} · CPU ${state.cpu}%`;
    }

    drawChart();
  }

  function recordHistory() {
    state.history.push({
      tick: state.tick,
      incoming: state.incoming,
      completed: state.completed,
      backlog: state.backlog
    });

    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }
  }

  // Draw three data series on the same canvas.
  function drawChart() {
    const canvas = $('workload-chart');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const width = Math.max(280, Math.floor(rect.width));
    const height = Math.max(160, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { left: 38, right: 12, top: 18, bottom: 28 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    const history = state.history.length
      ? state.history
      : [{
          tick: 0,
          incoming: 0,
          completed: 0,
          backlog: state.backlog
        }];

    const allValues = history.flatMap(item => [
      item.incoming,
      item.completed,
      item.backlog
    ]);

    const maxVal = Math.max(10, ...allValues) * 1.15;

    ctx.font = '10px monospace';
    ctx.lineWidth = 1;

    // Horizontal grid and Y-axis labels.
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * i / 4;

      ctx.strokeStyle = '#263449';
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#74859b';
      ctx.fillText(
        String(Math.round(maxVal * (4 - i) / 4)),
        2,
        y + 3
      );
    }

    function drawSeries(key, color) {
      if (!history.length) return;

      const points = history.map((item, index) => ({
        x: pad.left + (
          history.length <= 1
            ? chartW
            : index * chartW / (history.length - 1)
        ),
        y: pad.top + chartH -
          (item[key] / maxVal) * chartH
      }));

      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }

    drawSeries('incoming', '#60a5fa');
    drawSeries('completed', '#a78bfa');
    drawSeries('backlog', '#5eead4');

    ctx.fillStyle = '#74859b';
    ctx.fillText('Simulation steps →', pad.left, height - 7);

    // Keep the legend synchronized with the graph.
    const legend = canvas.closest('.chart-panel')
      ?.querySelector('.chart-legend');

    if (legend) {
      legend.innerHTML = `
        <span><i class="legend-dot" style="background:#60a5fa"></i>
          Incoming</span>
        <span><i class="legend-dot" style="background:#a78bfa"></i>
          Completed</span>
        <span><i class="legend-dot" style="background:#5eead4"></i>
          Backlog</span>
        <span id="chart-summary">Step ${state.tick} · Queue ${state.backlog}</span>`;
    }
  }

  function updateButton() {
    const button = $('start-pause');
    if (button) {
      button.textContent = state.running
        ? 'Ⅱ Pause simulation'
        : '▶ Start simulation';
    }
  }

  function getRisk() {
    if (state.backlog > 35 || state.latency > 300 || state.cpu > 95) {
      return 'High';
    }

    if (state.backlog > 15 || state.latency > 160 || state.cpu > 75) {
      return 'Medium';
    }

    return 'Low';
  }

  function simulationStep() {
    state.tick += 1;

    // Traffic percentage determines the average incoming workload.
    const incoming = Math.max(
      0,
      Math.round(state.traffic * 0.18 + (Math.random() * 4 - 2))
    );

    const capacity = state.workers * WORKER_CAPACITY;

    // The database slowdown reduces processing capacity.
    const effectiveCapacity = state.databaseSlow
      ? Math.floor(capacity * 0.45)
      : capacity;

    // Scheduling policies affect which queued work is served first.
    const strategy = $('strategy-select')?.value || 'round-robin';

    let processingCapacity = effectiveCapacity;

    if (strategy === 'least-loaded' && state.workers > 0) {
      processingCapacity = Math.min(
        capacity,
        effectiveCapacity + 1
      );
    } else if (strategy === 'fifo') {
      processingCapacity = Math.max(
        0,
        effectiveCapacity - (state.backlog > 20 ? 1 : 0)
      );
    }

    state.incoming = incoming;
    const availableWork = state.backlog + incoming;
    state.completed = Math.min(availableWork, processingCapacity);

    // Any work that cannot be processed remains in the queue.
    state.backlog = Math.max(
      0,
      availableWork - state.completed
    );

    // CPU is an illustrative utilization estimate.
    state.cpu = state.workers === 0
      ? 0
      : Math.min(
          100,
          Math.round(
            (state.completed / Math.max(1, capacity)) * 100 +
            (state.databaseSlow ? 12 : 0)
          )
        );

    state.latency = Math.max(
      12,
      Math.round(
        25 +
        state.backlog * 5 +
        (state.maxWorkers - state.workers) * 35 +
        (state.databaseSlow ? 110 : 0)
      )
    );

    state.cost += state.workers * COST_PER_WORKER_STEP;

    recordHistory();

    const risk = getRisk();

    addEvent(
      'Workload step',
      `${incoming} arrived, ${state.completed} completed, ${state.backlog} waiting`,
      risk,
      strategyDescriptions[strategy]
    );

    renderMetrics();
  }

  function startSimulation() {
    if (state.running) {
      stopSimulation();
      notify('Simulation paused.');
      return;
    }

    state.running = true;
    updateButton();

    addEvent(
      'Simulation started',
      'Automatic workload processing started',
      'Low',
      'Run'
    );

    notify('Simulation started.');
    simulationStep();

    state.timer = setInterval(simulationStep, 1600);
  }

  function stopSimulation() {
    state.running = false;
    clearInterval(state.timer);
    state.timer = null;
    updateButton();
  }

  function resetSimulation() {
    stopSimulation();

    state.tick = 0;
    state.backlog = 0;
    state.latency = 25;
    state.workers = 4;
    state.maxWorkers = 4;
    state.traffic = Number($('traffic-level')?.value ?? 50);
    state.databaseSlow = false;
    state.events = [];
    state.cost = 0;
    state.incoming = 0;
    state.completed = 0;
    state.failed = 0;
    state.cpu = 0;
    state.history = [];
    state.roundRobinIndex = 0;

    recordHistory();
    addEvent(
      'Simulation reset',
      'Queue cleared; workers restored; database normal',
      'Low',
      'Reset'
    );

    renderMetrics();
    notify('Simulation reset.');
  }

  function setView(viewName) {
    const views = ['dashboard', 'simulation', 'architecture'];

    if (!views.includes(viewName)) return;

    views.forEach(name => {
      const section = $(`${name}-view`);
      if (section) section.hidden = name !== viewName;
    });

    document.querySelectorAll('[data-view]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.view === viewName
      );
    });

    const titles = {
      dashboard: 'Dashboard',
      simulation: 'Simulation Lab',
      architecture: 'Architecture'
    };

    if ($('page-title')) {
      $('page-title').textContent = titles[viewName];
    }

    requestAnimationFrame(drawChart);
  }

  function exportCSV() {
    if (!state.events.length) {
      notify('No events to export yet. Run the simulation first.');
      return;
    }

    const headers = [
      'Time',
      'Step',
      'Event',
      'Outcome',
      'Risk',
      'Decision',
      'Incoming',
      'Completed',
      'Backlog',
      'Latency_ms',
      'CPU_percent',
      'Active_workers'
    ];

    const rows = state.events.map(event => [
      event.time,
      event.tick,
      event.event,
      event.outcome,
      event.risk,
      event.decision,
      event.incoming,
      event.completed,
      event.backlog,
      event.latency,
      event.cpu,
      event.workers
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(','))
      .join('\r\n');

    const blob = new Blob(
      [csv],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'queuepulse-events.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Detailed CSV exported.');
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(button => {
      button.addEventListener('click', () => {
        setView(button.dataset.view);
      });
    });

    $('hero-simulate')?.addEventListener('click', () => {
      setView('simulation');
    });

    $('traffic-level')?.addEventListener('input', event => {
      state.traffic = Number(event.target.value);
      if ($('traffic-value')) {
        $('traffic-value').textContent = `${state.traffic}%`;
      }
    });

    $('strategy-select')?.addEventListener('change', event => {
      const strategy = event.target.value;

      if ($('strategy-info')) {
        $('strategy-info').textContent =
          strategyDescriptions[strategy];
      }

      addEvent(
        'Strategy changed',
        `Scheduling strategy set to ${event.target.selectedOptions[0].textContent}`,
        'Low',
        'Configuration'
      );

      notify('Scheduling strategy updated.');
    });

    $('start-pause')?.addEventListener('click', startSimulation);

    $('step-simulation')?.addEventListener('click', () => {
      if (state.running) {
        notify('Pause before stepping manually.');
        return;
      }

      simulationStep();
      notify('One simulation step completed.');
    });

    $('reset-simulation')?.addEventListener('click', resetSimulation);

    $('traffic-spike')?.addEventListener('click', () => {
      state.traffic = Math.min(100, state.traffic + 35);

      if ($('traffic-level')) {
        $('traffic-level').value = state.traffic;
      }

      if ($('traffic-value')) {
        $('traffic-value').textContent = `${state.traffic}%`;
      }

      // Record the spike immediately so the graph visibly changes.
      state.tick += 1;
      const addedRequests = 12;

      state.incoming = addedRequests;
      state.completed = 0;
      state.backlog += addedRequests;

      state.latency = Math.max(
        state.latency,
        25 + state.backlog * 5
      );

      state.cpu = Math.min(
        100,
        Math.round(state.cpu + 15)
      );

      recordHistory();

      addEvent(
        'Traffic spike',
        `${addedRequests} extra requests arrived; queue is now ${state.backlog}`,
        getRisk(),
        'Monitor queue'
      );

      renderMetrics();
      notify('Traffic spike simulated.');
    });

    $('worker-crash')?.addEventListener('click', () => {
      if (state.workers === 0) {
        notify('All workers are offline. Recover the system first.');
        return;
      }

      state.workers -= 1;
      state.backlog += 3;
      state.latency += 35;

      state.cpu = state.workers === 0
        ? 0
        : Math.min(100, Math.round(
            state.completed /
            Math.max(1, state.workers * WORKER_CAPACITY) * 100
          ));

      state.tick += 1;
      recordHistory();

      addEvent(
        'Worker failure',
        `One worker failed; ${state.workers} of ${state.maxWorkers} remain available`,
        getRisk(),
        'Rebalance workload'
      );

      renderMetrics();
      notify('Worker failure simulated.');
    });

    $('db-slowdown')?.addEventListener('click', () => {
      if (state.databaseSlow) {
        notify('Database slowdown is already active.');
        return;
      }

      state.databaseSlow = true;
      state.latency += 90;
      state.backlog += 5;
      state.tick += 1;

      recordHistory();

      addEvent(
        'Database slowdown',
        `Processing capacity reduced; latency is ${state.latency} ms`,
        getRisk(),
        'Check database'
      );

      renderMetrics();
      notify('Database slowdown simulated.');
    });

    $('recover-faults')?.addEventListener('click', () => {
      state.workers = state.maxWorkers;
      state.databaseSlow = false;

      state.latency = Math.max(
        25,
        Math.round(25 + state.backlog * 5)
      );

      state.tick += 1;
      recordHistory();

      addEvent(
        'System recovery',
        'All workers restored and database slowdown cleared',
        getRisk(),
        'Recovered'
      );

      renderMetrics();
      notify('System recovered. Continue stepping to drain the queue.');
    });

    $('dashboard-export')?.addEventListener('click', exportCSV);
    $('simulation-export')?.addEventListener('click', exportCSV);

    window.addEventListener('resize', () => {
      requestAnimationFrame(drawChart);
    });
  }

  function init() {
    createExtraMetricCards();
    bindEvents();

    if ($('strategy-info') && $('strategy-select')) {
      $('strategy-info').textContent =
        strategyDescriptions[$('strategy-select').value];
    }

    // Seed a visible starting point for the graph.
    recordHistory();
    renderMetrics();

    addEvent(
      'System ready',
      'QueuePulse educational simulation initialized',
      'Low',
      'Await input'
    );

    setView('dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
