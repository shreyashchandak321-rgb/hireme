# Connect FreeHire to CareerPilot

CareerPilot now includes a FreeHire search connector. The FreeHire backend must be running and contain indexed jobs before this connection can return matches. No external paid scraping/AI key is required for the initial Greenhouse feed.

Download `/careerpilot-freehire-setup.zip` from the CareerPilot site. Extract it into a private folder. Windows: use WSL with Docker Desktop integration. Linux/VPS: Docker with Compose, Git, OpenSSL and util-linux (`flock`) are required. This package does not install system tools automatically.

## 1. Start a local test backend

```bash
bash setup.sh
bash seed-and-index.sh
curl http://127.0.0.1:8086/health
curl 'http://127.0.0.1:8086/api/v1/jobs/search?countries=IN&limit=20'
```

The source is pinned to FreeHire revision `606e90c353c5efedc8865a217a88fd66917d8124`. `setup.sh` builds the API, migrations, add-board, ingest, reindex and search-drain tools. Database/search data use named Docker volumes. Local credentials are generated into `.env`; retain that file privately. The API binds only to loopback. No resume, email credentials, employer submissions, paid scraping tier or LLM is configured by this package.

The first seed covers seven verified Greenhouse employer boards. FreeHire's larger catalogue is not included. Expand it using `/app/add-board` through the operator container, then crawl the selected provider and run the indexer. The first reindex may take time. Workers fail with nonzero status; inspect their logs instead of assuming success.

## 2. Connect through your CareerPilot worker (local computer or VPS)

This is the simplest option when FreeHire runs beside your worker. The private hosted dashboard communicates with your paired worker; the worker reads the local FreeHire API. No public tunnel or backend URL on the CareerPilot server is required.

1. Download the **updated worker.py** from CareerPilot Automation. Existing workers do not include the catalogue bridge.
2. Start FreeHire and populate its index using section 1.
3. In your existing paired `careerpilot.json`, add:

```json
"freehire_url": "http://127.0.0.1:8086",
"freehire_token": ""
```

4. Restart the worker. Its catalogue connection runs independently of Ollama inference, so searches do not wait for resume generation. It reports readiness within about five seconds; refresh Automation/Jobs to update the connection status.
5. Choose **Jobs → Job catalogue → FreeHire — via server or worker**, save your preferences, then **Search catalogue**. Searches and full job detail reads travel through the worker. Saving a job adds it to CareerPilot Applications; the same worker can tailor its resume and process supported approved submissions.

`freehire_url` is the origin of the running backend, not github.com or the public FreeHire website. Keep `freehire_token` empty for the supplied loopback API. Set it only if your own reverse proxy requires a separate backend token. Workspace credentials are never forwarded to FreeHire. Search requests contain job filters, not your name, email or resume.

With Docker Desktop/WSL, test `http://127.0.0.1:8086/health` from the same Windows computer where worker.py runs. If loopback forwarding is unavailable, run the worker inside the same WSL distribution as FreeHire and install its Python dependencies there. The URL must be reachable from the worker's environment.

### Alternative: direct server connection

A hosted CareerPilot server cannot reach a backend on your localhost. For a direct server connection, run FreeHire on your VPS behind HTTPS. Configure a reverse proxy exposing only GET `/api/v1/jobs/search` and GET `/api/v1/jobs/{slug}` and requiring a separate service bearer token. Set server-only `FREEHIRE_API_URL` and `FREEHIRE_API_TOKEN` on CareerPilot. Do not expose Postgres, Redis or Meilisearch. FreeHire public read endpoints do not enforce this token themselves; your proxy must enforce it.

No FreeHire backend is provisioned by publishing the CareerPilot UI. The FreeHire repository contains software; it does not include the hosted service's job database. Add employer boards and schedule ingestion/indexing to grow your own catalogue.

## 3. Preferences

- Known engineering role titles map to FreeHire category alternatives, including all eleven roles in the supplied screenshots. This is category matching, not exact title equality.
- Custom titles support up to five title alternatives. Mixed mapped and unmapped titles produce a visible validation error rather than silently losing roles.
- Select country codes (e.g. `IN`) OR cities. FreeHire ORs geography levels, so the connector refuses simultaneous country/city constraints.
- Select multiple work styles and employment types; years accept zero and blank bounds. Unknown years are excluded by FreeHire when a bound is present.
- Sponsorship restricts to marked jobs; it does not guarantee immigration eligibility.
- Job totals and pages come from FreeHire. CareerPilot does not cap the total at 280 or 1,000. Results load 20 per page. Upstream FreeHire currently refuses offsets beyond a 10,000-result browsing window per search; narrow filters to browse other matches. The total count can exceed that window. Skill-overlap chips describe a separate local estimate.
- Full job detail is fetched on save, rather than tailoring from a truncated search preview.

## 4. Keep the catalogue current

Run `refresh.sh` on a source-appropriate schedule and `index.sh` separately every few minutes. The scripts use non-overlap locks. For example, in your own crontab, with absolute installation paths:

```cron
0 */6 * * * /absolute/private/freehire/refresh.sh >> /absolute/private/freehire/refresh.log 2>&1
*/5 * * * * /absolute/private/freehire/index.sh >> /absolute/private/freehire/index.log 2>&1
```

These example schedules are not installed automatically. Configure log rotation, backups and failed-worker monitoring on the VPS. Database/search processes restart unless stopped; cron workers must be scheduled separately.

## 5. Applications need the local worker

FreeHire supplies jobs. CareerPilot prepares resumes with your paired Ollama worker and only supports automatic submission for a narrow set of Greenhouse public forms. **Fast Apply** opens the saved workspace. An offline worker notice explains how to continue. **Apply on employer site** opens the original form for manual application. Review the tailored resume and approve before queuing supported submissions. Submission also requires `allow_approved_submissions: true` in the local worker configuration. SMTP notification setup remains separate.

## Verification limits

The connector is tested against isolated API fixtures, not a running FreeHire/Postgres/Meilisearch installation. Docker and Go are unavailable in the build environment, so this backend package has not been built or started here. Run the local sequence and inspect actual search responses before deployment. The worker bridge is tested with an in-process transport and authenticated server fixtures, including owner isolation, leases, full detail retrieval and saving without submission. No production FreeHire backend connection or cron job has been created on your behalf.
