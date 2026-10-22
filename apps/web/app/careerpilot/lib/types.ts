export type Job={id:string;title:string;company:string;location:string;style:string;type:string;salary:string;description:string;url:string;source:string;skills:string[];posted:string;sample?:boolean;freehireSlug?:string;};
export type Profile={applicationDetails:string;resumeMode:string;name:string;email:string;phone:string;linkedin:string;portfolio:string;resumeText:string;skills:string;experience:string;authorization:string;instructions:string;roles:string;location:string;workStyle:string;minFit:number;dailyLimit:number;countries:string;cities:string;workStyles:string;workTypes:string;experienceMin:string;experienceMax:string;visaOnly:string;};
export type Application={id:string;job:Job;status:string;created:string;updated:string;followUp:string;notes:string;events:{label:string;at:string}[];resumeText?:string;resumeFile?:string;appliedAt?:string;message?:string;messages?:{subject:string;at:string;id:string;from?:string;classification?:string;snippet?:string}[];};
export const defaultProfile:Profile={applicationDetails:'',resumeMode:'fast',name:'',email:'',phone:'',linkedin:'',portfolio:'',resumeText:'',skills:'',experience:'',authorization:'',instructions:'',roles:'',location:'',workStyle:'Any',minFit:0,dailyLimit:0,countries:'',cities:'',workStyles:'',workTypes:'',experienceMin:'',experienceMax:'',visaOnly:''};
export const samples:Job[]=[
{id:'sample-1',title:'AI Engineer',company:'Northstar Labs',location:'India',style:'Remote',type:'Full-time',salary:'₹12L – ₹20L',description:'Build practical AI features with Python, language models, and reliable evaluation pipelines. Collaborate with product and engineering to turn research into useful experiences.',skills:['Python','LLMs','FastAPI'],source:'Sample',url:'',posted:'2026-10-19',sample:true},
{id:'sample-2',title:'Full Stack Developer',company:'Forma Studio',location:'Bengaluru, India',style:'Hybrid',type:'Full-time',salary:'₹10L – ₹18L',description:'Help a small product team build thoughtful web applications. Develop accessible React interfaces and Node.js services with clear, maintainable code.',skills:['React','TypeScript','Node.js'],source:'Sample',url:'',posted:'2026-10-19',sample:true},
{id:'sample-3',title:'Machine Learning Intern',company:'Orbit Analytics',location:'India',style:'Remote',type:'Internship',salary:'₹25k – ₹40k / mo',description:'Explore real-world datasets, evaluate predictive models, and communicate findings. Work closely with experienced engineers and learn the full model lifecycle.',skills:['Python','Pandas','Scikit-learn'],source:'Sample',url:'',posted:'2026-10-18',sample:true},
{id:'sample-4',title:'Backend Engineer',company:'Fieldwork',location:'Pune, India',style:'On-site',type:'Full-time',salary:'₹14L – ₹24L',description:'Design resilient services, maintain PostgreSQL data models, and improve the performance of distributed systems.',skills:['Python','PostgreSQL','Docker'],source:'Sample',url:'',posted:'2026-10-18',sample:true},
{id:'sample-5',title:'Data Analyst',company:'Acorn Financial',location:'Mumbai, India',style:'Hybrid',type:'Full-time',salary:'₹8L – ₹14L',description:'Find the story in complex product data. Build dashboards, write SQL, and help teams make informed decisions.',skills:['SQL','Python','Analytics'],source:'Sample',url:'',posted:'2026-10-17',sample:true},
{id:'sample-6',title:'Product Engineering Intern',company:'Linear Grove',location:'India',style:'Remote',type:'Internship',salary:'₹30k – ₹50k / mo',description:'Ship small, useful features and develop your engineering craft alongside a collaborative team.',skills:['React','JavaScript','Git'],source:'Sample',url:'',posted:'2026-10-17',sample:true}
];
export const statuses=['Saved','Preparing','Ready to review','Awaiting submission','Applied','Application received','Assessment','Response received','Interview','Rejected','Needs attention'];
export function fit(job:Job,profile:Profile){
  const skills=[...new Set(profile.skills.toLowerCase().split(/[,\n]/).map(x=>x.trim()).filter(Boolean))];
  if(!skills.length)return null;
  const text=(job.title+' '+job.description+' '+job.skills.join(' ')).toLowerCase();
  const matched=skills.filter(skill=>{const escaped=skill.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','i').test(text);});
  return Math.round(matched.length/skills.length*100);
}

/** Keep unsaved editable fields while accepting new worker results and timeline events. */
export function mergeApplication(draft:Application,fresh:Application,previous?:Application):Application{
  const merged={...fresh};
  for(const key of ['notes','followUp','resumeText','message'] as const)if(previous&&draft[key]!==previous[key])(merged as any)[key]=draft[key];
  return merged;
}

// Public employer boards; discovery uses no AI credentials or paid search API.
export const discoveryBoards=[{board:'stripe',company:'Stripe'},{board:'rubrik',company:'Rubrik'},{board:'coinbase',company:'Coinbase'},{board:'alphasense',company:'AlphaSense'},{board:'databricks',company:'Databricks'},{board:'mongodb',company:'MongoDB'},{board:'cloudflare',company:'Cloudflare'}];
export function recommendation(job:Job,profile:Profile){
 const terms=(s:string)=>s.toLowerCase().split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
 const title=job.title.toLowerCase(),location=job.location.toLowerCase();
 const roles=terms(profile.roles),locations=terms(profile.location);
 const role=roles.some(r=>title.includes(r)||r.split(/\s+/).filter(w=>w.length>2).every(w=>title.includes(w)));
 const place=locations.some(l=>location.includes(l));
 return (role?100:0)+(place?60:0)+(profile.workStyle!=='Any'&&job.style===profile.workStyle?20:0)+(fit(job,profile)||0);
}

export function applicationRequirements(profile:Profile){return [!profile.name?.trim()?'full name':'',!profile.email?.trim()?'application email':'',!profile.resumeText?.trim()?'base resume text':''].filter(Boolean);}

/** Accept saved profile updates without erasing fields being edited locally. */
export function mergeProfile(draft:Profile,fresh:Profile,previous:Profile):Profile{
 const merged={...fresh};for(const key of Object.keys(defaultProfile) as (keyof Profile)[])if(draft[key]!==previous[key])(merged as any)[key]=draft[key];return merged;
}

export const preferenceKeys=['roles','location','workStyle','minFit','dailyLimit','countries','cities','workStyles','workTypes','experienceMin','experienceMax','visaOnly'] as const;
export function preferencesOf(profile:Profile){return Object.fromEntries(preferenceKeys.map(key=>[key,profile[key]]));}

export function applicationStage(app:Application,tasks:{application_id:string;type:string;status:string}[]=[]){
 const task=tasks.find(t=>t.application_id===app.id);
 if(task?.type==='tailor')return task.status==='running'?'Generating resume':'Queued for resume';
 if(task?.type==='apply')return task.status==='running'?'Submitting to employer':'Queued for submission';
 if(app.status==='Preparing')return 'Resume preparation incomplete';
 return app.status;
}

// Resolve only verified imported Greenhouse records or explicit hosted application URLs.
export function applicationJob(job:Job):Job|null{
 let url:URL;try{url=new URL(job.url);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(url.hostname))return job;
 const imported=job.source==='Greenhouse'?/^greenhouse-([a-zA-Z0-9_-]+)-(\d+)$/.exec(job.id):null;
 if(!imported)return null;
 const [,board,id]=imported;
 if(url.searchParams.has('gh_jid')&&url.searchParams.get('gh_jid')!==id)return null;
 return {...job,url:`https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board!)}&token=${id}`};
}
