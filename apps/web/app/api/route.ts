import {hasParsedValue,normalizeCandidate} from '../careerpilot/lib/candidate';
import {freehireWorkerAvailable,enqueueFreehire,freehireResult,saveFreehireJob} from '../careerpilot/lib/worker-freehire';
import {freehireConfigured,freehireParameters,searchFreehire,freehireDetail,FreeHireError} from '../careerpilot/lib/freehire';
import {getChatGPTUser} from '../careerpilot/auth';
import {env} from '~/careerpilot/runtime';
import {database,read,list,write,json,error,clean,hash,now,safeURL,plain} from '../careerpilot/lib/server';
import {defaultProfile,samples,statuses,Profile,Application,Job,discoveryBoards,recommendation,applicationRequirements,preferenceKeys,applicationJob} from '../careerpilot/lib/types';
export const dynamic='force-dynamic';
export async function GET(request?:Request){try{const user=await getChatGPTUser();if(!user)return json({preview:true,profile:defaultProfile,jobs:[],applications:[],devices:[],sources:[],files:[]});const updates=!!request&&new URL(request.url).searchParams.get('updates')==='1';if(request&&new URL(request.url).searchParams.get('jobs')==='1')return json({jobs:await list(user.userId,'job')});const [profile,jobs,applications,sources,files,devices,tasks,runtimes]=await Promise.all([read(user.userId,'profile'),updates?Promise.resolve(undefined):list(user.userId,'job'),list(user.userId,'application'),read(user.userId,'sources'),list(user.userId,'file'),database().prepare('SELECT id,name,last_seen FROM devices WHERE owner=? ORDER BY created DESC').bind(user.userId).all(),database().prepare("SELECT id,application_id,type,status,device_id,updated FROM tasks WHERE owner=? AND status IN ('queued','running')").bind(user.userId).all(),list(user.userId,'worker-runtime')]);return json({freehire:{configured:freehireConfigured(),workerAvailable:await freehireWorkerAvailable(user.userId)},user:{name:user.displayName,email:user.email},profile:{...defaultProfile,...profile},jobs,applications,sources:sources||[],files,devices:devices.results,tasks:tasks.results,bookmarks:await list(user.userId,'bookmark'),workerRuntime:runtimes});}catch(e){console.error('State read failed',e instanceof Error?e.message:'unknown');return error('Workspace is temporarily unavailable. Please try again.',503);}}
export async function POST(request:Request){try{
  if(request.headers.get('sec-fetch-site')==='cross-site')return error('Cross-site writes are not allowed',403);
  const user=await getChatGPTUser();if(!user)return error('Sign in to save changes to your workspace.',401);const owner=user.userId;
  if(Number(request.headers.get('content-length')||0)>150000)return error('Request too large',413);
  const raw=await request.text();if(raw.length>150000)return error('Request too large',413);let b:any;try{b=JSON.parse(raw);}catch{return error('Invalid JSON',400);}if(!b||typeof b!=='object'||Array.isArray(b))return error('Invalid request');const action=clean(b.action,60);
  if(action==='freehire-search'){const profile={...defaultProfile,...await read<Profile>(owner,'profile')};return json(freehireConfigured()?await searchFreehire(profile,clean(b.query,200),b.offset??0):await enqueueFreehire(owner,profile,clean(b.query,200),b.offset??0));}
  if(action==='freehire-save'){const slug=clean(b.slug,250);if(!/^[-a-zA-Z0-9_]{1,250}$/.test(slug))return error('Invalid FreeHire job identifier.');return json(freehireConfigured()?await saveFreehireJob(owner,await freehireDetail(slug)):await enqueueFreehire(owner,defaultProfile,'',0,slug));}
  if(action==='freehire-result')return json(await freehireResult(owner,clean(b.requestId,100)));
  if(action==='candidate'){
    let details;try{details=normalizeCandidate(b.details);}catch(e){return error(e instanceof Error?e.message:'Invalid application details.');}
    const previous={...defaultProfile,...await read<Profile>(owner,'profile')};const patch={applicationDetails:JSON.stringify(details),resumeMode:b.resumeMode==='ai'?'ai':'fast'};
    await database().prepare("INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=json_patch(records.data,?),updated=excluded.updated").bind(`${owner}:profile:main`,owner,'profile',JSON.stringify({...previous,...patch}),Date.now(),JSON.stringify(patch)).run();return json({ok:true,profile:await read(owner,'profile')});
  }
  if(action==='parse-profile'||action==='profile-parse-latest'){
    const profile={...defaultProfile,...await read<Profile>(owner,'profile')};if(!profile.resumeText.trim())return error('Save readable resume text in Resumes first.');
    const cached=await database().prepare("SELECT id,status,payload FROM tasks WHERE owner=? AND type='profile-parse' AND status IN ('done','queued','running') AND json_extract(payload,'$.resumeText')=? ORDER BY created DESC,id DESC LIMIT 1").bind(owner,profile.resumeText).first<any>();
    if(cached&&(cached.status!=='done'||(b.force!==true&&hasParsedValue(JSON.parse(cached.payload).result))))return json({requestId:cached.id,status:cached.status,cached:cached.status==='done'});
    if(action==='profile-parse-latest')return json({status:'none'});
    const ready=await database().prepare("SELECT d.id FROM devices d JOIN records r ON r.owner=d.owner AND r.id=d.owner||':worker-runtime:'||d.id WHERE d.owner=? AND d.last_seen>? AND json_extract(r.data,'$.seen')>? AND json_extract(r.data,'$.profileParse')=1").bind(owner,Date.now()-180000,Date.now()-180000).first();if(!ready)return error('Update and restart your VPS worker for resume-to-profile parsing.',503);
    const active=await database().prepare("SELECT id FROM tasks WHERE owner=? AND application_id='profile-parse' AND status IN ('queued','running')").bind(owner).first<any>();if(active)return error('A previous resume is still being parsed. Wait for it to finish before parsing the replacement.',409);
    const id=crypto.randomUUID(),at=Date.now();await database().prepare("INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,'profile-parse','profile-parse','queued',?,?,?)").bind(id,owner,JSON.stringify({resumeText:profile.resumeText}),at,at).run();return json({requestId:id});
  }
  if(action==='profile-parse-result'){
    const task=await database().prepare("SELECT status,payload FROM tasks WHERE owner=? AND id=? AND type='profile-parse'").bind(owner,clean(b.requestId,100)).first<any>();if(!task)return error('Profile parsing request not found.',404);const payload=JSON.parse(task.payload);const current=await read<Profile>(owner,'profile');if(payload.resumeText!==current?.resumeText)return error('Your resume changed. Parse the current resume to fill these details.',409);if(task.status==='done')return json({status:'done',proposal:payload.result});if(['failed','cancelled'].includes(task.status))return error(payload.result?.error||'Profile parsing was interrupted.',502);return json({status:task.status});
  }
  if(action==='suggest-roles'){
    const ready=await database().prepare("SELECT d.id FROM devices d JOIN records r ON r.owner=d.owner AND r.id=d.owner||':worker-runtime:'||d.id WHERE d.owner=? AND d.last_seen>? AND json_extract(r.data,'$.seen')>? AND json_extract(r.data,'$.roleSuggestions')=1").bind(owner,Date.now()-180000,Date.now()-180000).first();
    if(!ready)return error('Update and restart your VPS worker to enable Ollama title suggestions. If already updated, wait 30 seconds for its heartbeat.',503);
    const profile={...defaultProfile,...await read<Profile>(owner,'profile')};
    const payload={roles:clean(b.roles,1000),skills:clean(profile.skills,4000),experience:clean(profile.experience,6000),resumeText:clean(profile.resumeText,20000)};
    if(!Object.values(payload).some(Boolean))return error('Enter a target role and press Add, or upload your resume in Resumes first.');
    const active=await database().prepare("SELECT id,status FROM tasks WHERE owner=? AND application_id='role-suggestions' AND status IN ('queued','running')").bind(owner).first<any>();if(active)return json({requestId:active.id,status:active.status});
    const id=crypto.randomUUID(),at=Date.now();await database().prepare("INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) VALUES(?,?,'role-suggestions','role-suggest','queued',?,?,?)").bind(id,owner,JSON.stringify(payload),at,at).run();return json({requestId:id,status:'queued'});
  }
  if(action==='role-suggestions-result'){
    const task=await database().prepare("SELECT id,status,payload,created FROM tasks WHERE id=? AND owner=? AND type='role-suggest'").bind(clean(b.requestId,100),owner).first<any>();if(!task)return error('Title suggestion request not found.',404);
    const payload=JSON.parse(task.payload);if(task.status==='done')return json({roles:payload.result.roles,status:'done'});
    if(task.status==='failed'||task.status==='cancelled')return error(payload.result?.error||'Title suggestions were interrupted. Try again.',502);
    return json({status:task.status,requestId:task.id});
  }
  if(action==='preferences'){
    if(!b.preferences||typeof b.preferences!=='object'||Array.isArray(b.preferences))return error('Invalid preferences.');
    const previous={...defaultProfile,...await read<Profile>(owner,'profile')},patch:Record<string,string|number>={};
    for(const key of preferenceKeys){if(!(key in (b.preferences||{})))continue;
      if(key==='minFit'){patch.minFit=0;continue;}
      if(key==='dailyLimit'){const value=Number(b.preferences[key]);if(!Number.isFinite(value)||value<(key==='dailyLimit'?0:1)||value>(key==='dailyLimit'?50:100))return error('Enter a valid '+(key==='dailyLimit'?'daily application limit':'minimum fit')+'.');patch[key]=Math.floor(value);}
      else patch[key]=clean(b.preferences[key],8000);
    }
    if(!Object.keys(patch).length)return error('Choose preferences to save.');
    try{freehireParameters({...previous,...patch,roles:''});}catch(e){return error(e instanceof Error?e.message:'Invalid preferences');}
    await database().prepare("INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=json_patch(records.data,?),updated=excluded.updated").bind(`${owner}:profile:main`,owner,'profile',JSON.stringify({...previous,...patch}),Date.now(),JSON.stringify(patch)).run();
    return json({ok:true,preferences:patch});
  }
  if(action==='resume-text'){
    const text=clean(b.resumeText,60001);if(text.length<40||text.length>60000)return error('Resume text must contain 40–60,000 characters.');
    const file=await read(owner,'file',clean(b.fileId,100));if(!file||file.generated)return error('Choose an uploaded base resume from this workspace.');
    const previous={...defaultProfile,...await read<Profile>(owner,'profile')};
    await database().prepare("INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=json_set(records.data,'$.resumeText',?,'$.resumeFile',?),updated=excluded.updated").bind(`${owner}:profile:main`,owner,'profile',JSON.stringify({...previous,resumeText:text,resumeFile:file.id}),Date.now(),text,file.id).run();
    return json({ok:true,profile:await read(owner,'profile')});
  }
  if(action==='fast-apply'){
    if(b.authorized!==true)return error('Fast Apply must authorize submission for this job.');
    const job=await read<Job>(owner,'job',clean(b.id,300));if(!job||job.sample)return error('Import a real job first.');
    const submissionJob=applicationJob(job);if(!submissionJob)return error('This employer form needs manual application. Automatic submission currently supports Greenhouse, including imported custom employer links.');
    const profile={...defaultProfile,...await read<Profile>(owner,'profile')};const missing=applicationRequirements(profile);if(missing.length)return error('Missing saved details: '+missing.join(', ')+'. Upload your resume once in Resumes.');
    if(!job.description.trim())return error('This job has no description to tailor against.');
    let app=await read<Application>(owner,'application',job.id);
    if(app&&['Applied','Application received','Assessment','Response received','Interview','Rejected'].includes(app.status))return json({ok:true,application:app,existing:true,completed:true});
    const active=await database().prepare("SELECT id FROM tasks WHERE owner=? AND application_id=? AND status IN ('queued','running')").bind(owner,job.id).first();if(active)return json({ok:true,application:app,existing:true});
    // A previous attempt may have reached the employer. Require explicit reconciliation rather than replaying it.
    if(app?.status==='Needs attention'){
      if(b.retryReviewed!==true)return error('Open this application and resolve its previous issue before trying again.',409);
      const previous=await database().prepare("SELECT type FROM tasks WHERE owner=? AND application_id=? ORDER BY created DESC,id DESC LIMIT 1").bind(owner,app.id).first<{type:string}>();
      if(previous?.type!=='tailor'&&!/no submission attempted/i.test(app.events.at(-1)?.label||''))return error('The previous submission may be uncertain. Check the employer or inbox and reconcile its state before retrying.',409);
    }
    const at=now(),id=crypto.randomUUID(),created=Date.now();
    app=app||{id:job.id,job,status:'Saved',created:at,updated:at,followUp:'',notes:'',events:[]};
    const previousStatus=app.status;app.status='Preparing';app.updated=at;app.events.push({label:'Fast Apply authorized: tailor saved resume, then submit this job automatically when supported.',at});
    const payload=JSON.stringify({job:submissionJob,profile,previousStatus,fastApply:true,authorizedAt:at});
    // Reserve the daily slot at enqueue time, including offline queues. Chained apply tasks share that reservation.
    const results=await database().batch([
      database().prepare("INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) SELECT ?,?,?,'tailor','queued',?,?,? WHERE (?=0 OR (SELECT count(*) FROM tasks WHERE owner=? AND created>? AND (type='apply' AND COALESCE(json_extract(payload,'$.fastApply'),0)!=1 OR type='tailor' AND json_extract(payload,'$.fastApply')=1) AND status!='cancelled')<?)").bind(id,owner,job.id,payload,created,created,profile.dailyLimit,owner,created-86400000,profile.dailyLimit),
      database().prepare("INSERT INTO records(id,owner,kind,data,updated) SELECT ?,?,'application',?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated").bind(`${owner}:application:${job.id}`,owner,JSON.stringify(app),created,id)
    ]);if(!results[0]!.meta.changes)return error('Daily application limit reached.');return json({ok:true,application:app});
  }
  if(action==='profile'){
    const profile={...defaultProfile};for(const key of Object.keys(defaultProfile) as (keyof Profile)[]){if(typeof defaultProfile[key]==='number')(profile as any)[key]=Math.max(key==='dailyLimit'?0:1,Math.min(key==='dailyLimit'?50:100,Number.isFinite(Number(b.profile?.[key]))?Number(b.profile?.[key]):defaultProfile[key]));else (profile as any)[key]=clean(b.profile?.[key],key==='resumeText'||key==='applicationDetails'?60000:8000);}
    profile.minFit=0;
    if(profile.applicationDetails)try{profile.applicationDetails=JSON.stringify(normalizeCandidate(profile.applicationDetails));}catch(e){return error(e instanceof Error?e.message:'Invalid application details.');}if(!['fast','ai'].includes(profile.resumeMode))profile.resumeMode='fast';
    if(profile.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))return error('Enter a valid application email.');try{freehireParameters({...profile,roles:''});}catch(e){return error(e instanceof Error?e.message:"Invalid search preferences");}profile.dailyLimit=Math.floor(profile.dailyLimit);await write(owner,'profile','main',profile);return json({ok:true,profile});
  }
  if(action==='job-detail'){const job=await read<Job>(owner,'job',clean(b.id,300));return job?json({job}):error('Job not found',404);}
  if(action==='save-job'){
    const raw=b.job||{};const job=samples.find(j=>j.id===raw.id)||await read<Job>(owner,'job',clean(raw.id,300));
    if(!job)return error('Import or add this job first.');
    const saved=b.saved!==false;
    await write(owner,'bookmark',job.id,{id:job.id,saved});
    let app=await read<Application>(owner,'application',job.id);const existing=!!app;
    if(saved&&!app){const at=now();app={id:job.id,job,status:'Saved',created:at,updated:at,followUp:'',notes:'',events:[{label:'Job bookmarked',at}]};await write(owner,'application',job.id,app);}
    if(!saved&&app?.status==='Saved')await database().prepare("DELETE FROM records WHERE owner=? AND kind='application' AND id=? AND NOT EXISTS (SELECT 1 FROM tasks WHERE owner=? AND application_id=? AND status IN ('queued','running'))").bind(owner,`${owner}:application:${job.id}`,owner,job.id).run();
    return json({ok:true,saved,application:app,existing});
  }
  if(action==='add-job'){
    const r=b.job||{};if(!clean(r.title)||!clean(r.company)||!safeURL(r.url))return error('Add a title, company, and HTTPS job URL.');const id='manual-'+(await hash(safeURL(r.url))).slice(0,24);const job:Job={id,title:clean(r.title,200),company:clean(r.company,200),location:clean(r.location,200),description:clean(r.description,45000),url:safeURL(r.url),style:clean(r.style,50)||'Remote',type:clean(r.type,50)||'Full-time',salary:clean(r.salary,100),skills:[],source:'Manual',posted:now()};await write(owner,'job',id,job);return json({ok:true});
  }
  if(action==='import'||action==='discover'){
    const discovery=action==='discover',preset=discoveryBoards.find(x=>x.board===b.board);if(discovery&&!preset)return error('Unknown discovery source.');
    if(discovery)b.provider='Greenhouse';
    const previousSources=await read<any[]>(owner,'sources')||[];
    const recent=previousSources.find(x=>x.board===b.board&&x.provider===b.provider);
    if(discovery&&recent?.discovery&&recent?.unlimited&&Date.now()-Date.parse(recent.lastSync)<300000)return json({ok:true,count:recent.count,cached:true});
    const provider=clean(b.provider,30),board=clean(b.board,100);if(!['Greenhouse','Lever'].includes(provider)||!/^[-\w]+$/.test(board))return error('Use a Greenhouse or Lever board name, such as the name in its careers URL.');
    const url=provider==='Greenhouse'?`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`:`https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;
    const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'manual'});if(!response.ok)return error('The job board could not be loaded. Check its name and try again.');const data:any=await response.json();const rows=provider==='Greenhouse'?data.jobs:data;if(!Array.isArray(rows))return error('This board returned an unsupported response.');let jobs:Job[]=rows.map((j:any)=>({id:`${provider.toLowerCase()}-${board}-${j.id}`,title:clean(j.title||j.text,250),company:preset?.company||board,location:clean(j.location?.name||j.categories?.location,250),style:/remote/i.test(j.location?.name||j.categories?.location||j.workplaceType||'')?'Remote':/hybrid/i.test(j.location?.name||j.categories?.location||j.workplaceType||'')?'Hybrid':'On-site',type:/intern/i.test(j.title||j.text)?'Internship':j.categories?.commitment||'Full-time',salary:'',description:plain([j.content||j.descriptionPlain||j.description||'',...(Array.isArray(j.lists)?j.lists.map((l:any)=>[l.text,l.content].filter(Boolean).join(' ')):[]),j.additionalPlain||j.additional||''].join(' ')).slice(0,45000),url:safeURL(j.absolute_url||j.hostedUrl),skills:[],source:provider,posted:j.updated_at||j.createdAt&&new Date(j.createdAt).toISOString()||now()})).filter((j:Job)=>j.url&&j.title);
    if(discovery){const profile={...defaultProfile,...await read<Profile>(owner,'profile')};jobs.sort((a,b)=>recommendation(b,profile)-recommendation(a,profile)||Date.parse(b.posted)-Date.parse(a.posted));}
    const timestamp=Date.now(),syncRun=crypto.randomUUID();
    // Write every valid upstream row in bounded batches. Delete stale rows only after all batches succeed.
    for(let i=0;i<jobs.length;i+=40)await database().batch(jobs.slice(i,i+40).map(j=>database().prepare('INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind(`${owner}:job:${j.id}`,owner,'job',JSON.stringify(discovery?{...j,discoveryBoard:board,syncRun}:j),timestamp)));
    if(discovery)await database().prepare("DELETE FROM records WHERE owner=? AND kind='job' AND json_extract(data,'$.discoveryBoard')=? AND COALESCE(json_extract(data,'$.syncRun'),'')!=?").bind(owner,board,syncRun).run();
    const sources=await read<any[]>(owner,'sources')||[];const source={provider,board,count:jobs.length,available:rows.length,discovery,unlimited:true,lastSync:now()};await write(owner,'sources','main',[...sources.filter(s=>s.board!==board||s.provider!==provider),source]);return json({ok:true,count:jobs.length});
  }
  if(action==='application'){
    const app=await read<Application>(owner,'application',clean(b.id,300));if(!app)return error('Application not found',404);const changes=b.changes||{};
    const active=await database().prepare("SELECT id FROM tasks WHERE owner=? AND application_id=? AND status IN ('queued','running')").bind(owner,app.id).first();if(active&&('status' in changes||'resumeText' in changes))return error('Cancel or finish the active task before changing the resume or status.',409);if(changes.status){if(!statuses.includes(changes.status))return error('Invalid status');if(changes.status==='Applied'&&app.status!=='Applied')app.events.push({label:'Marked applied manually — employer receipt not verified',at:now()});else if(app.status!==changes.status)app.events.push({label:`Status changed to ${changes.status}`,at:now()});app.status=changes.status;}
    if('message'in changes)app.message=clean(changes.message,10000);if('notes'in changes)app.notes=clean(changes.notes,10000);if('followUp'in changes){const d=clean(changes.followUp,10);if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T12:00:00Z'))||new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d))return error('Invalid date');app.followUp=d;}
    if('resumeText'in changes){const text=clean(changes.resumeText,60000);if(!text)return error('The tailored resume cannot be empty.');if(text!==app.resumeText)delete app.resumeFile;app.resumeText=text;}app.updated=now();await write(owner,'application',app.id,app);return json({ok:true});
  }
  if(action==='queue'){
    const app=await read<Application>(owner,'application',clean(b.id,300));if(!app||app.job.sample)return error('Import a real job before preparing an application.');const profile=await read<Profile>(owner,'profile');if(!profile?.resumeText)return error('Add your resume text to Profile first.');if(!profile.name||!profile.email)return error('Complete your name and application email in Profile first.');
    if(!['apply','followup','tailor','pdf'].includes(b.type))return error('Unsupported task type.');const type=b.type;if(type==='apply'&&(!app.resumeText||b.approved!==true))return error('Review the tailored resume and explicitly approve this application first.');if(type==='apply'&&['Applied','Application received','Assessment','Response received','Interview','Rejected'].includes(app.status))return error('This application is already completed.');
    if(type==='apply'&&b.reviewedResumeText!==app.resumeText)return error('Save your resume edits, review the saved version, then approve it.',409);
    const submissionJob=applicationJob(app.job);if(type==='apply'&&!submissionJob)return error('Automatic submission supports Greenhouse forms only. Use the original posting for this job.');
    if(type==='pdf'&&!app.resumeText)return error('Save a tailored resume first.');
    if(type==='tailor'&&!app.job.description.trim())return error('Add the job description before tailoring your resume.');
    const active=await database().prepare("SELECT id FROM tasks WHERE owner=? AND application_id=? AND status IN ('queued','running')").bind(owner,app.id).first();if(active)return error('This application already has a task in progress.');
    const cutoff=Date.now()-86400000;const count=await database().prepare("SELECT count(*) AS n FROM tasks WHERE owner=? AND created>? AND (type='apply' AND COALESCE(json_extract(payload,'$.fastApply'),0)!=1 OR type='tailor' AND json_extract(payload,'$.fastApply')=1) AND status!='cancelled'").bind(owner,cutoff).first<{n:number}>();if(type==='apply'&&profile.dailyLimit>0&&(count?.n||0)>=profile.dailyLimit)return error('Daily application limit reached.');
    const at=now(),id=crypto.randomUUID(),previousStatus=app.status;const payload=JSON.stringify({job:type==='apply'?submissionJob:app.job,profile,resumeText:app.resumeText,previousStatus});if(type==='tailor'||type==='apply')app.status=type==='tailor'?'Preparing':'Awaiting submission';app.events.push({label:`${type==='tailor'?'Resume tailoring':type==='apply'?'Approved application':type==='pdf'?'PDF regeneration':'Follow-up drafting'} queued for local worker`,at});app.updated=at;const outcomes=await database().batch([database().prepare("INSERT INTO tasks(id,owner,application_id,type,status,payload,updated,created) SELECT ?,?,?,?,?,?,?,? WHERE ?!='apply' OR ?=0 OR (SELECT count(*) FROM tasks WHERE owner=? AND created>? AND (type='apply' AND COALESCE(json_extract(payload,'$.fastApply'),0)!=1 OR type='tailor' AND json_extract(payload,'$.fastApply')=1) AND status!='cancelled')<?").bind(id,owner,app.id,type,'queued',payload,Date.now(),Date.now(),type,profile.dailyLimit,owner,cutoff,profile.dailyLimit),database().prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM tasks WHERE id=?)').bind(JSON.stringify(app),Date.now(),`${owner}:application:${app.id}`,owner,id)]);if(!outcomes[0]!.meta.changes)return error('Daily application limit reached.');return json({ok:true});
  }
  if(action==='pair'){
    const id=crypto.randomUUID(),token='cp_'+crypto.randomUUID()+crypto.randomUUID();await database().prepare('INSERT INTO devices(id,owner,hash,name,last_seen,created) VALUES(?,?,?,?,?,?)').bind(id,owner,await hash(token),clean(b.name,80)||'My computer',0,Date.now()).run();return json({token,id,serviceAccess:env.CP_SERVICE_ACCESS_TOKEN||''});
  }
  if(action==='revoke'){
    const id=clean(b.id,100);await database().prepare('DELETE FROM devices WHERE id=? AND owner=?').bind(id,owner).run();return json({ok:true});
  }
  if(action==='cancel-task'){
    const app=await read<Application>(owner,'application',clean(b.id,300));if(!app)return error('Application not found',404);const running=await database().prepare("SELECT id FROM tasks WHERE owner=? AND application_id=? AND status='running'").bind(owner,app.id).first();if(running)return error('The worker is running this task. Stop it on your computer before changing its state.');const queued=await database().prepare("SELECT payload FROM tasks WHERE owner=? AND application_id=? AND status='queued'").bind(owner,app.id).first<{payload:string}>();if(!queued)return error('No queued task to cancel.');await database().prepare("UPDATE tasks SET status='cancelled',updated=? WHERE owner=? AND application_id=? AND status='queued'").bind(Date.now(),owner,app.id).run();app.status=JSON.parse(queued.payload).previousStatus||'Saved';app.updated=now();app.events.push({label:'Queued task cancelled',at:now()});await write(owner,'application',app.id,app);return json({ok:true});
  }
  if(action==='resolve-task'){
    const app=await read<Application>(owner,'application',clean(b.id,300));if(!app)return error('Application not found',404);if(b.reconciled!==true)return error('Confirm that you checked the employer state and stopped the worker first.');
    const running=await database().prepare("SELECT t.id,d.last_seen FROM tasks t LEFT JOIN devices d ON t.device_id=d.id AND t.owner=d.owner WHERE t.owner=? AND t.application_id=? AND t.status='running'").bind(owner,app.id).first<any>();
    if(!running)return error('There is no interrupted task to resolve.');if(running.last_seen&&Date.now()-running.last_seen<15*60*1000)return error('The worker was recently online. Stop it and wait 15 minutes, or revoke its connection before resolving this task.');
    await database().prepare("UPDATE tasks SET status='cancelled',updated=? WHERE id=? AND owner=? AND status='running'").bind(Date.now(),running.id,owner).run();app.status='Needs attention';app.updated=now();app.events.push({label:'Interrupted task reconciled manually. No automatic retry was performed.',at:now()});await write(owner,'application',app.id,app);return json({ok:true});
  }
  return error('Unknown action');
}catch(e){if(e instanceof FreeHireError)return error(e.message,e.status);if(e instanceof Error&&e.message.includes('UNIQUE constraint failed: tasks'))return error('This application already has a task in progress.',409);console.error('Workspace action failed',e instanceof Error?e.message:'unknown');return error('That action could not be completed. Please try again.',500);}}
