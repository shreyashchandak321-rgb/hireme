/** Normalize employer HTML (including entity-encoded ATS HTML) into inert display text. */
export function jobText(input:string){
 let text=String(input||'');
 const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
 for(let i=0;i<3;i++){
  const decoded=text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(match,key:string)=>{
   if(key[0]!=='#')return entities[key.toLowerCase()]||match;
   const value=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
   return Number.isFinite(value)&&value>0&&value<=0x10ffff&&!(value>=0xd800&&value<=0xdfff)?String.fromCodePoint(value):match;
  });
  if(decoded===text)break;text=decoded;
 }
 return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<\/?[a-z][^>]*>/gi,' ').replace(/\s+/g,' ').trim();
}
