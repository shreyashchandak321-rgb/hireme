# Deploy CareerPilot on Vercel

The website runs on Vercel, application data lives in Supabase Postgres, and resumes live in a private Supabase Storage bucket. The existing VPS continues running the worker, Ollama and FreeHire. Vercel's provided HTTPS address is sufficient; no purchased domain is required.

## 1. Apply the new cloud migration

You already applied the Makerkit schema. In your Supabase project's SQL Editor, run the entire file:

`apps/web/supabase/migrations/20261022000000_careerpilot_cloud.sql`

Do not rerun the old Makerkit migration or reset the database. The new migration adds the private CareerPilot tables, a service-only transaction function, and the private `careerpilot-files` bucket. It does not import old SQLite or Sites data.

## 2. Import the GitHub repository into Vercel

- Repository: `shreyashchandak321-rgb/hireme`
- Framework: Next.js
- Root Directory: `apps/web`
- Enable access to source files outside the Root Directory (the shared workspace packages are required).
- Node.js: 24.x
- Keep the build/install commands from `apps/web/vercel.json`.
- Use the production deployment for worker pairing. An authentication-protected Vercel preview cannot receive normal worker requests.

## 3. Set Vercel environment variables

Add these under Project Settings → Environment Variables, for Production. Set Preview separately only if you intend to test previews.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qdklvizpjhkfgvhtbhch.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable key in `apps/web/.env.local.example` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase **service_role** key, entered privately in Vercel; never put it in GitHub or a `NEXT_PUBLIC_` variable |
| `NEXT_PUBLIC_SITE_URL` | Your final `https://YOUR-APP.vercel.app` address |
| `NEXT_PUBLIC_AUTH_PASSWORD` | `true` |
| `NEXT_PUBLIC_AUTH_GOOGLE` | `false` (enable only after configuring Google's provider) |
| `NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNT_DELETION` | `false` |

The cloud adapter also accepts a new Supabase `sb_secret_...` key in `SUPABASE_SERVICE_ROLE_KEY`. The existing Makerkit server client uses that same environment variable. Keep account deletion disabled until full deletion of private objects has been implemented.

Leave `FREEHIRE_API_URL` unset on Vercel: `127.0.0.1` there is not your VPS. The VPS connector handles FreeHire requests. `CAREERPILOT_DATA_DIR` is no longer used by the website.

If the final address is only known after the first deployment, update `NEXT_PUBLIC_SITE_URL` and redeploy. Public environment variables are embedded during the build.

## 4. Configure Supabase authentication

Under Authentication → URL Configuration, set Site URL to the final Vercel address. Allow these redirects using the same origin:

- `https://YOUR-APP.vercel.app/auth/callback`
- `https://YOUR-APP.vercel.app/auth/confirm`
- `https://YOUR-APP.vercel.app/update-password`

Keep localhost redirects only if using local development. Verify email confirmation and password reset after deployment. Supabase email sending configuration and limits still apply.

## 5. Reconnect the VPS worker

Sign up/sign in on the new deployed app, open Automation, and create a new worker connection. Download its configuration. Back up the existing VPS configuration before changing it.

Update the existing worker configuration's `site_url` to the Vercel origin and `worker_key` to the new paired token. Preserve the existing Ollama model, FreeHire URL, headless setting and notification options. The generated configuration has conservative defaults; replacing your entire working configuration would clear those settings. Do not run two processes with the same configuration during the cutover.

Restart the existing service:

```bash
sudo systemctl restart careerpilot-worker
sudo journalctl -u careerpilot-worker -n 80 --no-pager
```

The VPS keeps using its local Ollama and FreeHire services. No public Ollama port is needed. SMTP/IMAP credentials stay on the VPS. Application notifications require SMTP and `notify_applied`; employer-mail monitoring requires IMAP and `monitor_inbox`.

## 6. Verify before using real applications

1. Sign in, save a profile and preferences, then hard refresh.
2. Upload a PDF/TXT/DOCX up to **3 MB**, refresh, and download it again.
3. Use another account to verify the first account's profile, file and applications are unavailable.
4. Confirm the worker heartbeat and FreeHire search, then test resume parsing.
5. Test one explicitly approved application and check the worker's employer confirmation before trusting an Applied status.

The file limit is 3 MB to stay below Vercel's function payload limit with multipart overhead. Jobs and applications load in pages. The selected Greenhouse support, Workday limitations and SMTP requirements remain unchanged. Hosting migration does not add new application providers.

## Developer checks

```bash
pnpm install --frozen-lockfile
node tests/storage.mjs
pnpm --filter web typecheck
pnpm --filter web build
```

After modifying any `.prepare(...)` SQL in the API, run `python scripts/generate-careerpilot-db.py`, test, and apply the updated cloud migration before deploying the new query IDs. The RPC accepts only compiled query identifiers and scalar values, not caller-supplied SQL. Batches run in one database transaction. A transaction advisory lock preserves task leasing and completion semantics across multiple web instances; this is suitable for the current testing stage and requires load testing before a larger launch.

Tests use isolated PGlite PostgreSQL and mocked HTTP storage transport. They verify query plans, access restrictions, owner filtering, injection escaping, merge-patch, rollback, duplicate active-task rejection, single task claiming and idempotent completion. They do not establish that your live Supabase project, Storage service, email or employer submissions work end to end.
