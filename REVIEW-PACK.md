# QueuePulse — Review Preparation Pack

**For:** Prabha Khiani (24BDS0354) & Sam Nagar (24BCE2871)
**Review window:** ~5–6 hours from now

---

## 1. Honest assessment of where the project stands

### What is genuinely strong
- **Clean multi-page architecture for a static site**: one shared script (`app.js`), shared state in `sessionStorage`, page detection via `data-page` — a mini client-side "framework" with no dependencies.
- **The simulated signals are the right signals.** Queue depth, throughput, failure rate, worker utilization, DLQ-worthy failed jobs, pending/processing split — these are exactly what a real queue monitoring system (CloudWatch, Sidekiq UI, Celery Flower) shows. That means the *domain modeling* is correct even though the data is fake.
- **Honest framing everywhere** ("SIMULATED DATA" tags, disclaimers) — reviewers reward this heavily; it protects you from "is this real?" questions turning into integrity questions.
- **Interaction depth**: filters, sorting, search, time-range switching, worker lifecycle actions — more than a typical static dashboard.

### The one big gap (now fixed)
For a **cloud architecture design** review, the project had **no cloud architecture in it** — no design document, no diagram, no justification of technology choices, no comparison to literature. A reviewer would ask "where is the architecture?" and the answer was only "a dashboard mock-up."

**This pack adds the missing architecture documentation (the backend, cloud deployment, delivery guarantees and autoscaling remain proposed, not implemented):**
- `ARCHITECTURE.md` — full production design (AWS: SQS + ECS Fargate + DynamoDB + S3 + CloudWatch), with decisions justified against published research.
- `architecture.html` — a new page on the live site with the architecture diagram, design patterns, prototype-to-production mapping, and a related-work table.
- Nav links added on every page; README updated.

### Remaining known limitations (say these before the reviewer does)
1. The demo state is per-browser-tab (`sessionStorage`) — two reviewers on two machines see different data. By design (honest simulation), but be ready to say "the production read path replaces this with a shared read-model API."
2. Charts are 16-point series with random-walk updates — no persistence, no aggregation logic. In production this is CloudWatch period queries.
3. No tests, no CI. A fair criticism; acknowledge and point to the roadmap.
4. No real measurements — every number is synthetic. Frame explicitly: "simulated, not benchmarked."

---

## 2. The framing sentence (memorize this)

> "QueuePulse is a monitoring dashboard prototype: it simulates the observability plane of a distributed job system. The cloud architecture it is designed to monitor is an auto-scaling, queue-driven pipeline on AWS — SQS for durable buffering, ECS Fargate workers as competing consumers, DynamoDB for job records, and CloudWatch as the metrics source the dashboard would read. The design decisions are justified against published research on broker comparison, event-queue autoscaling, and serverless trade-offs."

This single paragraph answers "what did you build", "where is the cloud", and "why these choices."

---

## 3. Likely review questions — with strong answers

### "Why is this called a cloud architecture project if nothing is deployed?"
Because the deliverable is the **design of the system plus a faithful prototype of its monitoring surface**. The prototype demonstrates we understand *what to measure*; the architecture document demonstrates we understand *how to build what produces those measurements*. We have not deployed the backend and we say so plainly — the phased roadmap in ARCHITECTURE.md Section 10 shows exactly how we would deploy it (Phase 1 is about a week).

### "What happens when two users submit jobs at the same time?"
Both go through API Gateway into SQS — the queue buffers durably and scales independently of consumers. Workers compete for messages, but under at-least-once semantics duplicate and redelivered messages are possible, so workers claim jobs atomically (conditional write in DynamoDB) and downstream side effects must be idempotent. We do not promise exactly-once external effects — we promise at-least-once processing with idempotent record-keeping.

### "Why SQS and not Kafka?"
The comparative literature (Chy et al. 2023; Ramadan et al. 2026, abstract-based) frames it as a trade-off — Kafka targets high-throughput stream processing — but our workload is job *dispatch*: one intended logical handler per job, no cross-class ordering, no replay. For that use case a managed queue eliminates broker operations entirely and is the standard answer. Those studies benchmark self-hosted brokers and don't include SQS, so present SQS as our engineering choice for operational reasons, not a literature-proven winner. A Kafka-to-SNS/SQS hybrid is documented (Panwar 2025) as a future option if we add a streaming tier.

### "Why containers and not Lambda?"
Serverless literature (Abdulrahman et al. 2024, abstract-based) documents cold starts and execution-time limits. Our job classes include long-running video transcoding — a poor fit for FaaS both technically and cost-wise. Containers give long execution windows and warm pools; the elasticity gap is closed by queue-driven autoscaling. (Note: this design is CPU-only on Fargate — GPU jobs would need EC2-backed tasks and are out of scope.)

### "How does it scale?"
Target-tracking on **backlog per worker** — with backlog B, average job time s and wait target T, keep roughly ceil(B × s / T) workers — not CPU, because in queue-driven systems the queue is the load signal. Ezzeddine et al. (2025) shows these autoscaling parameters are first-class tuning concerns that directly affect latency and efficiency — we present ours as a proposed heuristic to measure and tune, not a guarantee. The initial design keeps a minimum of one worker per fleet (backlog-per-worker is undefined at zero); scale-to-zero for the background class is a later optimization. Cooldowns and scale-in protection prevent flapping.

### "What if a job keeps failing?"
The worker releases the message with an extended visibility timeout (exponential backoff with jitter, implemented application-side); after 5 receive attempts (maxReceiveCount) the message drains to a dead-letter queue. DLQ depth > 0 fires an alarm. This is the real version of the "Failed" badge in the prototype. Ops runbook: inspect, fix, redrive.

### "What if a worker dies mid-job?"
SQS visibility timeout: the message becomes visible again and another worker picks it up. We set the timeout to 2× worst-case job duration with heartbeat extension. The job is not lost — but it may be re-attempted, which is why downstream side effects must be idempotent.

### "Where is state stored?"
Production: DynamoDB (job records, status transitions, idempotency keys) + S3 (artifacts) + CloudWatch (metrics). The dashboard never talks to queues directly — it reads an aggregation API. In the prototype this is all `sessionStorage`, clearly labeled as simulated.

### "How do you know it works / what have you measured?"
Be honest: nothing is measured — all data is synthetic. What we *can* defend is the design's correctness mechanisms (at-least-once delivery + atomic claims + idempotent side effects). Offer the Phase-3 roadmap item: synthetic producers + load test to put real numbers on the dashboard.

### "What did you compare against?"
The related-work table on the architecture page: JVM broker benchmarks, Kafka-vs-RabbitMQ stress tests, event-queue autoscaling parameter studies, FaaS reviews, fault-tolerant microservices studies, plus canonical references (queue-based load leveling pattern, KEDA).

---

## 4. Demo script (5 minutes)

1. **Overview page (60 s):** point at the four headline metrics and say what each maps to in production (processed → application-level completion counters; depth → `ApproximateNumberOfMessagesVisible`; failed → terminally-failed outcome counters + DLQ; workers → fleet health).
2. **Metrics page (45 s):** switch time ranges (1H → 7D) — explain this is a CloudWatch period query in production.
3. **Workers & Queues (90 s):** pause a worker, simulate a failure on another, then recover both. Be explicit: "these buttons flip a simulated status — in production this is ECS desired-count changes and health-check failures, and the fleet auto-replaces dead instances."
4. **Cloud Architecture page (2 min — the centerpiece):** walk the diagram left to right: clients → API Gateway → SQS (+DLQ) → worker fleets → data tier; then the auto-scaling box and the observability band. Hit the three "why" cards (broker, workers, scaling) and the related-work table.
5. **Close with the roadmap:** Phase 1 deploy, Phase 2 autoscaling + alarms, Phase 3 load tests.

---

## 5. Your 5-hour checklist

- [ ] **Commit the new files to GitHub now** so the live site includes them: `git add . && git commit -m "Add cloud architecture design: ARCHITECTURE.md + architecture page" && git push` (GitHub Pages needs ~2 min to redeploy).
- [ ] **Read ARCHITECTURE.md twice** — it is your source of truth for every question.
- [ ] **Rehearse the framing sentence** (Section 2) and the demo script (Section 4) once out loud.
- [ ] **Review the Q&A (Section 3)** — especially the four hard ones: why-SQS, why-containers, concurrent submissions, "what have you measured."
- [ ] Open the live site and click through all six pages to confirm the nav and new page render.
- [ ] (If time) Practice the whiteboard version of the architecture diagram — draw it from memory once.

---

## 6. Files in this update

| File | Change |
|---|---|
| `architecture.html` | NEW — cloud architecture page: diagram, decisions, patterns, mappings, related work |
| `ARCHITECTURE.md` | NEW — full design document |
| `REVIEW-PACK.md` | NEW — this file |
| `index.html`, `metrics.html`, `activity.html`, `workers.html`, `about.html` | Added "Cloud Architecture" nav link |
| `README.md` | Added architecture page row + design section |
| `styles.css`, `app.js` | Unchanged (new page uses existing classes + a small scoped `<style>` block) |
