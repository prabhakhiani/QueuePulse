# QueuePulse

**A working queue-processing engine, a live dashboard to operate it, and the AWS design it is built to run on.**

Live site: https://prabhakhiani.github.io/QueuePulse/ (open **Job Lab**)

Team: Prabha Khiani (24BDS0354), Sam Nagar (24BCE2871)

## What is real and what is not

| Part | Status |
|---|---|
| Queue engine (`engine.js`): visibility timeout, at-least-once delivery, retries with backoff, dead-letter queue, idempotent claims, worker crashes, backlog-based auto-scaling | **Implemented and tested** (9 automated tests) |
| Job Lab (`lab.html`): you submit jobs, change the rules, crash workers | **Implemented**, runs in the browser or against the server |
| Real-time server (`server/server.js`): the same engine behind an HTTP API | **Implemented**, runs on your machine |
| Load test (`bench/loadtest.js`, `docs/RESULTS.md`) | **Implemented**: measures the engine's policy, not AWS |
| AWS phase 1 (`infra/queuepulse.yaml`): queues, DLQs, table, bucket, alarms, worker policies | **Written and linted**, not yet deployed |
| AWS worker (`aws/worker.js`) | **Written, not yet run on AWS** |
| Fargate service and backlog auto-scaling on AWS | **Designed** (see `ARCHITECTURE.md`) |
| Overview, Metrics, Activity, Workers pages | Still **simulated** with seeded demo data |

The engine models SQS and ECS behaviour. It never calls AWS, and nothing here claims AWS performance numbers.

## Run it

You need Node.js 18 or newer. No `npm install` is required for the app.

```bash
npm start            # http://localhost:8080/lab.html  (real-time server + dashboard)
npm test             # 9 engine tests
npm run bench        # load test; writes bench/results.json
```

Without Node, open the GitHub Pages site or any static server: Job Lab then runs the engine inside the browser tab.

To drive a server from the hosted page, run `npm start` and in Job Lab enter `http://localhost:8080` under **Use a server instead**.
(Safari blocks a secure page from calling a local server; use the local address `http://localhost:8080/lab.html` instead.)

## Try this in Job Lab

1. **Booking rush** scenario, then watch backlog rise, the scaler add workers, then remove them.
2. Submit a job with an idempotency key, then submit the same key again: it runs once.
3. **Poison jobs** scenario: jobs fail five times and land in the dead-letter queue while good jobs keep flowing. Press **Fix cause and redrive**.
4. Press **Crash** on a busy worker: its job comes back after the visibility timeout and is finished by another worker.
5. Lower the maximum workers to 3 and send a burst: the alarms show what an under-sized fleet looks like.

## Files

| File | Purpose |
|---|---|
| `engine.js` | The queue engine. One file, no dependencies, used by browser, server and tests |
| `lab.html`, `lab.js` | Job Lab page and its logic |
| `server/server.js` | Node HTTP server: `/api/state`, `/api/jobs`, `/api/burst`, `/api/config`, `/api/workers/:id/{kill,pause,recover}`, `/api/dlq/:queue/redrive`, `/api/speed`, `/api/reset` |
| `test/engine.test.js` | Automated tests |
| `bench/loadtest.js` | Deterministic load test |
| `infra/queuepulse.yaml` | CloudFormation for AWS phase 1 |
| `aws/worker.js` | Reference SQS/DynamoDB worker |
| `docs/RESULTS.md` | Measured engine results |
| `docs/VIVA.md` | Review questions and honest answers |
| `ARCHITECTURE.md` | Full cloud design and the research behind each choice |
| `index.html`, `metrics.html`, `activity.html`, `workers.html`, `architecture.html`, `about.html`, `app.js`, `styles.css` | The original dashboard pages |

## Deploy phase 1 to AWS

```bash
aws cloudformation deploy --template-file infra/queuepulse.yaml \
  --stack-name queuepulse-dev --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Env=dev AlertEmail=you@example.com
```

The stack creates three queues with dead-letter queues, a DynamoDB table, a private S3 bucket, SNS alerts, CloudWatch alarms and one least-privilege policy per worker.
It costs very little when idle (on-demand billing). Delete it afterwards with `aws cloudformation delete-stack --stack-name queuepulse-dev`.
Then run `aws/worker.js` with `QUEUE_URL` and `TABLE` set (see the stack outputs).

## Technologies

HTML, CSS, vanilla JavaScript, Canvas 2D, Node.js (built-in modules only), AWS CloudFormation. No frameworks.

## Disclaimer

College project for learning. The dashboard's older pages show simulated data. Job Lab shows a real engine's behaviour, but the engine is a model of AWS, not AWS.
