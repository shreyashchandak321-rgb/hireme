#!/usr/bin/env python3
"""Verify the local catalogue and connect the existing paired worker."""
import json, os, pathlib, shutil, tempfile, urllib.request
config=pathlib.Path('/opt/careerpilot/careerpilot.json')
url='http://127.0.0.1:8086'
with urllib.request.urlopen(url+'/api/v1/jobs/search?limit=1',timeout=30) as response:
    result=json.load(response)
if not isinstance(result.get('data'),list) or not isinstance(result.get('meta',{}).get('total'),int):
    raise SystemExit('FreeHire returned an unexpected response. Configuration unchanged.')
if result['meta']['total']==0:
    raise SystemExit('FreeHire is running but has no indexed jobs. Run seed-and-index.sh first. Configuration unchanged.')
info=config.stat();data=json.loads(config.read_text())
if not data.get('site_url') or not data.get('worker_key'):
    raise SystemExit('Existing worker configuration is not paired. Configuration unchanged.')
backup=config.with_name('careerpilot.before-freehire.json')
if not backup.exists():
    shutil.copy2(config,backup);os.chmod(backup,0o600);os.chown(backup,info.st_uid,info.st_gid)
data['freehire_url']=url
fd,path=tempfile.mkstemp(prefix='careerpilot-config-',dir=config.parent)
try:
    with os.fdopen(fd,'w') as output:json.dump(data,output,indent=2);output.write('\n')
    os.chmod(path,0o600);os.chown(path,info.st_uid,info.st_gid);os.replace(path,config)
finally:
    if os.path.exists(path):os.unlink(path)
print('FreeHire verified:',result['meta']['total'],'indexed jobs. Existing worker configured. Restart careerpilot-worker to connect.')
