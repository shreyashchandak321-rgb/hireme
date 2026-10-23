-- CareerPilot cloud storage. Apply after the Makerkit schema migration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS careerpilot;
REVOKE ALL ON SCHEMA careerpilot FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS careerpilot.records (
 id text PRIMARY KEY, owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL, data text NOT NULL CHECK (jsonb_typeof(data::jsonb) IS NOT NULL), updated bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS careerpilot.devices (
 id text PRIMARY KEY, owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 hash text NOT NULL UNIQUE, name text NOT NULL, last_seen bigint NOT NULL, created bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS careerpilot.tasks (
 id text PRIMARY KEY, owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 application_id text NOT NULL, type text NOT NULL, status text NOT NULL,
 payload text NOT NULL CHECK (jsonb_typeof(payload::jsonb) IS NOT NULL), lease text, device_id text,
 updated bigint NOT NULL, created bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS records_owner_kind ON careerpilot.records(owner,kind,updated DESC);
CREATE INDEX IF NOT EXISTS devices_owner ON careerpilot.devices(owner);
CREATE INDEX IF NOT EXISTS tasks_owner_status ON careerpilot.tasks(owner,status,created);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_application ON careerpilot.tasks(owner,application_id) WHERE status IN ('queued','running');
ALTER TABLE careerpilot.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE careerpilot.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE careerpilot.tasks ENABLE ROW LEVEL SECURITY;
-- No public policies: all access passes through authenticated Next.js routes.
CREATE TABLE IF NOT EXISTS careerpilot.queries(id text PRIMARY KEY, sql text NOT NULL, arity integer NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA careerpilot FROM PUBLIC, anon, authenticated;

-- RFC 7396 merge-patch preserves unrelated profile fields and removes null keys.
CREATE OR REPLACE FUNCTION careerpilot.merge_patch(target text, patch text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, careerpilot AS $$
DECLARE result jsonb := target::jsonb; p jsonb := patch::jsonb; k text; v jsonb;
BEGIN
 IF jsonb_typeof(p) <> 'object' THEN RETURN p::text; END IF;
 IF jsonb_typeof(result) <> 'object' OR result IS NULL THEN result := '{}'::jsonb; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p) LOOP
  IF v = 'null'::jsonb THEN result := result - k;
  ELSE result := jsonb_set(result, ARRAY[k], careerpilot.merge_patch((result->k)::text,v::text)::jsonb, true); END IF;
 END LOOP;
 RETURN result::text;
END $$;
CREATE OR REPLACE FUNCTION careerpilot.append_event(target text, event jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT jsonb_set(target::jsonb, '{events}', COALESCE(target::jsonb->'events','[]'::jsonb) || jsonb_build_array(event),true)::text
$$;

-- Fixed registry, scalar bound values, and one transaction per batch.
-- Never accepts raw SQL from the caller. Only the backend service key can execute.
CREATE OR REPLACE FUNCTION public.careerpilot_batch(operations jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, careerpilot AS $$
DECLARE op jsonb; template text; arity integer; parts text[]; query text; values jsonb;
 i integer; value jsonb; rows jsonb; output jsonb := '[]'::jsonb;
BEGIN
 IF jsonb_typeof(operations) IS DISTINCT FROM 'array' OR jsonb_array_length(operations) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid operation batch'; END IF;
 -- Preserve serialized task leasing/completion semantics across Vercel instances.
 -- A failed statement rolls back the entire batch. Never automatically retry mutations.
 PERFORM pg_advisory_xact_lock(731941, 1);
 FOR op IN SELECT * FROM jsonb_array_elements(operations) LOOP
  SELECT q.sql, q.arity INTO template, arity FROM careerpilot.queries q WHERE q.id=op->>'id';
  IF template IS NULL THEN RAISE EXCEPTION 'Unknown database operation'; END IF;
  values := op->'values';
  IF jsonb_typeof(values) IS DISTINCT FROM 'array' OR jsonb_array_length(values) <> arity THEN
   RAISE EXCEPTION 'Invalid operation parameters'; END IF;
  parts := string_to_array(template,'?'); query := parts[1];
  IF arity > 0 THEN
   FOR i IN 0..arity-1 LOOP
    value := values->i;
    IF jsonb_typeof(value) NOT IN ('string','number','boolean','null') THEN
     RAISE EXCEPTION 'Only scalar parameters are accepted'; END IF;
    query := query || quote_nullable(values->>i) || parts[i+2];
   END LOOP;
  END IF;
  EXECUTE 'WITH result AS (' || query || ') SELECT COALESCE(jsonb_agg(to_jsonb(result)),''[]''::jsonb) FROM result' INTO rows;
  output := output || jsonb_build_array(jsonb_build_object('results',rows,'success',true,'meta',jsonb_build_object('changes',jsonb_array_length(rows))));
 END LOOP;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.careerpilot_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.careerpilot_batch(jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA careerpilot FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('careerpilot-files','careerpilot-files',false,3145728,ARRAY['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
