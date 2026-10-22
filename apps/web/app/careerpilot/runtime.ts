import 'server-only';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {schema} from './schema';
// One Node server and durable volume. Owner filtering remains in every API query.
const root=()=>resolve(process.env.CAREERPILOT_DATA_DIR||'./data/careerpilot');
let db:DatabaseSync|undefined;
function connection(){
 if(!db){mkdirSync(root(),{recursive:true,mode:0o700});db=new DatabaseSync(resolve(root(),'workspace.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');db.exec(schema);}
 return db;
}
class Statement{
 constructor(private sql:string,private values:any[]=[]){ }
 bind(...values:any[]){return new Statement(this.sql,values);}
 private statement(){return connection().prepare(this.sql);}
 async first<T=any>(column?:string):Promise<T|null>{const row=this.statement().get(...this.values) as any;return row?(column?row[column]:row):null;}
 async all<T=any>():Promise<{results:T[];success:boolean;meta:{changes:number}}>{return {results:this.statement().all(...this.values) as T[],success:true,meta:{changes:0}};}
 runSync(){const result=this.statement().run(...this.values);return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
 async run(){return this.runSync();}
}
const database={prepare:(sql:string)=>new Statement(sql),async batch(statements:Statement[]){const db=connection();db.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.runSync());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
function objectPath(key:string){return resolve(root(),'files',createHash('sha256').update(key).digest('hex'));}
const bucket={
 async put(key:string,value:Uint8Array,options:{httpMetadata?:{contentType?:string}}={}){const path=objectPath(key);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,value,{mode:0o600});writeFileSync(path+'.json',JSON.stringify(options.httpMetadata||{}),{mode:0o600});},
 async get(key:string){const path=objectPath(key);if(!existsSync(path))return null;return {body:new Uint8Array(readFileSync(path)),httpMetadata:JSON.parse(readFileSync(path+'.json','utf8'))};}
};
export const env={DB:database,BUCKET:bucket,CP_SERVICE_ACCESS_TOKEN:'',get FREEHIRE_API_URL(){return process.env.FREEHIRE_API_URL;},get FREEHIRE_API_TOKEN(){return process.env.FREEHIRE_API_TOKEN;}};
