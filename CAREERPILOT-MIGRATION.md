# CareerPilot SaaS migration

This Makerkit-based repository is the sole target for future changes. The previous Sites app remains a fallback until a successful cutover.

## Current architecture

The Next.js website can run on Vercel. Supabase provides authentication, Postgres application storage and private resume storage. No local writable filesystem or SQLite is used by the website. Ollama, FreeHire, SMTP/IMAP processing and the application worker continue running on the VPS.

Follow [VERCEL-SETUP.md](./VERCEL-SETUP.md) for the new SQL migration, environment variables, authentication URLs and worker pairing.

The backend verifies the Supabase user or paired worker token before owner-scoped queries. CareerPilot tables reside in a private schema with row-level security enabled and no browser access policies. A service-only RPC executes a finite compiled query registry, using one transaction per batch. The service key must remain private in Vercel. Files are stored in the private careerpilot-files bucket and fetched through authenticated owner checks.

## Verification and limits

The cloud migration and 53 query plans passed isolated PostgreSQL checks. Tests passed for public-role denial, owner filtering, escaped SQL values, partial profile updates, transaction rollback, active-task uniqueness, one-time leasing, idempotent completion and file transport. TypeScript and the production Next.js build passed.

Live Supabase migration execution, user sign-up/login, actual Supabase Storage uploads, SMTP delivery and employer submissions still need verification after deployment. The migration has not been applied remotely by this coding session. Existing SQLite/Sites records and files have not been copied; identity mappings must be handled explicitly before importing old data. Keep the old data backed up.

Resumes are limited to 3 MB for Vercel request compatibility. Automatic submission supports selected Greenhouse forms; Workday remains unsupported. Makerkit Lite does not include billing. Public launch still needs operational quotas, abuse controls and measured worker capacity.

Upstream Makerkit revision: 9ff430df9c58516add0136bd01ed800ce551675e. MIT license retained in LICENSE.
