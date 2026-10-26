(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    running: false,
    timer: null,
    tick: 0,
    backlog: 0,
    latency: 0,
    workers: 4,
    maxWorkers: 4,
    traffic: 50,
    databaseSlow: false,
    events: [],
    history: [0, 0, 0, 0, 0, 0, 0, 0],
    cost: 0
  };

  const strategyDescriptions = {
    'round-robin': 'Distributes requests across workers in rotation.',
    'least-loaded': 'Assigns work to the worker with the lowest current load.',
    'fifo': 'Processes requests in first-in, first-out order.'
  };

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timeout);
    notify.timeout = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function addEvent(event, outcome, risk = 'Low', decision = 'Continue') {
    state.events.unshift({ time: nowTime(), event, outcome, risk, decision });
    if (state.events.length > 100) state.events.length = 100;
    renderEvents();
  }

  function renderEvents() {
    const list = $('event-list');
    const body = $('event-table-body');
    const recent = state.events.slice(0, 6);
    if (list) {
      list.innerHTML = recent.length ? recent.map(e => {
        const marker = e.risk === 'High' ? 'danger' : e.risk === 'Medium' ? 'warn' : '';
        return `<div class="event-item"><span class="event-marker ${marker}"></span><div><strong>${escapeHtml(e.event)}</strong><small>${escapeHtml(e.outcome)}</small></div><span class="event-time">${escapeHtml(e.time)}</span></div>`;
      }).join('') : '<div class="empty-state"><span>⌁</span><strong>No events yet</strong><p>Start a simulation to see activity here.</p></div>';
    }
    if (body) {
      body.innerHTML = state.events.length ? state.events.slice(0, 30).map(e => {
        const riskClass = e.risk.toLowerCase();
        return `<tr><td>${escapeHtml(e.time)}</td><td>${escapeHtml(e.event)}</td><td>${escapeHtml(e.outcome)}</td><td><span class="risk risk-${riskClass}">${escapeHtml(e.risk)}</span></td><td>${escapeHtml(e.decision)}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="table-empty">No events recorded yet.</td></tr>';
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMetrics() {
    $('metric-backlog').textContent = state.backlog;
    $('metric-latency').innerHTML = `${state.latency} <small>ms</small>`;
    $('metric-workers').innerHTML = `${state.workers} <small>/ ${state.maxWorkers}</small>`;
    $('metric-cost').textContent = `₹${state.cost.toFixed(2)}`;
    $('traffic-value').textContent = `${state.traffic}%`;
    const summary = $('chart-summary');
    if (summary) summary.textContent = `Step ${state.tick} · backlog ${state.backlog}`;
    drawChart();
  }

  function drawChart() {
    const canvas = $('workload-chart');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width || 500));
    const height = Math.max(140, Math.floor(rect.height || 190));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const pad = { left: 28, right: 8, top: 12, bottom: 24 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const maxVal = Math.max(10, ...state.history) * 1.2;
    ctx.font = '9px "DM Mono", monospace';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * i / 4;
      ctx.strokeStyle = '#263449';
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#74859b';
      ctx.fillText(String(Math.round(maxVal * (4 - i) / 4)), 1, y + 3);
    }
    const points = state.history.map((v, i) => ({
      x: pad.left + (state.history.length <= 1 ? 0 : i * chartW / (state.history.length - 1)),
      y: pad.top + chartH - (v / maxVal) * chartH
    }));
    if (points.length) {
      ctx.beginPath(); ctx.moveTo(points[0].x, pad.top + chartH);
      points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, pad.top + chartH); ctx.closePath();
      const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
      gradient.addColorStop(0, 'rgba(94,234,212,.25)'); gradient.addColorStop(1, 'rgba(94,234,212,0)');
      ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2; ctx.stroke();
      const last = points[points.length - 1];
      ctx.beginPath(); ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#5eead4'; ctx.fill();
    }
    ctx.fillStyle = '#74859b';
    ctx.fillText('Recent steps', pad.left, height - 5);
  }

  function updateButton() {
    const button = $('start-pause');
    if (!button) return;
    button.textContent = state.running ? 'Ⅱ Pause simulation' : '▶ Start simulation';
  }

  function simulationStep() {
    state.tick += 1;
    const incoming = Math.max(0, Math.round(state.traffic / 13 + (Math.random() * 3 - 1)));
    const capacity = Math.max(0, state.workers * (state.databaseSlow ? 2 : 4));
    state.backlog = Math.max(0, state.backlog + incoming - capacity);
    state.latency = Math.max(12, Math.round(25 + state.backlog * 7 + (state.maxWorkers - state.workers) * 32 + (state.databaseSlow ? 110 : 0)));
    state.cost += state.workers * 0.006;
    state.history.push(state.backlog);
    if (state.history.length > 12) state.history.shift();
    const risk = state.backlog > 30 || state.latency > 300 ? 'High' : state.backlog > 12 || state.latency > 150 ? 'Medium' : 'Low';
    addEvent('Workload step', `${incoming} requests arrived; ${Math.min(capacity, state.backlog + incoming)} capacity units available`, risk, $('strategy-select').selectedOptions[0].textContent);
    renderMetrics();
  }

  function startSimulation() {
    if (state.running) {
      state.running = false;
      clearInterval(state.timer);
      state.timer = null;
      updateButton();
      notify('Simulation paused.');
      return;
    }
    state.running = true;
    updateButton();
    addEvent('Simulation started', 'Automatic workload steps are running', 'Low', 'Run');
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
    state.tick = 0; state.backlog = 0; state.latency = 0; state.workers = 4;
    state.maxWorkers = 4; state.traffic = Number($('traffic-level').value); state.databaseSlow = false;
    state.events = []; state.history = Array(8).fill(0); state.cost = 0;
    addEvent('Simulation reset', 'All simulated faults and metrics were reset', 'Low', 'Reset');
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
      button.classList.toggle('active', button.dataset.view === viewName);
    });
    const titles = { dashboard: 'Dashboard', simulation: 'Simulation Lab', architecture: 'Architecture' };
    $('page-title').textContent = titles[viewName];
    if (viewName === 'dashboard') requestAnimationFrame(drawChart);
    if (viewName === 'simulation') requestAnimationFrame(drawChart);
  }

  function exportCSV() {
    if (!state.events.length) {
      notify('No events to export yet. Start or step the simulation first.');
      return;
    }
    const headers = ['Time', 'Event', 'Outcome', 'Risk', 'Decision'];
    const rows = state.events.map(e => [e.time, e.event, e.outcome, e.risk, e.decision]);
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'queuepulse-events.csv';
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    notify('Event log exported as queuepulse-events.csv.');
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $('hero-simulate').addEventListener('click', () => setView('simulation'));
    $('traffic-level').addEventListener('input', event => {
      state.traffic = Number(event.target.value);
      $('traffic-value').textContent = `${state.traffic}%`;
      if (state.traffic > 80) notify('High incoming traffic selected.');
    });
    $('strategy-select').addEventListener('change', event => {
      $('strategy-info').textContent = strategyDescriptions[event.target.value];
      addEvent('Strategy changed', `Scheduling strategy set to ${event.target.selectedOptions[0].textContent}`, 'Low', 'Configuration');
      notify('Scheduling strategy updated.');
    });
    $('start-pause').addEventListener('click', startSimulation);
    $('step-simulation').addEventListener('click', () => {
      if (state.running) { notify('Pause the simulation before stepping manually.'); return; }
      simulationStep(); notify('One simulation step completed.');
    });
    $('reset-simulation').addEventListener('click', resetSimulation);
    $('traffic-spike').addEventListener('click', () => {
      state.traffic = Math.min(100, state.traffic + 35);
      $('traffic-level').value = state.traffic; $('traffic-value').textContent = `${state.traffic}%`;
      state.backlog += 12; state.history.push(state.backlog); if (state.history.length > 12) state.history.shift();
      state.latency = Math.max(state.latency, 110 + state.backlog * 4);
      addEvent('Traffic spike', 'Incoming traffic increased; backlog rose by 12 simulated requests', 'High', 'Monitor queue');
      renderMetrics(); notify('Traffic spike simulated.');
    });
    $('worker-crash').addEventListener('click', () => {
      if (state.workers === 0) { notify('All workers are already offline. Recover the system first.'); return; }
      state.workers -= 1; state.latency += 35; state.backlog += 3;
      addEvent('Worker failure', `One worker taken offline; ${state.workers} remain available`, state.workers <= 2 ? 'High' : 'Medium', 'Rebalance workload');
      renderMetrics(); notify('One worker failed in the simulation.');
    });
    $('db-slowdown').addEventListener('click', () => {
      state.databaseSlow = true; state.latency = Math.max(state.latency + 90, 140); state.backlog += 5;
      addEvent('Database slowdown', 'Request processing is slower than normal', 'Medium', 'Check database');
      renderMetrics(); notify('Database slowdown simulated.');
    });
    $('recover-faults').addEventListener('click', () => {
      state.workers = state.maxWorkers; state.databaseSlow = false;
      state.latency = Math.max(0, Math.round(25 + state.backlog * 4));
      addEvent('System recovery', 'All workers restored and database slowdown cleared', 'Low', 'Recovered');
      renderMetrics(); notify('Simulated system recovered.');
    });
    $('dashboard-export').addEventListener('click', exportCSV);
    $('simulation-export').addEventListener('click', exportCSV);
    window.addEventListener('resize', () => requestAnimationFrame(drawChart));
  }

  function init() {
    bindEvents();
    $('strategy-info').textContent = strategyDescriptions[$('strategy-select').value];
    addEvent('System ready', 'QueuePulse simulation initialized in this browser', 'Low', 'Await input');
    renderMetrics();
    setView('dashboard');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
