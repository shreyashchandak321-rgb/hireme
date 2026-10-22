import type {Job,Profile} from './types';

const split=(value:string)=>value.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
const normalize=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases:Record<string,string[]>={bengaluru:['bangalore'],bangalore:['bengaluru'],gurugram:['gurgaon'],gurgaon:['gurugram'],mumbai:['bombay']};
const regions=new Intl.DisplayNames(['en'],{type:'region'});

/** Filter actual location metadata, never incidental city mentions in a description. */
export function matchesLocation(job:Job,profile:Profile):boolean{
 const cities=split(profile.cities||''),countries=split(profile.countries||'');
 const places=cities.length||countries.length?[...cities,...countries]:split(profile.location||'');
 if(!places.length)return true;
 const location=' '+normalize(job.location||'')+' ';
 return places.some(place=>{
   const name=normalize(place),alternatives=[name,...(aliases[name]||[])];
   if(/^[a-z]{2}$/i.test(place)){
     const full=regions.of(place.toUpperCase());if(full)alternatives.push(normalize(full));
     if(place.toUpperCase()==='US')alternatives.push('usa','united states of america');
     if(['GB','UK'].includes(place.toUpperCase()))alternatives.push('uk','united kingdom');
   }
   return alternatives.some(value=>location.includes(' '+value+' '));
 });
}
