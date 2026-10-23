// Runs the actual cloud migration and runtime against an isolated PostgreSQL engine.
// No live credentials, real resumes, or job submissions are used.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
await db.exec(fs.readFileSync(new URL('../apps/web/supabase/migrations/20261022000000_careerpilot_cloud.sql',import.meta.url),'utf8'));
const alice='00000000-0000-0000-0000-000000000001',bob='00000000-0000-0000-0000-000000000002';
await db.query('INSERT INTO auth.users VALUES ($1),($2)',[alice,bob]);
const queries=(await db.query('SELECT * FROM careerpilot.queries')).rows;
await db.exec('SET search_path=careerpilot,pg_catalog');
for(const q of queries)await db.query('EXPLAIN '+q.sql.replaceAll('?','NULL'));
for(const role of ['anon','authenticated']){
 await db.exec(`SET ROLE ${role}`);
 await assert.rejects(db.query("SELECT public.careerpilot_batch('[]')"),/permission denied/);
 await assert.rejects(db.query('SELECT * FROM careerpilot.records'),/permission denied/);
 await db.exec('RESET ROLE');
}
const objects=new Map();let calls=0;
process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 calls++;
 assert.equal(init.headers.get('apikey'),'test-service-key');assert.equal(init.cache,'no-store');
 if(url.endsWith('/rpc/careerpilot_batch')){
  const {operations}=JSON.parse(init.body);
  const result=await db.query('SELECT public.careerpilot_batch($1::jsonb) AS value',[JSON.stringify(operations)]);
  return Response.json(result.rows[0].value);
 }
 const key=url.split('/storage/v1/object/')[1];
 if(init.method==='POST'){assert.equal(init.headers.get('x-upsert'),'false');objects.set(key,{bytes:new Uint8Array(await init.body.arrayBuffer()),type:init.headers.get('content-type')});return Response.json({});}
 const obj=objects.get(key);return obj?new Response(obj.bytes,{headers:{'Content-Type':obj.type}}):new Response('',{status:404});
};
const base=new URL('../apps/web/app/careerpilot/',import.meta.url);
const registry=fs.readFileSync(new URL('query-registry.ts',base),'utf8').replace('export const','const');
const source=fs.readFileSync(new URL('runtime.ts',base),'utf8').replace("import 'server-only';",'').replace("import {queryIds} from './query-registry';",registry);
const {env}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const sql=(start)=>{const found=Object.keys(JSON.parse(registry.slice(registry.indexOf('=')+1).trim().replace(/;$/,''))).filter(q=>q.startsWith(start));assert.equal(found.length,1,start);return found[0];};
const insert=sql('INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE');
const read=sql('SELECT data FROM records WHERE id=? AND owner=? AND kind=?');
const write=(id,owner,data)=>env.DB.prepare(insert).bind(id,owner,'profile',JSON.stringify(data),1);
for(const owner of [alice,bob])await write(owner+':profile:main',owner,{name:owner,phone:'123',nested:{a:1,b:2}}).run();
assert.equal(await env.DB.prepare(read).bind(bob+':profile:main',alice,'profile').first(),null);
const evil="Robert'); DELETE FROM careerpilot.records; -- ?";
await write(alice+':profile:main',alice,{name:evil,phone:'123',nested:{a:1,b:2}}).run();
assert.equal(JSON.parse((await env.DB.prepare(read).bind(alice+':profile:main',alice,'profile').first()).data).name,evil);
const patch=sql('INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=json_patch');
await env.DB.prepare(patch).bind(alice+':profile:main',alice,'profile','{}',2,JSON.stringify({nested:{a:null,c:3}})).run();
const profile=JSON.parse((await env.DB.prepare(read).bind(alice+':profile:main',alice,'profile').first()).data);
assert.equal(profile.phone,'123');assert.deepEqual(profile.nested,{b:2,c:3});
await assert.rejects(env.DB.batch([write('rollback',alice,{}),write('bad-owner','00000000-0000-0000-0000-000000000099',{})]));
assert.equal(await env.DB.prepare(read).bind('rollback',alice,'profile').first(),null);
const before=calls;await assert.rejects(env.DB.prepare('DROP TABLE records').run());assert.equal(calls,before);
const taskInsert=sql('INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,?,?,?,?,?,?)');
await env.DB.prepare(taskInsert).bind('task1',alice,'app1','apply','queued','{}',1,1).run();
await assert.rejects(env.DB.prepare(taskInsert).bind('duplicate',alice,'app1','apply','queued','{}',1,1).run());
const claim=sql("UPDATE tasks SET status='running',lease=?,device_id=?,updated=? WHERE id=(SELECT id FROM tasks WHERE owner=? AND (type IN");
const claims=await Promise.all(['lease1','lease2'].map(lease=>env.DB.prepare(claim).bind(lease,'device1',2,alice,1,1).first()));
assert.equal(claims.filter(Boolean).length,1);const lease=claims.find(Boolean).lease;
await write(alice+':application:app1',alice,{status:'Awaiting submission',events:[]}).run();
const update=sql('UPDATE records SET data=json_insert');
const finish=sql('UPDATE tasks SET status=?,updated=? WHERE id=? AND lease=?');
const complete=()=>env.DB.batch([env.DB.prepare(update).bind('{"status":"Applied"}','{"label":"confirmed"}',3,alice+':application:app1',alice,'task1',lease),env.DB.prepare(finish).bind('done',3,'task1',lease)]);
assert.equal((await complete())[0].meta.changes,1);assert.equal((await complete())[0].meta.changes,0);
const saved=JSON.parse((await db.query('SELECT data FROM records WHERE id=$1',[alice+':application:app1'])).rows[0].data);
assert.equal(saved.events.length,1);assert.equal(saved.status,'Applied');
await env.BUCKET.put(alice+'/resume',new Uint8Array([1,2,3]),{httpMetadata:{contentType:'application/pdf'}});
const download=await env.BUCKET.get(alice+'/resume');assert.deepEqual([...new Uint8Array(await new Response(download.body).arrayBuffer())],[1,2,3]);
await assert.rejects(env.BUCKET.put('../escape',new Uint8Array([1])));
assert.equal(objects.has('careerpilot-files/'+bob+'/resume'),false);
globalThis.fetch=originalFetch;
await db.close();
console.log(`PASS: ${queries.length} query plans, access denial, owner isolation, injection escaping, merge-patch, rollback, unique active tasks, single lease, idempotent completion, cloud file roundtrip.`);
