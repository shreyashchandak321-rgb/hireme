-- CareerPilot cloud storage. Apply after the Makerkit schema migration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS careerpilot;
-- Make custom-schema tables resolvable to database DDL hooks during setup.
SET LOCAL search_path = pg_catalog, careerpilot, public;
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

INSERT INTO careerpilot.queries(id, sql, arity) VALUES
('5e27cef0ad6a964c484b754539dc9a250a73c7745a5e5ba2a2b019a0246eb591', 'DELETE FROM careerpilot.devices WHERE id=? AND owner=? RETURNING 1 AS affected', 2),
('672fdcddbf3642d6dcd62e9d280f8784199e73fecab9494d62966d46d356410a', 'DELETE FROM careerpilot.records WHERE owner=? AND kind=''application'' AND id=? AND NOT EXISTS (SELECT 1 FROM careerpilot.tasks WHERE owner=? AND application_id=? AND status IN (''queued'',''running'')) RETURNING 1 AS affected', 4),
('06aa707cf6171b2a581b09b966bcf34c36521a5d5675cfbd0a8366ef42e4e12b', 'DELETE FROM careerpilot.records WHERE owner=? AND kind=''freehire-result'' AND updated<? RETURNING 1 AS affected', 2),
('8b1bd0b57dd06523bbe6c102c1b1f5d8a588898e22b6b3f704898e9651c1c5c5', 'DELETE FROM careerpilot.records WHERE owner=? AND kind=''job'' AND (data::jsonb->>''discoveryBoard'')=? AND COALESCE((data::jsonb->>''syncRun''),'''')!=? RETURNING 1 AS affected', 3),
('aa9a32476de0135738d67cf1714e5b370b5ead7059462d99474d4044e31b5b7f', 'INSERT INTO careerpilot.devices(id,owner,hash,name,last_seen,created) VALUES(?,?,?,?,?,?) RETURNING 1 AS affected', 6),
('ca7b207f8426e7adf58450a5314bbff56f5025325301cf489d58717a2fe9c3d1', 'INSERT INTO careerpilot.records(id,owner,kind,data,updated) SELECT ?,?,''application'',?,? WHERE EXISTS(SELECT 1 FROM careerpilot.tasks WHERE id=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated RETURNING 1 AS affected', 5),
('6978a422a1b7583983837396c0eda44e0a42d187aab73f76bae47bb1ba2eef23', 'INSERT INTO careerpilot.records(id,owner,kind,data,updated) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM careerpilot.tasks WHERE id=? AND lease=? AND status=''running'') ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated RETURNING 1 AS affected', 7),
('d1904849cbf1e8dbcb36cf6e528abb5f3d36ade20321f57053a9216976eb303e', 'INSERT INTO careerpilot.records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated RETURNING 1 AS affected', 5),
('2382e222dd67086f3323c27721b24a45474984e5c54575c0deb3e4d3b285b6c0', 'INSERT INTO careerpilot.records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner RETURNING 1 AS affected', 5),
('2f793ebf6ad73a8ebd358ea6db7a8ab0101b4f6f94aab8f0b772f8abe6365dc3', 'INSERT INTO careerpilot.records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=careerpilot.merge_patch(records.data, ?),updated=excluded.updated RETURNING 1 AS affected', 6),
('23c97ccdadd7b4191a05d646bb09374eb02127b52927bf777ad135c00b800b04', 'INSERT INTO careerpilot.records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=(jsonb_set(jsonb_set((records.data)::jsonb, ''{resumeText}'', COALESCE(to_jsonb((?)::text), ''null''::jsonb), true), ''{resumeFile}'', COALESCE(to_jsonb((?)::text), ''null''::jsonb), true))::text,updated=excluded.updated RETURNING 1 AS affected', 7),
('8d33f7ddc8a8e8d82d9c8ebe879b86678318b12f35b76ae3e09f3f06e32f60b4', 'INSERT INTO careerpilot.tasks(id,owner,application_id,type,status,payload,updated,created) SELECT ?,?,?,''apply'',''queued'',?,?,? WHERE EXISTS(SELECT 1 FROM careerpilot.tasks WHERE id=? AND status=''done'' AND lease=?) ON CONFLICT(id) DO NOTHING RETURNING 1 AS affected', 8),
('d88e9dc42e4bff2d2a9723c7a1783da251a5c6e09e6454dda29938e2a78ce330', 'INSERT INTO careerpilot.tasks(id,owner,application_id,type,status,payload,updated,created) SELECT ?,?,?,''tailor'',''queued'',?,?,? WHERE (?=0 OR (SELECT count(*) FROM careerpilot.tasks WHERE owner=? AND created>? AND (type=''apply'' AND COALESCE(CASE (payload::jsonb->>''fastApply'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END,0)!=1 OR type=''tailor'' AND CASE (payload::jsonb->>''fastApply'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END=1) AND status!=''cancelled'')<?) RETURNING 1 AS affected', 10),
('712216688a74e6b2ab61264afbaa2928f9bf73e350626ae32771f2a051611faf', 'INSERT INTO careerpilot.tasks(id,owner,application_id,type,status,payload,updated,created) SELECT ?,?,?,?,?,?,?,? WHERE ?!=''apply'' OR ?=0 OR (SELECT count(*) FROM careerpilot.tasks WHERE owner=? AND created>? AND (type=''apply'' AND COALESCE(CASE (payload::jsonb->>''fastApply'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END,0)!=1 OR type=''tailor'' AND CASE (payload::jsonb->>''fastApply'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END=1) AND status!=''cancelled'')<? RETURNING 1 AS affected', 13),
('e253a8893f5ab112c5d7882ee39788550547fc62815fb0ba822be8097ebd161b', 'INSERT INTO careerpilot.tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,''profile-parse'',''profile-parse'',''queued'',?,?,?) RETURNING 1 AS affected', 5),
('1f3b1e476f63048abe4a6c8589dc40921dd7649c4ec0c5d0b33ac2e65b0bd252', 'INSERT INTO careerpilot.tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,''role-suggestions'',''role-suggest'',''queued'',?,?,?) RETURNING 1 AS affected', 5),
('a032445af3583c5b01ec5a1aaea3015eb3dcb5b1994ca0c9e5acfc5558696541', 'INSERT INTO careerpilot.tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,?,?,?,?,?,?) RETURNING 1 AS affected', 8),
('57852e28050e553af242df158d411046638f76d5efa40ee53d734d801e16706f', 'SELECT * FROM careerpilot.tasks WHERE id=? AND owner=? AND device_id=? AND lease=?', 4),
('3ce7a2979ef741295366bba827854d6680b2b032ddf235e1a6977ab0de6c5bbe', 'SELECT * FROM careerpilot.tasks WHERE id=? AND owner=? AND type IN (''freehire-search'',''freehire-detail'')', 2),
('b4423f4a01d5d3416d72b0442f101d30e2edceae63dc1eaae3d6e29b32df2376', 'SELECT application_id FROM careerpilot.tasks WHERE id=? AND owner=? AND device_id=? AND type=''apply'' AND status=''done''', 3),
('c365b6c0816f9d78f25fb33b0ac0f60aaaadbb06f7b7f49a0902525195a426d8', 'SELECT count(*) AS n FROM careerpilot.tasks WHERE owner=? AND created>? AND (type=''apply'' AND COALESCE(CASE (payload::jsonb->>''fastApply'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END,0)!=1 OR type=''tailor'' AND CASE (payload::jsonb->>''fastApply'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END=1) AND status!=''cancelled''', 2),
('2ed6d5b4dd0197d465e634cf494282fa1c0ba0955ac987354685f3a521045563', 'SELECT d.id FROM careerpilot.devices d JOIN careerpilot.records r ON r.owner=d.owner AND r.id=d.owner||'':worker-runtime:''||d.id WHERE d.owner=? AND d.last_seen>? AND ((r.data::jsonb->>''seen''))::bigint>? AND CASE (r.data::jsonb->>''profileParse'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END=1', 3),
('fa866708930ea546e2d2c1f23c46e5ef7d1883d70a7e74c2ce892809cec65733', 'SELECT d.id FROM careerpilot.devices d JOIN careerpilot.records r ON r.owner=d.owner AND r.id=d.owner||'':worker-runtime:''||d.id WHERE d.owner=? AND d.last_seen>? AND ((r.data::jsonb->>''seen''))::bigint>? AND CASE (r.data::jsonb->>''roleSuggestions'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END=1', 3),
('32d5f681170258f7816ba951926fb2c35c8236d0fdcc6319dea93802a21c9a97', 'SELECT data FROM careerpilot.records WHERE id=? AND owner=? AND kind=?', 3),
('2a7e1242f96d029ae327dffab2649046b97be50cb90a10ebe2fab148ae62b481', 'SELECT data FROM careerpilot.records WHERE owner=? AND kind=''application'' ORDER BY id LIMIT 5 OFFSET ?', 2),
('5a7c9d5ffc551a45145f40042d6f7cd93dbc73694af2533e4b91fdf5aa9517aa', 'SELECT data FROM careerpilot.records WHERE owner=? AND kind=? ORDER BY updated DESC LIMIT 1000', 2),
('3047192e40255122968382ac7ce19ce617be6edd14e1981bb66d67e15faf2f06', 'SELECT id FROM careerpilot.tasks WHERE owner=? AND application_id=''profile-parse'' AND status IN (''queued'',''running'')', 1),
('19b335a1056205316946414c47681c6a85673f0e9151f0478c54ac62b8347c17', 'SELECT id FROM careerpilot.tasks WHERE owner=? AND application_id=? AND status IN (''queued'',''running'')', 2),
('dbe6cef46447108469fb9b30d80fad18d3299b5915535184e15778513d6da577', 'SELECT id FROM careerpilot.tasks WHERE owner=? AND application_id=? AND status=''running''', 2),
('1bb670c002a4edeef190519688b6727a92ecdd78955638a9afc70cc1e2329186', 'SELECT id,application_id,type,status,device_id,updated FROM careerpilot.tasks WHERE owner=? AND status IN (''queued'',''running'')', 1),
('08ccd16d4f2d99af07836b86a5b125136cdc3a3932fb903ea8ba65bbd8242c94', 'SELECT id,name,last_seen FROM careerpilot.devices WHERE owner=? ORDER BY created DESC', 1),
('4d195bbaaaffc09ed9e23ddec957b465f8550ef992a8f2f2501b1a90fecb79a5', 'SELECT id,owner FROM careerpilot.devices WHERE hash=?', 1),
('b982d0911f30251ad9769d8a820b15bfed61651501b26bda47fe9fb6dd68b125', 'SELECT id,status FROM careerpilot.tasks WHERE owner=? AND application_id=''role-suggestions'' AND status IN (''queued'',''running'')', 1),
('b2503bcc34b18f1be9f9ac9c5a7849628d44ed6aacc8ef640cf3a4b5b999c74e', 'SELECT id,status,payload FROM careerpilot.tasks WHERE owner=? AND type=''profile-parse'' AND status IN (''done'',''queued'',''running'') AND (payload::jsonb->>''resumeText'')=? ORDER BY created DESC,id DESC LIMIT 1', 2),
('771a321482e34aaebe50394ee251082fa14b49406d5daf76541ab1c4a7abe0df', 'SELECT id,status,payload,created FROM careerpilot.tasks WHERE id=? AND owner=? AND type=''role-suggest''', 2),
('8d8faedd70f43ae81933382f5379cf45c1b77fcb96a65020040a84ca29ec10f1', 'SELECT (jsonb_set((data)::jsonb, ''{description}'', COALESCE(to_jsonb((substr((data::jsonb->>''description''),1,1600))::text), ''null''::jsonb), true))::text AS data FROM careerpilot.records WHERE owner=? AND kind=''job'' ORDER BY updated DESC,id DESC LIMIT 100 OFFSET ?', 2),
('b3f801008b7287bbb577a707ef590d38e5e31c67231be525fefa548f0e13f42b', 'SELECT owner FROM careerpilot.devices WHERE hash=?', 1),
('d77b39bdc4739f4a9eef779f7543e6897f94a3cbce0d83b97da88cab6efabfa4', 'SELECT payload FROM careerpilot.tasks WHERE owner=? AND application_id=? AND status=''queued''', 2),
('752c208c0155fd5078b04a4db27ae93149b6d8da3614e488df63f39cc49eee7e', 'SELECT r.data FROM careerpilot.records r JOIN careerpilot.devices d ON r.id=d.owner||'':freehire-worker:''||d.id WHERE r.owner=? AND r.kind=''freehire-worker'' AND r.updated>? AND d.owner=? AND CASE (r.data::jsonb->>''configured'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 WHEN ''false'' THEN 0 WHEN ''0'' THEN 0 ELSE NULL END=1 LIMIT 1', 3),
('4c306ea5ea445390daf5acee568753a8f3d9f1d096c29c3275e503a03c5b4d8b', 'SELECT status,payload FROM careerpilot.tasks WHERE owner=? AND id=? AND type=''profile-parse''', 2),
('52ae391acc54e8e8e323982bc329239c3a58c1aee0c8ab6a8c8998a3203c096c', 'SELECT t.id,d.last_seen FROM careerpilot.tasks t LEFT JOIN careerpilot.devices d ON t.device_id=d.id AND t.owner=d.owner WHERE t.owner=? AND t.application_id=? AND t.status=''running''', 2),
('26c51047b4901c516bb9963e683d643701895b265830f4692a7d708fe7323126', 'SELECT type FROM careerpilot.tasks WHERE owner=? AND application_id=? ORDER BY created DESC,id DESC LIMIT 1', 2),
('db826dfc700fd59baf65b77edf34533318b1ec0a7de7fda21def456eb0a151af', 'UPDATE careerpilot.devices SET last_seen=? WHERE id=? RETURNING 1 AS affected', 2),
('99a9f74fa5f05a323fc1c098cf93fade6e91c5112bcf785eb5eecf28bd7a1821', 'UPDATE careerpilot.records SET data=?,updated=? WHERE id=? AND owner=? RETURNING 1 AS affected', 4),
('baf46b4d1dcb4d65f2e02278dc81204991aa86b7af5ae6b2f3831f1e925d8aab', 'UPDATE careerpilot.records SET data=?,updated=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM careerpilot.tasks WHERE id=?) RETURNING 1 AS affected', 5),
('8ed35e3baf565467a9d4f9e4fbb6ce65c2906492d7a41116ef23ac7a55c8c63f', 'UPDATE careerpilot.records SET data=careerpilot.append_event(careerpilot.merge_patch(data, ?), (?)::jsonb),updated=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM careerpilot.tasks WHERE id=? AND lease=? AND status=''running'') RETURNING 1 AS affected', 7),
('3b4db61c94f8474743baff4d4178555d17dd96dfb3aab9a893f13a4b1ead2cb0', 'UPDATE careerpilot.tasks SET status=''cancelled'',updated=? WHERE id=? AND owner=? AND status=''running'' RETURNING 1 AS affected', 3),
('7df829a4f9b13fc9bb63d74d5563ca72385acfcf0415f414eebbc266d1c91182', 'UPDATE careerpilot.tasks SET status=''cancelled'',updated=? WHERE owner=? AND application_id=? AND status=''queued'' RETURNING 1 AS affected', 3),
('dcc800343e4903a62f58f5fb5b9686d1221c35f9efbd5c9734df4f8699933d8f', 'UPDATE careerpilot.tasks SET status=''failed'',updated=? WHERE id=? AND owner=? AND status IN (''queued'',''running'') RETURNING 1 AS affected', 3),
('7c6058c4f8d39b6d6aa5411ceea9d5087d5ff84cbb055c644ade6302fc855c02', 'UPDATE careerpilot.tasks SET status=''running'',lease=?,device_id=?,updated=? WHERE id=(SELECT id FROM careerpilot.tasks WHERE owner=? AND (type IN (''tailor'',''apply'',''pdf'',''followup'') OR (type=''role-suggest'' AND ?=1) OR (type=''profile-parse'' AND ?=1)) AND status=''queued'' ORDER BY CASE WHEN type IN (''role-suggest'',''profile-parse'') THEN 0 WHEN type=''apply'' THEN 1 ELSE 2 END,created ASC,id ASC LIMIT 1) AND status=''queued'' RETURNING *', 6),
('79a6b38b975f03d987161ccd1abb2503e9c25a247c94a708ff0b6dbda32b9f40', 'UPDATE careerpilot.tasks SET status=''running'',lease=?,device_id=?,updated=? WHERE id=(SELECT id FROM careerpilot.tasks WHERE owner=? AND type IN (''freehire-search'',''freehire-detail'') AND status=''queued'' AND created>? ORDER BY created ASC,id ASC LIMIT 1) AND status=''queued'' RETURNING *', 5),
('9265db7c105e4858d483cacf0bc1f034a069d64e9b3a8b32938f680a119af1cf', 'UPDATE careerpilot.tasks SET status=?,payload=(jsonb_set((payload)::jsonb, ''{result}'', (?)::jsonb, true))::text,updated=? WHERE id=? AND owner=? AND lease=? AND status=''running'' RETURNING 1 AS affected', 6),
('c05924b84c6f3734902c7a43b867d123e0df4ed9346c93f30b9434f151b8a4c6', 'UPDATE careerpilot.tasks SET status=?,updated=? WHERE id=? AND lease=? AND status=''running'' RETURNING 1 AS affected', 4)
ON CONFLICT (id) DO UPDATE SET sql=excluded.sql, arity=excluded.arity;

NOTIFY pgrst, 'reload schema';
COMMIT;
