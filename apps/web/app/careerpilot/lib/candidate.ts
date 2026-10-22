import type {Profile} from './types';
export type CandidateDetails={firstName:string;lastName:string;addressLine1:string;addressLine2:string;seniority:string;certifications:string;languages:string;preferredFirstName:string;github:string;city:string;state:string;country:string;postalCode:string;currentTitle:string;currentCompany:string;experienceYears:string;currentSalary:string;expectedSalary:string;currency:string;salaryPeriod:string;noticeDays:string;startDate:string;workAuthorization:{country:string;authorized:string;sponsorship:string}[];education:{school:string;degree:string;field:string;start:string;end:string;gpa:string}[];employment:{title:string;company:string;location:string;start:string;end:string;description:string}[];answers:{question:string;answer:string}[];gender:string;ethnicity:string;veteran:string;disability:string};
export const emptyCandidate:CandidateDetails={firstName:'',lastName:'',addressLine1:'',addressLine2:'',seniority:'',certifications:'',languages:'',preferredFirstName:'',github:'',city:'',state:'',country:'',postalCode:'',currentTitle:'',currentCompany:'',experienceYears:'',currentSalary:'',expectedSalary:'',currency:'',salaryPeriod:'',noticeDays:'',startDate:'',workAuthorization:[],education:[],employment:[],answers:[],gender:'',ethnicity:'',veteran:'',disability:''};
export function normalizeCandidate(raw:unknown,validate=true):CandidateDetails{
 let value:any=raw;if(typeof raw==='string'){try{value=JSON.parse(raw||'{}');}catch{throw Error('Application details must contain valid saved data.');}}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid application details.');
 const text=(v:unknown,max=1000)=>typeof v==='string'?(validate?v.trim():v).slice(0,max):typeof v==='number'&&Number.isFinite(v)?String(v):'';
 const result={...emptyCandidate};for(const key of Object.keys(emptyCandidate) as (keyof CandidateDetails)[])if(typeof emptyCandidate[key]==='string')(result as any)[key]=text(value[key]);
 for(const key of ['workAuthorization','education','employment','answers'] as const){
  const fields=key==='workAuthorization'?['country','authorized','sponsorship']:key==='education'?['school','degree','field','start','end','gpa']:key==='employment'?['title','company','location','start','end','description']:['question','answer'];
  (result as any)[key]=(Array.isArray(value[key])?value[key]:[]).slice(0,30).filter((v:any)=>v&&typeof v==='object').map((v:any)=>Object.fromEntries(fields.map(field=>[field,text(v[field],field==='description'?6000:field==='answer'?3000:1000)])));
 }
 for(const row of result.workAuthorization){row.country=row.country.toUpperCase();if(validate&&row.country&&!/^[A-Z]{2}$/.test(row.country))throw Error('Use two-letter work-authorization country codes.');for(const key of ['authorized','sponsorship'] as const)if(!['','yes','no'].includes(row[key]))throw Error('Choose Yes, No, or Not provided for work authorization.');}
 if(validate&&result.startDate&&!/^\d{4}-\d{2}-\d{2}$/.test(result.startDate))throw Error('Use a valid earliest start date.');
 return result;
}
export function candidateFromProfile(profile:{applicationDetails?:string}){try{return normalizeCandidate(profile.applicationDetails||'{}',false);}catch{return {...emptyCandidate};}}
export function mailClassification(subject:string,body:string){
 const text=(subject+'\n'+body).toLowerCase();
 if(/(will not|won't|not be|unable to|decided not to|not to) (?:be )?(?:moving|move|proceed|progress)|decided to (?:move forward|proceed) with other candidates|pursue other candidates|not selected|unsuccessful application/.test(text))return 'rejected';
 if(/invite you (?:to|for) (?:an? )?interview|schedule (?:an? |your )?interview|interview (?:invitation|confirmation)|invitation to (?:an? )?interview/.test(text))return 'interview';
 if(/assessment invitation|invited.*(?:assessment|coding test)|complete (?:your|the|an?) (?:online |technical )?assessment|take.home (?:test|assignment)/.test(text))return 'assessment';
 if(/(?:have |has |successfully )?received your application|application (?:has been |was )?(?:successfully )?(?:received|submitted)|thank you for (?:your application|applying)|thanks for applying/.test(text))return 'receipt';
 return 'unknown';
}

export function hasParsedValue(value:unknown):boolean{
 if(Array.isArray(value))return value.some(hasParsedValue);
 if(value&&typeof value==='object')return Object.values(value).some(hasParsedValue);
 return typeof value==='string'?!!value.trim():typeof value==='number'&&Number.isFinite(value);
}
export function mergeParsedProfile(current:Profile,proposal:{details:unknown;contact:Record<string,string>}):Profile{
 const existing=candidateFromProfile(current),incoming=normalizeCandidate(proposal.details);
 for(const key of Object.keys(incoming) as (keyof CandidateDetails)[])if(!hasParsedValue(existing[key]))(existing as any)[key]=incoming[key];
 const merged={...current,applicationDetails:JSON.stringify(existing)};
 for(const key of ['name','email','phone','linkedin','portfolio','skills'] as const)if(!merged[key]?.trim()&&proposal.contact?.[key])merged[key]=proposal.contact[key];
 return merged;
}
