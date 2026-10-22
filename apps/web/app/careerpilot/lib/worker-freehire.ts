import {database,read,write,now,clean,rid} from './server';
import {freehireParameters,validateFreehireSearch,validateFreehireDetail,FreeHireError} from './freehire';
import {Profile,Job,Application} from './types';
export async function freehireWorkerAvailable(owner:string){const row=await database().prepare("SELECT r.data FROM records r JOIN devices d ON r.id=d.owner||':freehire-worker:'||d.id WHERE r.owner=? AND r.kind='freehire-worker' AND r.updated>? AND d.owner=? AND json_extract(r.data,'$.configured')=1 LIMIT 1").bind(owner,Date.now()-60000,owner).first();return !!row;}
export async function saveFreehireJob(owner:string,job:Job){await write(owner,'job',job.id,job);let app=await read<Application>(owner,'application',job.id);if(app)return {application:app,existing:true};const at=now();app={id:job.id,job,status:'Saved',created:at,updated:at,followUp:'',notes:'',events:[{label:'Saved from FreeHire with full job details',at}]};await write(owner,'application',app.id,app);return {application:app};}
export async function enqueueFreehire(owner:string,profile:Profile,query:string,offset:number,slug?:string){
 if(!await freehireWorkerAvailable(owner))throw new FreeHireError('FreeHire is not connected. Start your FreeHire backend, set freehire_url in the updated worker configuration, and start that worker. Or connect a server with FREEHIRE_API_URL.',503);
 if(slug&&!/^[-a-zA-Z0-9_]{1,250}$/.test(slug))throw new FreeHireError('Invalid FreeHire job identifier.');
 const payload=slug?{slug}:{params:Object.fromEntries(freehireParameters(profile,query,offset)),offset};
 const id=crypto.randomUUID(),at=Date.now();await database().prepare("INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,?,?,?,?,?,?)").bind(id,owner,'catalogue:'+id,slug?'freehire-detail':'freehire-search','queued',JSON.stringify(payload),at,at).run();
 await database().prepare("DELETE FROM records WHERE owner=? AND kind='freehire-result' AND updated<?").bind(owner,at-3600000).run();
 return {pending:true,requestId:id};
}
export async function freehireResult(owner:string,id:string){
 const task=await database().prepare("SELECT * FROM tasks WHERE id=? AND owner=? AND type IN ('freehire-search','freehire-detail')").bind(id,owner).first<any>();if(!task)throw new FreeHireError('Catalogue request not found.',404);
 const result=await read<any>(owner,'freehire-result',id);
 if(task.status==='done'&&result){if(task.type==='freehire-detail')return saveFreehireJob(owner,result.job);return result;}
 if(task.status==='failed')throw new FreeHireError(result?.error||'Your FreeHire worker could not complete this request.',502);
 if(Date.now()-task.created>60000){await database().prepare("UPDATE tasks SET status='failed',updated=? WHERE id=? AND owner=? AND status IN ('queued','running')").bind(Date.now(),id,owner).run();throw new FreeHireError('FreeHire worker timed out. Check its terminal and backend, then search again.',504);}
 return {pending:true,requestId:id};
}
export async function completeFreehire(task:any,body:any){
 let result:any,ok=body.ok===true;
 if(ok){try{const payload=JSON.parse(task.payload);result=task.type==='freehire-search'?validateFreehireSearch(body.data,payload.offset):{job:validateFreehireDetail(body.data,payload.slug)};}catch(e){ok=false;result={error:e instanceof Error?e.message:'Unsupported FreeHire response'};}}
 else result={error:clean(body.detail,1000)||'The local FreeHire backend could not be reached.'};
 const timestamp=Date.now();await database().batch([
 database().prepare("INSERT INTO records(id,owner,kind,data,updated) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=? AND lease=? AND status='running') ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated").bind(rid(task.owner,'freehire-result',task.id),task.owner,'freehire-result',JSON.stringify(result),timestamp,task.id,task.lease),
 database().prepare("UPDATE tasks SET status=?,updated=? WHERE id=? AND lease=? AND status='running'").bind(ok?'done':'failed',timestamp,task.id,task.lease)]);
 return {ok:true};
}
