import 'server-only';
import {queryIds} from './query-registry';

type Scalar = string | number | boolean | null;
type Result<T = Record<string, unknown>> = {results:T[];success:boolean;meta:{changes:number}};
function config() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key) throw new Error('Set Supabase URL and server-only SUPABASE_SERVICE_ROLE_KEY');
 return {url:url.replace(/\/$/,''),key};
}
async function request(path:string,init:RequestInit={}) {
 const {url,key}=config();
 const headers=new Headers(init.headers);
 headers.set('apikey',key);
 // Legacy service_role JWT and new sb_secret keys are both supported.
 if(!key.startsWith('sb_secret_')) headers.set('Authorization',`Bearer ${key}`);
 const response=await fetch(url+path,{...init,headers,cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!response.ok) {
  // Do not log tokens, SQL parameters, resumes, or provider response bodies.
  console.error('CareerPilot storage request failed',response.status,path.split('?')[0]);
  throw new Error('Cloud storage request failed. Check Supabase configuration and migration.');
 }
 return response;
}
class Statement {
 constructor(readonly sql:string,readonly values:Scalar[]=[]){ }
 bind(...values:Scalar[]){return new Statement(this.sql,values);}
 operation(){
  const id=queryIds[this.sql];
  if(!id) throw new Error('Unregistered query. Regenerate the CareerPilot database migration.');
  if(this.values.some(v=>v===undefined||typeof v==='object'&&v!==null||typeof v==='number'&&!Number.isFinite(v))) throw new Error('Invalid database parameter');
  return {id,values:this.values};
 }
 async first<T=any>(column?:string):Promise<T|null>{const result=await this.all<any>();const row=result.results[0];return row?(column?row[column]:row):null;}
 async all<T=any>():Promise<Result<T>>{return (await database.batch([this]))[0]! as Result<T>;}
 async run(){return this.all();}
}
const database={
 prepare:(sql:string)=>new Statement(sql),
 async batch(statements:Statement[]):Promise<Result<any>[]>{
  if(!statements.length)return [];
  const response=await request('/rest/v1/rpc/careerpilot_batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operations:statements.map(s=>s.operation())})});
  return response.json();
 }
};
const bucketName='careerpilot-files';
function objectPath(key:string){
 if(!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(key))throw new Error('Invalid object key');
 return `/storage/v1/object/${bucketName}/${key}`;
}
const bucket={
 async put(key:string,value:Uint8Array,options:{httpMetadata?:{contentType?:string}}={}){
  await request(objectPath(key),{method:'POST',headers:{'Content-Type':options.httpMetadata?.contentType||'application/octet-stream','x-upsert':'false'},body:new Blob([new Uint8Array(value)])});
 },
 async get(key:string){
  const response=await request(objectPath(key));
  return {body:response.body,httpMetadata:{contentType:response.headers.get('content-type')||'application/octet-stream'}};
 }
};
export const env={DB:database,BUCKET:bucket,CP_SERVICE_ACCESS_TOKEN:'',get FREEHIRE_API_URL(){return process.env.FREEHIRE_API_URL;},get FREEHIRE_API_TOKEN(){return process.env.FREEHIRE_API_TOKEN;}};
