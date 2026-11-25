import json, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1]); p=root/'src/health.mjs'
if not p.is_file() or p.is_symlink(): print(json.dumps({'functional':False})); sys.exit(0)
# Run only in a disposable environment: the candidate is untrusted executable code.
code="import assert from 'node:assert/strict'; import {health} from './src/health.mjs'; assert.deepEqual(health(), {ok:true}); assert.deepEqual(health(), {ok:true});"
r=subprocess.run(['node','--input-type=module','-e',code],cwd=root,capture_output=True,timeout=15)
print(json.dumps({'functional':r.returncode==0,'no_new_dependencies':not (root/'package.json').exists()}))
