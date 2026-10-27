# QueuePulse — Cloud Architecture Design

**Project:** QueuePulse — Queue Monitoring Dashboard
**Team:** Prabha Khiani (24BDS0354), Sam Nagar (24BCE2871)
**Status:** Browser prototype (implemented) + production cloud architecture (this document, designed)

---

## 1. Scope and honest framing

QueuePulse today is a **frontend prototype**: five dashboard pages driven by simulated state held in the browser (`sessionStorage`), with no backend and no cloud resources. That is a deliberate and defensible choice for a college project — it demonstrates the *observability surface* of a distributed job system safely and cheaply.

This document defines the **target production architecture** that the dashboard is a mock-up of: a cloud-native, asynchronous job-processing pipeline with auto-scaling workers, managed message queues, dead-letter handling, and a metrics-driven monitoring layer. Every screen in the prototype maps to a real component in this design (Section 8).

> **Presentation tip:** say "the dashboard is a prototype of the monitoring plane; the architecture below is the design of the system it would monitor." Never claim the simulation is a running distributed system. What has been *implemented* is the frontend prototype; the backend, deployment, delivery guarantees and autoscaling remain *proposed*.

---

## 2. Requirements

### Functional
- F1 — Accept job submissions from client apps (image processing, email delivery, report generation, video transcoding, etc.)
- F2 — Buffer jobs durably when workers are busy or down
- F3 — Process jobs concurrently with multiple workers per job class
- F4 — Record per-job status transitions (pending → processing → completed / failed)
- F5 — Expose metrics: throughput, queue depth, failure rate, worker utilization
- F6 — Surface failed jobs for inspection and retry

### Non-functional
| # | Requirement | Target |
|---|---|---|
| N1 | Durability | No job lost on worker or broker failure (at-least-once delivery) |
| N2 | Elasticity | Absorb 10× traffic spikes without manual intervention |
| N3 | Availability | Tolerate single-worker failure with no data loss; broker is fully managed (SLA-backed) |
| N4 | Latency | P95 job start latency < 30 s under normal backlog |
| N5 | Cost | Pay for consumption; scale to near-zero when idle |
| N6 | Security | Least-privilege access, encryption in transit and at rest |
| N7 | Observability | Every queue and worker emits metrics; alarms on backlog age and failure rate |

---

## 3. High-level architecture

```
 ┌────────────┐     ┌─────────────┐     ┌──────────────────────┐     ┌───────────────────┐
 │  Clients   │────▶│ API Gateway │────▶│  Message broker       │────▶│  Worker tier       │
 │ (web/apps) │     │ + submit    │     │  (SQS std. queues,   │     │  (ECS Fargate,     │
 └────────────┘     │ service     │     │  one per job class)   │     │  one fleet per     │
                   └─────────────┘     │  + DLQ per queue      │     │  queue, competing  │
                                       └──────────────────────┘     │  consumers)       │
                                                                    └─────────┬─────────┘
              ┌──────────────────────────────┐                                 │
              │  Data tier                    │◀────────────────────────────────┘
              │  DynamoDB (job records,       │     write status + artifacts
              │  idempotency keys)             │
              │  S3 (job artifacts)            │
              └──────────────┬────────────────┘
                             │ change events
              ┌──────────────▼────────────────┐        ┌────────────────────────────┐
              │  Observability plane           │───────▶│ QueuePulse dashboard        │
              │  CloudWatch metrics + alarms,  │        │ (static site + read API)    │
              │  structured logs, tracing      │        │ = the existing prototype     │
              └───────────────────────────────┘        └────────────────────────────┘
```

## 4. Component decisions and justification

### 4.1 Message broker — Amazon SQS (standard queues + DLQs)

One standard queue per job class (`media-worker`, `notifications`, `background` — exactly the queues the prototype shows), each with a dead-letter queue and redrive policy.

**Why SQS over Kafka / RabbitMQ / Pulsar:**
- Comparative literature frames broker choice as a trade-off: Kafka targets high-throughput stream processing, while RabbitMQ targets routing flexibility and delivery reliability (abstract-level findings from [Chy et al., 2023](https://www.mdpi.com/2079-9292/12/23/4792), which compares Kafka, Artemis, Pulsar and RocketMQ, and [Ramadan et al., 2026](https://juti.if.its.ac.id/index.php/juti/article/view/1345)). These studies benchmark self-hosted brokers and do not include managed SQS — SQS is our engineering choice for operational reasons below, not a literature-proven winner.
- QueuePulse's workload is *job dispatch* (one intended logical handler per job, no replay, no cross-class ordering requirement) — a use case where a fully managed queue is the standard answer. Kafka's strengths would matter only if we later add event-stream analytics.
- A hybrid Kafka→SNS/SQS integration is a documented pattern for reducing DevOps overhead and cost in event-driven architectures ([Panwar, 2025](https://wjarr.com/node/8791)) — noted as a future option if a streaming tier is added.
- SQS gives at-least-once delivery, per-queue DLQs, visibility timeouts, and effectively unlimited scaling with zero broker ops.

### 4.2 Worker tier — containers (ECS Fargate), not serverless functions

One ECS service per queue class, each running the **competing consumers** pattern (each instance polls the same queue; each delivery goes to one instance, but duplicate delivery is possible).

**Why containers over Lambda:**
- Serverless reviews document that FaaS still suffers cold-start latency and is best for short, stateless, spiky workloads ([Abdulrahman et al., 2024, IEEE](https://ieeexplore.ieee.org/document/10544765)). Several of our job classes are long-running (video transcoding), which fits FaaS execution limits poorly and risks cost blowouts.
- Containers give long execution windows and warm connection pools — at the cost of managing scaling ourselves (solved in Section 5). Note: this design is CPU-only on Fargate; GPU media transcoding would require EC2-backed tasks (GPU is not available on Fargate) and is explicitly out of scope for the initial design.
- Research on autoscaling for distributed event queues shows scaling parameter tuning (latency-aware bin packing, backlog thresholds) is the critical lever for latency and resource efficiency ([Ezzeddine et al., 2025](https://link.springer.com/10.1007/s42979-025-03740-9)) — which is exactly the mechanism we adopt.

### 4.3 Data tier — DynamoDB (job records) + S3 (artifacts)

- **DynamoDB** single-table design for job records and status transitions: ON_DEMAND capacity (fits N5), TTL for old records, and an idempotency-key attribute for deduplication (Section 6.3).
- **S3** for job inputs/outputs (thumbnails, transcoded video, CSV exports).
- Job *status events* are also written to CloudWatch Logs / an events table — this is the data the prototype's Activity page renders.

### 4.4 Dashboard read path (what the prototype becomes)

```
QueuePulse static site (GitHub Pages / CloudFront)
   │  HTTPS + read-only API key
   ▼
API Gateway ──▶ read-model service (Lambda or small ECS service)
                  │  aggregates CloudWatch metrics + job-status queries
                  ▼
           DynamoDB + CloudWatch
```

The existing prototype's `refreshState()` call is the mock of this read API.

---

## 5. Scaling strategy

**Core idea — scale on backlog, not CPU.** For queue-driven systems the correct signal is *queue depth per worker*, because the queue exists precisely to absorb load that CPU metrics see too late.

- **Target-tracking policy (proposed heuristic, parameters to be measured and tuned):** with backlog \(B\) (queued jobs), average processing time \(s\) seconds per job, and queue-wait target \(T\) seconds, keep `target backlog per worker = T / s` jobs, i.e. `estimated workers = ceil(B × s / T)`, clamped to configured min/max capacity, evaluated on the SQS `ApproximateNumberOfMessagesVisible` metric.
- **Scale-to-zero bootstrap:** backlog-per-worker is undefined at zero workers, so the initial design keeps a minimum of one worker per fleet; scale-to-zero for the `background` class is a later optimization requiring a polling or scheduled scale-up trigger.
- **Fargate / ECS service auto scaling** implements this natively via target-tracking on a custom metric; on Kubernetes the same design maps to KEDA, which scales deployments on SQS/Kafka/RabbitMQ queue length and supports scale-to-zero ([keda.sh](https://keda.sh/)).
- **Scale-in protection:** cooldown periods + minimum healthy count to avoid flapping; research shows these parameters (bin-packing thresholds, cooldowns) directly determine latency and resource efficiency ([Ezzeddine et al., 2025](https://link.springer.com/10.1007/s42979-025-03740-9)).
- **Scale-to-zero** is possible for the `background` class (non-urgent) but disabled for `notifications` (latency-sensitive) — a deliberate, defensible trade-off.

## 6. Reliability and failure handling

| Mechanism | Design |
|---|---|
| **Delivery semantics** | At-least-once (SQS standard). Workers compete for messages, but duplicate and redelivered messages are possible — processing must tolerate repeated attempts (see idempotency below). |
| **Visibility timeout** | Set to 2× worst-case job duration; extended via heartbeat for long transcoding jobs so in-flight jobs aren't redelivered. |
| **Retries** | A failing worker releases the message back to the queue; SQS redelivers and increments `ReceiveCount`. The worker implements exponential backoff with jitter by extending the visibility timeout before releasing, so retries space out instead of stampeding. | 
| **Poison messages** | After `maxReceiveCount` = 5 (consistent with the retry budget), the message moves to the queue's **dead-letter queue** — the real-world version of the prototype's "Failed" badge. Alarms fire on DLQ depth > 0. |
| **DLQ redrive** | Ops runbook: inspect DLQ, fix root cause, redrive with the SQS redrive-to-source feature. |
| **Idempotency** | Every submission carries an idempotency key. Workers atomically *claim* a job with a conditional write (claim row, owner, lease) before processing, so two consumers cannot both process the same delivery — but this alone cannot make external side effects exactly-once: if a worker performs a side effect and crashes before recording completion, redelivery will re-attempt it. Downstream operations (emails, file writes) must therefore be idempotent, or side effects must be recorded transactionally before execution. We promise at-least-once processing with idempotent record-keeping, not exactly-once external effects. |
| **Circuit breaker + bulkhead** | Workers calling flaky external APIs (email provider, transcoding service) fail fast rather than piling up. Fault-tolerance patterns in microservice fleets measurably improve QoS ([Zhang et al., 2025](https://link.springer.com/10.1007/s42452-025-07320-7)). |
| **Backpressure** | The queue *is* the backpressure mechanism — producers keep working while workers are down, and the system self-heals when capacity returns (the [queue-based load leveling pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling)). |

## 7. Security and observability

**Security**
- IAM task roles per ECS service — a worker can only poll *its* queue and write *its* DynamoDB partition (least privilege).
- TLS in transit (API Gateway, SQS, S3), encryption at rest (DynamoDB/S3 default), no public ingress to workers (awsvpc networking + VPC endpoints so traffic never leaves the AWS network).
- Dashboard read API requires authentication (OIDC/Cognito-issued token checked at API Gateway); no privileged secret is embedded in the static frontend. Rate limiting and CORS scoping are defense-in-depth, not substitutes for authentication.

**Observability** — the dashboard's simulated metrics map to real signals:

| Dashboard signal (prototype) | Real signal (production) |
|---|---|
|---|---|
| Jobs processed (unique completions) | Application-level outcome counter written by workers on terminal states; transport metrics like `NumberOfMessagesDeleted` are approximate signals only |
| Queue depth | SQS `ApproximateNumberOfMessagesVisible` |
| Failed jobs / failure rate | Application-level outcome counters (terminally failed jobs over the same window); DLQ depth as an approximate transport signal |
| Worker utilization | ECS `CPUUtilization` / `MemoryUtilization` per service |
| Worker pause/fail/recover | ECS desired-count changes, health-check failures, redeployments |
| Alarms (not yet in prototype) | Backlog age > 15 min, DLQ > 0, failure rate > 5%, fleet < min healthy |

## 8. Prototype → production mapping

| Prototype element (simulated) | Production component (designed) |
|---|---|
| `queues` array (3 job classes) | 3 SQS standard queues + 3 DLQs |
| `workers` array with status | ECS services with health checks and target-tracking autoscaling |
| `createEvent()` — samples a job's status label for display | SQS receive → process → DynamoDB status write → message delete (a real state machine the prototype only labels) |
| "Simulate failure" button — a UI-only status flip | Induced instance failure (or Chaos-Lambda) — fleet auto-replaces it |
| `sessionStorage` demo state | DynamoDB job records + CloudWatch metrics |
| `refreshState()` | Read-model API call |
| Metrics charts (1H/6H/24H/7D) | CloudWatch metric queries with matching periods |

## 9. Related work comparison

| Source | Problem | Architecture | Scaling | Evaluation | QueuePulse relation |
|---|---|---|---|---|---|
| [Chy et al., 2023 (Electronics)](https://www.mdpi.com/2079-9292/12/23/4792) | Compare Kafka/Artemis/Pulsar/RocketMQ | Self-hosted JVM brokers | Manual cluster scaling | Comparative evaluation (abstract-based) | Informs our broker decision: job-dispatch workload → managed SQS; revisit if streaming analytics is added |
| [Ramadan et al., 2026 (JUTI)](https://juti.if.its.ac.id/index.php/juti/article/view/1345) | Kafka vs RabbitMQ comparison | Pub/sub vs broker queues | Cluster-based | Performance/stress tests (abstract-based) | Supports the throughput-vs-reliability trade-off framing of Section 4.1 |
| [Panwar, 2025 (WJARR)](https://wjarr.com/node/8791) | Kafka→SNS/SQS integration cost/ops | Hybrid cloud-native messaging | Managed (AWS) | Cost & DevOps analysis | Justifies managed-queue choice on operational cost grounds |
| [Ezzeddine et al., 2025 (Springer)](https://link.springer.com/10.1007/s42979-025-03740-9) | Autoscaling for distributed event queues | Event-queue workers + bin-pack autoscaler | Latency-aware bin packing | Parameter-impact study (abstract-based) | Motivates treating autoscaling parameters (thresholds, latency targets) as first-class tuning concerns — the same concern behind our backlog-based policy |
| [Kumar et al., 2026](https://www.semanticscholar.org/paper/7d412cc4512a24be1b4c2e42501e20dd8db776fe) | Autoscaling for LLM text classification | Priority task queue + worker-pool orchestration | Dynamic worker pool | Cloud environment experiments (abstract-based) | Same architecture shape (priority queue + dynamic worker pool) — supports queue-driven scaling for bursty workloads |
| [Abdulrahman et al., 2024 (IEEE)](https://ieeexplore.ieee.org/document/10544765) | FaaS performance & security review | Serverless functions | Platform-managed | Literature review (abstract-based) | Documents cold starts — a reason we chose containers for long-running jobs |
| [Zhang et al., 2025 (Springer)](https://link.springer.com/10.1007/s42452-025-07320-7) | Fault-tolerant microservices | Docker + Spring Cloud + clusters | Service clusters | Reports ~20% QoS improvement (abstract-based) | Supports our health-check/circuit-breaker/fleet-replacement design |
| [Brilhante et al., 2017 (ACM)](https://dl.acm.org/doi/10.1145/3126858.3126873) | Reactive microservices with async queues | Message-driven microservices | — | Design study | Foundational pattern our pipeline follows |
| [Azure: Queue-Based Load Leveling](https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling) | Absorb peaks between producers and service | Queue buffer | Enables average-not-peak capacity | Canonical pattern reference | Our core decoupling pattern |
| [KEDA](https://keda.sh/) | Event-driven container autoscaling | Kubernetes event scalers | Scale on queue length, to zero | Open-source project docs | The EKS-native equivalent of our ECS target-tracking design |

## 10. Phased roadmap

- **Phase 1 (MVP, ~1 week):** SQS + one ECS service + DynamoDB + read API; dashboard points at real data. No autoscaling.
- **Phase 2 (~1 week):** Target-tracking autoscaling, DLQs + alarms, idempotency keys, structured logging.
- **Phase 3 (optional):** Priority handling (two queues per class), KEDA/EKS variant, multi-AZ hardening, load test with synthetic producers to produce real benchmark numbers for the dashboard.

---

## 9. Implementation status (updated)

Sections 1-8 describe the target design. Since the first review, these parts of it exist as running code:

| Design element | Where it is implemented | How it is checked |
|---|---|---|
| Visibility timeout, redelivery after a crash (6) | `engine.js` | test "crashed worker's job reappears"; `docs/RESULTS.md` section 2 |
| Retries with backoff and jitter, dead-letter after 5 tries (6) | `engine.js` | test "reaches the dead-letter queue after exactly 5 tries" |
| Idempotent submission and repeat-delivery suppression (6) | `engine.js` | tests "idempotency key" and "duplicate deliveries" |
| Backlog scaling rule `ceil(B x s / T)` with cooldown (5) | `engine.js` | test on the deck's 600 / 2 s / 60 s = 20 example; `docs/RESULTS.md` section 1 |
| Alarm rules (7): DLQ not empty, backlog age, failure rate, fleet below minimum | `engine.js` snapshot, shown in Job Lab | visible in Job Lab |
| Queues, DLQs, DynamoDB, S3, SNS, alarms, least-privilege policies (3, 4, 7) | `infra/queuepulse.yaml` | `cfn-lint` clean; **not yet deployed** |
| Worker claim, heartbeat, backoff against real SQS and DynamoDB (6) | `aws/worker.js` | **not yet run on AWS** |

Still design only: the Fargate service and its auto-scaling policy, API Gateway and the read API, VPC endpoints, and a load test on real AWS.
Engine results are model results; see `docs/RESULTS.md` for what they do and do not show.
