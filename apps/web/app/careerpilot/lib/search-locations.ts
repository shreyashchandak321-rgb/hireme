import type {Profile} from './types';
const regions=new Intl.DisplayNames(['en'],{type:'region'});
const countries=new Map<string,string>();
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
 const code=String.fromCharCode(a,b),name=regions.of(code);
 if(name&&name!==code){countries.set(code.toLowerCase(),code);countries.set(name.toLowerCase(),code);}
}
countries.set('usa','US');countries.set('uk','GB');
export function locationValue(profile:Profile){return [profile.cities,profile.countries?.split(',').filter(Boolean).map(c=>regions.of(c.trim().toUpperCase())||c).join(', ')].filter(Boolean).join(', ')||profile.location||'';}
export function locationPatch(value:string){
 const places=value.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean),codes=places.map(s=>countries.get(s.toLowerCase()));
 // One visible input; keep old storage keys for existing worker compatibility.
 return {location:value,countries:codes.filter(Boolean).join(','),cities:places.filter((_,i)=>!codes[i]).join(', ')};
}
