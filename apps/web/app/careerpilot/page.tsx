import {redirect} from 'next/navigation';
import {getChatGPTUser} from './auth';
import Workspace from './workspace';
import './workspace.css';
export default async function CareerPilotPage(){
 if(!await getChatGPTUser())redirect('/auth/sign-in?next=/careerpilot');
 return <div className="careerpilot-root"><Workspace/></div>;
}
