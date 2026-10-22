import type {Profile} from './types';
export function readLocal(key:string){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
export function writeLocal(key:string,value:unknown){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));}catch{}}
export function restoreDraft(fresh:Profile,saved:any):Profile{
 const result={...fresh};if(!saved?.base||!saved?.draft)return result;
 for(const key of Object.keys(fresh) as (keyof Profile)[]){const value=saved.draft[key];if(typeof value===typeof fresh[key]&&value!==saved.base[key]&&fresh[key]===saved.base[key])(result as any)[key]=value;}
 return result;
}
export async function jobCache(owner:string,kind:string,value?:unknown):Promise<any>{
 if(!owner||typeof indexedDB==='undefined')return null;
 return new Promise(resolve=>{
  let settled=false;const finish=(v:any)=>{if(!settled){settled=true;resolve(v);}};
  const timeout=setTimeout(()=>finish(null),1500);
  const open=indexedDB.open('careerpilot-cache',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('jobs');
  open.onerror=()=>{clearTimeout(timeout);finish(null);};
  open.onsuccess=()=>{const db=open.result;try{const tx=db.transaction('jobs',value===undefined?'readonly':'readwrite'),store=tx.objectStore('jobs'),key=owner+':'+kind;const request=value===undefined?store.get(key):store.put(value,key);request.onsuccess=()=>finish(request.result??null);request.onerror=()=>finish(null);tx.oncomplete=()=>{clearTimeout(timeout);db.close();};tx.onerror=()=>{clearTimeout(timeout);db.close();finish(null);};}catch{db.close();clearTimeout(timeout);finish(null);}};
 });
}
