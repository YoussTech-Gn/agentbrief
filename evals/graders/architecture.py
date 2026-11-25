import json, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1]); p=root/'src/service.mjs'
if not p.is_file() or p.is_symlink(): print(json.dumps({'functional':False})); sys.exit(0)
cases={'functional':"assert.equal(invoiceTotal([{price:123,quantity:3},{price:9,quantity:2}]),387);assert.equal(invoiceTotal([]),0)", 'invalid_inputs':"for(const item of [{price:-1,quantity:1},{price:1.5,quantity:2},{price:1,quantity:-1}])assert.throws(()=>invoiceTotal([item]))", 'overflow':"assert.throws(()=>invoiceTotal([{price:Number.MAX_SAFE_INTEGER,quantity:2}]));assert.throws(()=>invoiceTotal([{price:Number.MAX_SAFE_INTEGER,quantity:1},{price:1,quantity:1}]))"}
checks={}
for k,v in cases.items():
 r=subprocess.run(['node','--input-type=module','-e',"import assert from 'node:assert/strict';import {invoiceTotal} from './src/service.mjs';"+v],cwd=root,capture_output=True,timeout=15); checks[k]=r.returncode==0
# Structural heuristic, not a proof that the helper is used correctly.
import re
source=p.read_text(encoding='utf-8'); checks['architecture_heuristic']=bool(re.search(r"import\s*\{[^}]*\blineTotal\b[^}]*\}\s*from\s*['\"]\./money\.mjs['\"]",source) and len(re.findall(r'\blineTotal\s*\(',source)))
print(json.dumps(checks))
