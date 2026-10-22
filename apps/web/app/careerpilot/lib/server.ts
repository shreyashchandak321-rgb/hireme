import {jobText} from './job-text';
import { env } from '../runtime';
export function database(){if(!env.DB)throw new Error('Database is not configured');return env.DB;}
export const now=()=>new Date().toISOString();
export const rid=(owner:string,kind:string,id='main')=>`${owner}:${kind}:${id}`;
export async function read<T=any>(owner:string,kind:string,id='main'):Promise<T|null>{const row=await database().prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(rid(owner,kind,id),owner,kind).first<{data:string}>();return row?JSON.parse(row.data):null;}
export async function list<T=any>(owner:string,kind:string):Promise<T[]>{if(kind==='job'){const result:T[]=[];let offset=0;while(true){const page=await database().prepare("SELECT json_set(data,'$.description',substr(json_extract(data,'$.description'),1,1600)) AS data FROM records WHERE owner=? AND kind='job' ORDER BY updated DESC,id DESC LIMIT 100 OFFSET ?").bind(owner,offset).all<{data:string}>();result.push(...page.results.map(r=>JSON.parse(r.data)));if(page.results.length<100)return result;offset+=100;}}const rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated DESC LIMIT 1000').bind(owner,kind).all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data));}
export async function write(owner:string,kind:string,id:string,data:any){await database().prepare('INSERT INTO records(id,owner,kind,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner').bind(rid(owner,kind,id),owner,kind,JSON.stringify(data),Date.now()).run();}
export async function hash(value:string){const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(a)).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function error(message:string,status=400){return json({error:message},status);}
export function clean(value:unknown,max=10000){return typeof value==='string'?value.trim().slice(0,max):'';}
export function safeURL(v:unknown){try{const u=new URL(String(v));if(u.protocol!=='https:'||u.username||u.password)throw 0;return u.toString();}catch{return '';}}
export const plain=jobText;
