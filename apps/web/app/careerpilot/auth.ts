import 'server-only';
import {getSupabaseServerClient} from '@kit/supabase/server-client';
export async function getChatGPTUser(){
 const {data,error}=await getSupabaseServerClient().auth.getUser();
 if(error||!data.user)return null;
 const user=data.user;
 return {userId:user.id,email:user.email||'',displayName:user.user_metadata?.name||user.email||'Member',fullName:user.user_metadata?.name||null};
}
