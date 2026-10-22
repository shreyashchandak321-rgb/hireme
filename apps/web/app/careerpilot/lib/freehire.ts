import {locationPatch} from './search-locations';
import {env} from '../runtime';
import {clean,safeURL,plain} from './server';
import {Job,Profile} from './types';
const settings=()=>env as unknown as {FREEHIRE_API_URL?:string;FREEHIRE_API_TOKEN?:string};
export class FreeHireError extends Error{constructor(message:string,public status=400){super(message);}}
export function freehireConfigured(){return !!settings().FREEHIRE_API_URL;}
export const freehireCategories=['software_engineering','backend','frontend','fullstack','mobile','devops','sre','data_engineering','data_science','data_analytics','ml_ai','ai_engineering','qa','security','product','design','marketing','sales','support'];
const roleCategories:Record<string,string>={'backend engineer':'backend','backend developer':'backend','python developer':'backend','node.js developer':'backend','fullstack engineer':'fullstack','full stack developer':'fullstack','full-stack developer':'fullstack','full stack engineer':'fullstack','ai engineer':'ai_engineering','ai automation engineer':'ai_engineering','machine learning engineer':'ml_ai','software engineer':'software_engineering','react developer':'frontend','frontend developer':'frontend','data engineer':'data_engineering','data scientist':'data_science','data analyst':'data_analytics'};
export function freehireParameters(profile:Profile,query='',offset=0){
 const params=new URLSearchParams({limit:'20',offset:String(offset)}),split=(value:string)=>value.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
 if(!Number.isSafeInteger(offset)||offset<0||offset%20)throw new FreeHireError('Choose a valid search page.');
 const roles=split(profile.roles||''),categories=[...new Set(roles.map(r=>roleCategories[r.toLowerCase()]).filter(Boolean))];
 // Known role aliases use category OR. Never truncate an unknown role list silently.
 if(roles.length&&categories.length&&roles.some(r=>!roleCategories[r.toLowerCase()]))throw new FreeHireError('Use recognized role titles together, or search custom titles separately. Some selected titles have no FreeHire category mapping.');
 if(categories.length)params.set('category',categories.join(','));
 else if(roles.length){if(roles.length>5)throw new FreeHireError('FreeHire accepts up to five custom title alternatives. Use recognized role titles for a broader category search.');params.set('q',roles.map(r=>'title:"'+r.replace(/["\\]/g,' ')+'"').join(' OR '));}
 if(query.trim()){if(params.has('q'))throw new FreeHireError('Clear the keyword search when using custom target titles.');params.set('q',clean(query,200));}
 const geography=profile.countries||profile.cities?profile:locationPatch(profile.location||'');
 const countries=split(geography.countries||''),cities=split(geography.cities||'');
 if(countries.some(c=>!/^([A-Za-z]{2})$/.test(c)))throw new FreeHireError('Use two-letter country codes, such as IN.');
 // Entries in the single location picker are alternative places (OR).
 if(countries.length)params.set('countries',countries.map(c=>c.toUpperCase()).join(','));
 if(cities.length)params.set('cities',cities.join(','));
 for(const [field,value,allowed] of [['work_mode',profile.workStyles,['remote','hybrid','onsite']],['employment_type',profile.workTypes,['full_time','part_time','contract','internship','fellowship']]] as const){const values=split(value||'');if(values.some(v=>!(allowed as readonly string[]).includes(v)))throw new FreeHireError('Choose supported work styles and employment types.');if(values.length)params.set(field,values.join(','));}
 const min=profile.experienceMin||'',max=profile.experienceMax||'';
 for(const [name,value] of [['experience_years_min',min],['experience_years_max',max]] as const)if(value!==''){if(!/^\d{1,2}$/.test(value))throw new FreeHireError('Experience must be a whole number from 0 to 99, or blank.');params.set(name,value);}
 if(min!==''&&max!==''&&Number(min)>Number(max))throw new FreeHireError('Minimum experience cannot exceed maximum experience.');
 if(profile.visaOnly==='yes')params.set('visa_sponsorship','true');
 return params;
}
async function freehireRead(path:string){
 const config=settings();if(!config.FREEHIRE_API_URL)throw new FreeHireError('FreeHire is not connected yet. Start the supplied backend and set FREEHIRE_API_URL on the CareerPilot server.',503);
 let base:URL;try{base=new URL(config.FREEHIRE_API_URL);}catch{throw new FreeHireError('The server FreeHire URL is invalid.',503);}
 if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]','freehire'].includes(base.hostname))))throw new FreeHireError('FreeHire needs HTTPS, or an internal development address.',503);
 const url=base.toString().replace(/\/$/,'')+'/api/v1/'+path;
 let response:Response;try{response=await fetch(url,{headers:{Accept:'application/json',...(config.FREEHIRE_API_TOKEN?{Authorization:'Bearer '+config.FREEHIRE_API_TOKEN}:{})},signal:AbortSignal.timeout(20000),redirect:'manual'});}catch{throw new FreeHireError('FreeHire could not be reached. Check the backend connection and try again.',502);}
 if(response.status===400)throw new FreeHireError('FreeHire refused these filters or this page. Its default API search window is 10,000 results; narrow your search for deeper results.',400);
 if(!response.ok)throw new FreeHireError(response.status===429?'FreeHire is busy. Try again shortly.':'FreeHire returned an error. Check its service and search index.',502);
 const length=Number(response.headers.get('content-length')||0);if(length>2000000)throw new FreeHireError('FreeHire response is too large.',502);
 const reader=response.body?.getReader();if(!reader)throw new FreeHireError('FreeHire returned an empty response.',502);let size=0,text='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();throw new FreeHireError('FreeHire response is too large.',502);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 let data:any;try{data=JSON.parse(text);}catch{throw new FreeHireError('FreeHire returned an invalid response.',502);}return data;
}
export function mapFreehireJob(raw:any):Job{
 if(!raw||typeof raw.public_slug!=='string'||!/^[-a-zA-Z0-9_]{1,250}$/.test(raw.public_slug)||!clean(raw.title,250)||!safeURL(raw.url))throw new FreeHireError('FreeHire returned an invalid job.',502);
 const e=raw.enrichment||{},types:Record<string,string>={full_time:'Full-time',part_time:'Part-time',contract:'Contract',internship:'Internship',fellowship:'Fellowship'};
 return {id:'freehire-'+raw.public_slug,freehireSlug:raw.public_slug,title:clean(raw.title,250),company:clean(raw.company,250)||'Employer not supplied',location:clean(raw.location,250),style:({remote:'Remote',hybrid:'Hybrid',onsite:'On-site'} as Record<string,string>)[raw.work_mode]||'Not specified',type:types[raw.employment_type||e.employment_type]||'Not specified',salary:'',description:plain(clean(raw.description,60000)).slice(0,45000),url:safeURL(raw.url),source:'FreeHire · '+clean(raw.source,60),skills:Array.isArray(raw.skills)?raw.skills.filter((s:any)=>typeof s==='string').slice(0,100):[],posted:clean(raw.posted_at||raw.created_at,60)};
}
export function validateFreehireSearch(data:any,offset:number){if(!Array.isArray(data?.data)||!Number.isSafeInteger(data.meta?.total)||data.meta.total<0||data.data.length>20)throw new FreeHireError('FreeHire returned an unsupported search response.',502);if(data.meta?.ignored_params?.length)throw new FreeHireError('FreeHire did not recognize a selected filter. Update the backend before continuing.',502);return {jobs:data.data.map(mapFreehireJob),total:data.meta.total,offset,limit:20};}
export function validateFreehireDetail(result:any,slug:string){if(result?.data?.closed_at)throw new FreeHireError('This job has closed. Refresh the search.');const job=mapFreehireJob(result?.data);if(job.freehireSlug!==slug)throw new FreeHireError('FreeHire returned a different job.',502);return job;}
export async function searchFreehire(profile:Profile,query:string,offset:number){const params=freehireParameters(profile,query,offset),data=await freehireRead('jobs/search?'+params);return {...validateFreehireSearch(data,offset),filters:Object.fromEntries(params)};}
export async function freehireDetail(slug:string){if(!/^[-a-zA-Z0-9_]{1,250}$/.test(slug))throw new FreeHireError('Invalid FreeHire job identifier.');return validateFreehireDetail(await freehireRead('jobs/'+encodeURIComponent(slug)),slug);}
