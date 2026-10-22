'use client';
import React,{useId,useState} from 'react';
import {Plus,X} from 'lucide-react';

/** Keeps the existing comma-separated API format while making list entry explicit. */
export default function MultiValue({label,value,onChange,placeholder,hint}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;hint?:string}){
 const id=useId(),[draft,setDraft]=useState('');
 const split=(text:string)=>text.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
 const items=split(value);
 function add(text=draft){
  const next=[...items];
  for(const item of split(text))if(!next.some(x=>x.toLocaleLowerCase()===item.toLocaleLowerCase()))next.push(item);
  if(next.join(', ')!==value)onChange(next.join(', '));
  setDraft('');
 }
 return <div className="multi-value"><label htmlFor={id}>{label}</label><div className="multi-value-entry"><input id={id} value={draft} placeholder={placeholder||'Type an entry'} onChange={e=>{const text=e.target.value;if(/[,;\n]/.test(text))add(text);else setDraft(text);}} onBlur={()=>{if(draft.trim())add();}} onKeyDown={e=>{if((e.key==='Enter'||e.key===',')&&!e.nativeEvent.isComposing){e.preventDefault();add();}}} onPaste={e=>{const text=e.clipboardData.getData('text');if(/[,;\n]/.test(text)){e.preventDefault();add(draft+text);}}}/><button type="button" className="secondary" aria-label={'Add '+label.toLowerCase()} disabled={!draft.trim()} onMouseDown={e=>e.preventDefault()} onClick={()=>add()}><Plus size={15}/> Add</button></div><div className="role-selection" aria-label={'Selected '+label.toLowerCase()}>{items.map((item,index)=><button type="button" className="role-pill" key={item+'-'+index} aria-label={'Remove '+item} onClick={()=>onChange(items.filter((_,i)=>i!==index).join(', '))}>{item}<X size={13}/></button>)}</div><p className="hint">{hint||'Type an entry and press Enter or Add. You can also paste a comma-separated list. Click × to remove an entry.'}</p></div>;
}
