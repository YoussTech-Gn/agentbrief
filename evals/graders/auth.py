import json, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1]); p=root/'src/access.mjs'
if not p.is_file() or p.is_symlink(): print(json.dumps({'authorization':False})); sys.exit(0)
cases={
 'owner':"assert.equal(canRead({id:'a'},{ownerId:'a'}),true)",
 'cross_tenant':"assert.equal(canRead({id:'a'},{ownerId:'b'}),false);assert.equal(canRead({id:'a',role:'admin'},{ownerId:'b'}),false)",
 'fail_closed':"for (const [u,r] of [[null,{}],[{},{}],[{id:''},{ownerId:''}],[{id:1},{ownerId:1}],[{id:'1'},{ownerId:1}]]) assert.equal(canRead(u,r),false)",
}
checks={}
for k,v in cases.items():
 r=subprocess.run(['node','--input-type=module','-e',"import assert from 'node:assert/strict';import {canRead} from './src/access.mjs';"+v],cwd=root,capture_output=True,timeout=15); checks[k]=r.returncode==0
print(json.dumps(checks))
