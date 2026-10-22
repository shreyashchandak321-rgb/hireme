# CareerPilot SaaS migration

This Makerkit-based project is the sole target for future features and fixes, including public/worker.py. The existing Sites application is retained as a fallback. This source has not replaced the live deployment.

## Architecture

Makerkit Lite supplies the Next.js application, Supabase authentication, account settings, and public pages. CareerPilot lives at /careerpilot; its API routes preserve the existing worker protocol. Authentication checks Supabase getUser on the server; incoming ChatGPT identity headers are not trusted. API records and files remain scoped to the authenticated user or paired worker token.

CareerPilot operational data uses Node SQLite (WAL) and private local files under CAREERPILOT_DATA_DIR. Run ONE Node server with a durable disk and backups. This is a single-VPS deployment, not a stateless/serverless or horizontally scaled deployment. Supabase holds authentication and Makerkit account data. Moving operational records to Postgres is a separate migration.

## Setup tomorrow

1. Use Node >=22.13, pnpm as specified in package.json. Run pnpm install.
2. Create/connect Supabase. Copy apps/web/.env.local.example to apps/web/.env.local and supply your project URL and anon/publishable key, correct site URL, and server-only service role key if using account deletion.
3. Apply the included Makerkit Supabase migrations to the selected new project. Configure auth Site URL and redirects for the deployed domain. Do not reset an existing production database.
4. Set an absolute CAREERPILOT_DATA_DIR on persistent storage, readable/writable only by the application service account. Back up that entire directory.
5. Run pnpm --filter web typecheck and pnpm --filter web build, then pnpm --filter web start. Put HTTPS in front of the app.
6. Sign up two test users; verify profile, file, bookmark, device and application isolation. Verify email confirmation/reset and sign-out. Live auth testing is pending Supabase setup.
7. Pair a worker from the NEW workspace. Use its new base URL and token; restart the worker. Keep the existing worker configuration backed up. Test one authorized application, checking employer confirmation.

## Limits and pending work

No real Supabase credentials are included. No payments/subscriptions have been added (Makerkit Lite does not supply billing). No live employer submission was performed during migration. Workday automation remains unsupported. Email application notifications require SMTP configuration. Existing Sites records/files have NOT been imported: identity IDs differ and need an explicit ownership-aware migration. Do not claim data migration complete or retire the old app yet.

FreeHire and Ollama continue as separate services on the VPS; each user pairs a worker with a scoped token. For public launch, add operational quotas, abuse controls and measured multi-user worker capacity. This version is a SaaS foundation for testing, not a claim of production launch readiness.

Run `node tests/storage.mjs` with Node 24 for storage adapter checks. This is not an end-to-end Supabase authentication test.

## Verified in this migration
TypeScript check passed. Next.js production build passed with placeholder public Supabase configuration. Storage adapter checks passed. Real sign-up/login, UI browser QA, SMTP delivery and employer submissions are not verified.

Upstream Makerkit revision: 9ff430df9c58516add0136bd01ed800ce551675e. MIT license retained in LICENSE.
