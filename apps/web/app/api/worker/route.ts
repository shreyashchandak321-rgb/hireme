export const maxDuration=60;
import {hasParsedValue,normalizeCandidate,mailClassification} from '../../careerpilot/lib/candidate';
import {completeFreehire} from '../../careerpilot/lib/worker-freehire';
import {database,hash,json,error,read,list,now,clean,rid,write} from '../../careerpilot/lib/server';
import {Application} from '../../careerpilot/lib/types';
async function device(request:Request){const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return null;return database().prepare('SELECT id,owner FROM devices WHERE hash=?').bind(await hash(token)).first<{id:string;owner:string}>();}
export async function GET(request:Request){try{
  const d=await device(request);if(!d)return error('Worker key is invalid or revoked',401);
  await database().prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(Date.now(),d.id).run();
  const mode=new URL(request.url).searchParams.get('mode');if(mode==='heartbeat'){const params=new URL(request.url).searchParams;if(params.get('fast_apply')==='1')await write(d.owner,'worker-runtime',d.id,{deviceId:d.id,seen:Date.now(),fastApply:true,roleSuggestions:params.get('role_suggestions')==='1',profileParse:params.get('profile_parse')==='1',inboxReady:params.get('inbox_ready')==='1',model:clean(params.get('model'),150),smtpReady:params.get('smtp_ready')==='1'});return json({ok:true});}
  if(mode==='inbox')return json({applications:(await list<Application>(d.owner,'application')).filter(a=>['Applied','Application received','Assessment','Response received','Interview','Needs attention'].includes(a.status)).map(a=>({id:a.id,company:a.job.company,title:a.job.title,url:a.job.url,created:a.created}))});
  if(mode==='freehire'){const configured=new URL(request.url).searchParams.get('configured')==='1';await write(d.owner,'freehire-worker',d.id,{configured});if(!configured)return json({task:null});const lease=crypto.randomUUID();const task=await database().prepare("UPDATE tasks SET status='running',lease=?,device_id=?,updated=? WHERE id=(SELECT id FROM tasks WHERE owner=? AND type IN ('freehire-search','freehire-detail') AND status='queued' AND created>? ORDER BY created ASC,id ASC LIMIT 1) AND status='queued' RETURNING *").bind(lease,d.id,Date.now(),d.owner,Date.now()-60000).first<any>();return json({task:task?{id:task.id,type:task.type,lease,payload:JSON.parse(task.payload)}:null});}
  const lease=crypto.randomUUID();const task=await database().prepare("UPDATE tasks SET status='running',lease=?,device_id=?,updated=? WHERE id=(SELECT id FROM tasks WHERE owner=? AND (type IN ('tailor','apply','pdf','followup') OR (type='role-suggest' AND ?=1) OR (type='profile-parse' AND ?=1)) AND status='queued' ORDER BY CASE WHEN type IN ('role-suggest','profile-parse') THEN 0 WHEN type='apply' THEN 1 ELSE 2 END,created ASC,id ASC LIMIT 1) AND status='queued' RETURNING *").bind(lease,d.id,Date.now(),d.owner,new URL(request.url).searchParams.get('role_suggestions')==='1'?1:0,new URL(request.url).searchParams.get('profile_parse')==='1'?1:0).first<any>();
  if(!task)return json({task:null});return json({task:{id:task.id,type:task.type,lease,payload:JSON.parse(task.payload)}});
}catch{return error('Worker queue unavailable',503);}}
export async function POST(request:Request){try{
  const d=await device(request);if(!d)return error('Invalid worker key',401);
  const raw=await request.text();if(raw.length>2100000)return error('Result too large',413);let b:any;try{b=JSON.parse(raw);}catch{return error('Invalid JSON');}if(!b||typeof b!=='object')return error('Invalid result');
  if(b.action&&raw.length>150000)return error('Result too large',413);
  if(b.action==='notification'){
    const task=await database().prepare("SELECT application_id FROM tasks WHERE id=? AND owner=? AND device_id=? AND type='apply' AND status='done'").bind(clean(b.taskId,100),d.owner,d.id).first<{application_id:string}>();
    if(!task||!['sent','uncertain'].includes(b.status))return error('No confirmed application for this notification');
    const app=await read<Application>(d.owner,'application',task.application_id);if(!app)return error('Application not found',404);
    const marker='Notification '+clean(b.taskId,100)+': ';if(app.events.some(e=>e.label.startsWith(marker)))return json({ok:true});
    app.events.push({at:now(),label:marker+(b.status==='sent'?'submission email accepted by your SMTP server.':'email delivery uncertain; check the sender account before retrying.')});
    await database().prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=?').bind(JSON.stringify(app),Date.now(),rid(d.owner,'application',app.id),d.owner).run();return json({ok:true});
  }
  if(b.action==='mail-event'){
    const app=await read<Application>(d.owner,'application',clean(b.applicationId,300));if(!app)return error('Application not found',404);
    if(!['Applied','Application received','Assessment','Response received','Interview','Needs attention'].includes(app.status))return error('This application is not being monitored.');
    const id=clean(b.messageId,250);if(!id)return error('Message ID required');if(app.messages?.some(m=>m.id===id))return json({ok:true});
    const at=now(),subject=clean(b.subject,300),snippet=clean(b.snippet,3000),from=clean(b.from,300),receivedAt=clean(b.receivedAt,50);
    const classification=snippet?mailClassification(subject,snippet):'unknown';
    const received=Date.parse(receivedAt),validDate=Number.isFinite(received)&&received>=Date.parse(app.created)&&received<Date.now()+86400000;
    const context=(subject+' '+snippet).toLowerCase().replace(/[^a-z0-9]+/g,' '),title=app.job.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),company=app.job.company.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const domain=from.match(/@([^>\s]+)/)?.[1]?.toLowerCase()||'';
    const senderOK=['greenhouse.io','greenhouse-mail.io','myworkday.com','workday.com','lever.co','ashbyhq.com','smartrecruiters.com'].some(d=>domain===d||domain.endsWith('.'+d))||company.split(' ').filter(w=>w.length>2&&!['inc','ltd','llc','company','the'].includes(w)).some(w=>domain.split('.').slice(-2,-1).includes(w));
    const matching=(await list<Application>(d.owner,'application')).filter(a=>{const t=a.job.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),c=a.job.company.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();return t&&c&&context.includes(t)&&context.includes(c);});
    const verified=validDate&&senderOK&&title&&company&&matching.length===1&&matching[0]!.id===app.id&&b.classification===classification&&classification!=='unknown';
    app.messages=[...(app.messages||[]),{id,subject,at,from,classification:verified?classification:'unknown',snippet}].slice(-100);
    const next=classification==='receipt'?'Application received':classification==='interview'?'Interview':classification==='assessment'?'Assessment':'Rejected';
    const rank:Record<string,number>={'Needs attention':0,'Applied':1,'Application received':2,'Assessment':3,'Response received':3,'Interview':4,'Rejected':5};
    if(verified&&(rank[next]||0)>(rank[app.status]||0)){app.status=next;if(!app.appliedAt)app.appliedAt=receivedAt;}
    app.updated=at;app.events.push({at,label:verified?'Employer email evidence: '+next+' — '+subject:'Possible employer email detected. Review the evidence before changing status.'});
    await write(d.owner,'application',app.id,app);return json({ok:true});
  }
  const task=await database().prepare('SELECT * FROM tasks WHERE id=? AND owner=? AND device_id=? AND lease=?').bind(clean(b.id,100),d.owner,d.id,clean(b.lease,100)).first<any>();
  if(!task)return error('Task lease is invalid',409);if(['done','failed'].includes(task.status))return json({ok:true,alreadyCompleted:true});if(task.status!=='running')return error('Task lease was cancelled',409);
  if(task.type==='profile-parse'){
    let result:any={error:clean(b.detail,1000)||'Profile parsing failed.'};
    if(b.ok===true){try{const details=normalizeCandidate(b.details||{});details.workAuthorization=[];details.answers=[];details.gender='';details.ethnicity='';details.veteran='';details.disability='';details.currentSalary='';details.expectedSalary='';details.noticeDays='';details.startDate='';result={details,contact:{}};for(const key of ['name','email','phone','linkedin','portfolio','skills'])result.contact[key]=clean(b.contact?.[key],key==='skills'?4000:500);}catch{return error('Invalid parsed profile.');}}
    if(b.ok===true&&!hasParsedValue(result)){b.ok=false;result={error:'The model returned no usable resume details. Check the extracted resume text and try parsing again.'};}
    await database().prepare("UPDATE tasks SET status=?,payload=json_set(payload,'$.result',json(?)),updated=? WHERE id=? AND owner=? AND lease=? AND status='running'").bind(b.ok===true?'done':'failed',JSON.stringify(result),Date.now(),task.id,d.owner,task.lease).run();return json({ok:true});
  }
  if(task.type==='role-suggest'){
    let roles:string[]=[];
    if(b.ok===true){if(!Array.isArray(b.roles))return error('Worker returned no title list.');roles=[...new Set<string>(b.roles.filter((r:any)=>typeof r==='string'&&r.trim().length>=2&&r.trim().length<=90&&!/[\r\n<>]/.test(r)).map((r:string)=>r.trim()))].slice(0,8);if(!roles.length)return error('Worker returned no usable titles.');}
    const result=b.ok===true?{roles}:{error:clean(b.detail,1000)||'Ollama could not generate title suggestions.'};
    await database().prepare("UPDATE tasks SET status=?,payload=json_set(payload,'$.result',json(?)),updated=? WHERE id=? AND owner=? AND lease=? AND status='running'").bind(b.ok===true?'done':'failed',JSON.stringify(result),Date.now(),task.id,d.owner,task.lease).run();return json({ok:true});
  }
  if(['freehire-search','freehire-detail'].includes(task.type))return json(await completeFreehire(task,b));
  if(raw.length>150000)return error('Result too large',413);
  const app=await read<Application>(d.owner,'application',task.application_id);if(!app)return error('Application not found',404);
  const original={...app};const at=now();let ok=b.ok===true;
  if(task.type==='tailor'&&ok){
    if(!clean(b.resumeText))return error('Worker returned an empty resume');app.resumeText=clean(b.resumeText,60000);delete app.resumeFile;app.status='Ready to review';
  }else if(task.type==='followup'&&ok){if(!clean(b.message))return error('Worker returned an empty follow-up draft');app.message=clean(b.message,10000);}
  else if(task.type==='pdf'&&ok){if(!clean(b.fileId,100))return error('Worker returned no PDF');}
  else if(task.type==='apply'&&ok&&b.confirmed===true){app.status='Applied';app.appliedAt=at;app.followUp=new Date(Date.now()+7*86400000).toISOString().slice(0,10);}
  else {ok=false;if(task.type==='apply'||task.type==='tailor')app.status='Needs attention';}
  if(ok&&['tailor','pdf'].includes(task.type)&&b.fileId){const file=await read(d.owner,'file',clean(b.fileId,100));if(!file||!file.name.toLowerCase().endsWith('.pdf'))return error('PDF does not belong to this workspace');app.resumeFile=file.id;}
  const payload=JSON.parse(task.payload);const chain=task.type==='tailor'&&ok&&payload.fastApply===true;
  if(chain)app.status='Awaiting submission';
  app.updated=at;const event={label:chain?'Tailored resume saved. Fast Apply submission queued automatically.':clean(b.detail,1500)||(ok?'Local worker completed task':'Worker needs your attention'),at};const patch:Record<string,unknown>={};for(const key of ['status','followUp','resumeText','resumeFile','message','appliedAt','updated'] as const)if(app[key]!==original[key])patch[key]=app[key]??null;
  // Both writes commit together; a replay cannot overwrite later application edits.
  const statements=[
    database().prepare("UPDATE records SET data=json_insert(json_patch(data,?), '$.events[#]', json(?)),updated=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND lease=? AND status='running')").bind(JSON.stringify(patch),JSON.stringify(event),Date.now(),rid(d.owner,'application',app.id),d.owner,task.id,task.lease),
    database().prepare("UPDATE tasks SET status=?,updated=? WHERE id=? AND lease=? AND status='running'").bind(ok?'done':'failed',Date.now(),task.id,task.lease),
  ];
  if(chain){
    const nextId='fast-'+task.id;
    statements.push(database().prepare("INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) SELECT ?,?,?,'apply','queued',?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=? AND status='done' AND lease=?) ON CONFLICT(id) DO NOTHING").bind(nextId,d.owner,app.id,JSON.stringify({...payload,resumeText:app.resumeText,previousStatus:'Ready to review'}),Date.now(),Date.now(),task.id,task.lease));
  }
  await database().batch(statements);return json({ok:true});
}catch{return error('Worker result could not be saved',500);}}
