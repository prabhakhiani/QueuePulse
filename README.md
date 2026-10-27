QueuePulse — Queue Monitoring Dashboard
QueuePulse is a browser-based educational prototype of a queue monitoring dashboard. It demonstrates request queues, worker fleets, job events and dashboard analytics with fully simulated data. It does not connect to or manage any real cloud platform or production queue.

Pages
Page	File	What it shows
Overview	index.html	Jobs processed, queue depth, failed jobs, active workers, throughput chart, job-status donut, recent activity
Metrics	metrics.html	Throughput over time, queue-depth trend, failure-rate statistics, worker utilization, 1H/6H/24H/7D time-range selector
Activity logs	activity.html	Searchable, filterable and sortable event log with status badges and timestamps
Workers & Queues	workers.html	Worker status cards with simulated pause/fail/recover actions, queue cards with pending and processing counts
Cloud Architecture	architecture.html	Target production architecture: diagram, component decisions, design patterns, prototype-to-production map, related-work comparison
About Project	about.html	Project purpose, features, technologies, team and educational disclaimer
Files
index.html, metrics.html, activity.html, workers.html, architecture.html, about.html — the six dashboard pages (shared sidebar, footer and design)

## Cloud architecture design

The dashboard is a simulation of the monitoring plane of a distributed job system. The design of that system — a queue-driven, auto-scaling pipeline on AWS (SQS + ECS Fargate workers + DynamoDB + CloudWatch) — is documented in:

- `ARCHITECTURE.md` — full design document: requirements, component decisions justified against published research, scaling policy, failure handling, security, observability, phased roadmap.
- `architecture.html` — the same design presented as a dashboard page with a diagram and related-work comparison.

Design highlights: queue-based load leveling, competing consumers, dead-letter queues with alarms, at-least-once delivery handled with atomic job claims and idempotent side effects, and target-tracking autoscaling on backlog-per-worker.

styles.css — responsive dark navy and teal design system

app.js — shared script: demo state (sessionStorage), canvas charts, navigation behaviour, filters, worker simulation

Team
Prabha Khiani — Registration No. 24BDS0354

Sam Nagar — Registration No. 24BCE2871

Run it
Keep all files in the same folder.

Best experience: open the live GitHub Pages site, or use VS Code with the Live Server extension — the demo state is shared across pages per browser tab.

Opening index.html directly by double-click works too, but the shared demo state between pages is only reliable when served over HTTP (GitHub Pages or Live Server).

Navigate with the sidebar — each item opens its own page.

Try Refresh data, Generate event (Overview), the time-range selector (Metrics), search/filters/sorting (Activity logs), and Pause / Simulate failure / Recover (Workers & Queues).

Live site: https://prabhakhiani.github.io/QueuePulse/

Technologies
HTML5, CSS3, vanilla JavaScript (ES6), Canvas 2D API, Web Storage API, GitHub Pages. No frameworks, no build tools, no external libraries.

Disclaimer
QueuePulse is a college project created for learning purposes. All metrics, workers, queues and events are simulated locally in the browser. Nothing shown is real-time or connected to a production system.
