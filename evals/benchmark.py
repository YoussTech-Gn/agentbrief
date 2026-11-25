#!/usr/bin/env python3
"""Paired AgentBrief benchmark. Python 3.12+, standard library only."""
import argparse, hashlib, json, os, random, re, shutil, statistics, subprocess, sys, tempfile, time
from pathlib import Path
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent

def run(argv, cwd, env, timeout, prompt=None):
    start = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=cwd, env=env, input=prompt, stdin=None if prompt is not None else subprocess.DEVNULL,
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
        return dict(exit=p.returncode, seconds=round(time.monotonic()-start,3), stdout=p.stdout, stderr=p.stderr, timeout=False)
    except subprocess.TimeoutExpired as e:
        def decode(v): return v.decode('utf-8','replace') if isinstance(v,bytes) else (v or '')
        return dict(exit=None, seconds=round(time.monotonic()-start,3), stdout=decode(e.stdout), stderr=decode(e.stderr), timeout=True)

def digest_tree(root):
    h=hashlib.sha256()
    for p in sorted(root.rglob('*')):
        if p.is_symlink(): raise ValueError(f'Symlink not allowed in fixture: {p}')
        if p.is_file():
            h.update(p.relative_to(root).as_posix().encode()+b'\0'); h.update(hashlib.sha256(p.read_bytes()).digest())
    return h.hexdigest()

def snapshot(root):
    files = {}
    for path in root.rglob('*'):
        relative = path.relative_to(root)
        if '.git' in relative.parts:
            continue
        if path.is_symlink() or path.is_junction():
            files[relative.as_posix()] = 'link:' + os.readlink(path)
        elif path.is_file():
            files[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return files

def usage_for(engine, stdout):
    result=dict(input_tokens=None, cached_input_tokens=None, cache_write_input_tokens=None, output_tokens=None, total_tokens=None, reported_cost_usd=None)
    if engine=='codex':
        events=[]
        for line in stdout.splitlines():
            try:
                event=json.loads(line)
                if event.get('type')=='turn.completed' and isinstance(event.get('usage'),dict): events.append(event['usage'])
            except (ValueError, AttributeError): pass
        # One fresh exec is expected to have one completed turn; do not sum ambiguous cumulative records.
        if len(events)==1:
            u=events[0]
            for k in ['input_tokens','cached_input_tokens','output_tokens']: result[k]=u.get(k)
            if all(isinstance(result[k],int) for k in ['input_tokens','output_tokens']): result['total_tokens']=result['input_tokens']+result['output_tokens']
    elif engine=='claude':
        try:
            obj=json.loads(stdout); u=obj.get('usage',{})
            parts=[u.get(k) for k in ['input_tokens','cache_read_input_tokens','cache_creation_input_tokens']]
            if all(isinstance(v,int) for v in parts): result['input_tokens']=sum(parts)
            result['cached_input_tokens']=u.get('cache_read_input_tokens'); result['cache_write_input_tokens']=u.get('cache_creation_input_tokens'); result['output_tokens']=u.get('output_tokens')
            result['reported_cost_usd']=obj.get('total_cost_usd')
            if isinstance(result['input_tokens'],int) and isinstance(result['output_tokens'],int): result['total_tokens']=result['input_tokens']+result['output_tokens']
        except (ValueError, AttributeError, TypeError): pass
    return result

def isolated_env(home, engine, pass_env):
    # No inherited agent configuration, API keys, or repository secrets by default.
    keep=['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TMP','TEMP','TMPDIR']
    env={k:os.environ[k] for k in keep+pass_env if k in os.environ}
    env.update(HOME=str(home), USERPROFILE=str(home), CODEX_HOME=str(home/'.codex'), CLAUDE_CONFIG_DIR=str(home/'.claude'), BRIEF_HOME=str(home/'.brief'), GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=os.devnull)
    return env

def resolve_exe(name):
    p=shutil.which(name)
    if not p: raise RuntimeError(f'Executable not found: {name}')
    if os.name=='nt' and p.lower().endswith(('.cmd','.bat')):
        raise RuntimeError(f'Windows batch shim {p} is not supported safely; run from WSL or pass a native executable.')
    return p

def cmd(engine, exe, model, task, grader):
    if engine=='mock': return [sys.executable,str(HERE/'mock_runner.py')]
    if engine=='codex': return [exe,'exec','--json','--sandbox','workspace-write','--model',model,'-']
    if engine=='claude': return [exe,'-p','--output-format','json','--permission-mode','acceptEdits','--model',model,'--no-session-persistence']
    raise ValueError(engine)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--suite',type=Path,default=HERE/'suite.json'); ap.add_argument('--engine',choices=['mock','codex','claude'],required=True); ap.add_argument('--model'); ap.add_argument('--executable'); ap.add_argument('--agentbrief-cli',type=Path,default=HERE.parent/'dist'/'cli.js'); ap.add_argument('--trials',type=int,default=5); ap.add_argument('--seed',type=int,default=42); ap.add_argument('--timeout',type=int,default=600); ap.add_argument('--out',type=Path,default=HERE/'results'); ap.add_argument('--pass-env',action='append',default=[]); ap.add_argument('--run-paid',action='store_true'); args=ap.parse_args()
    if args.trials<1 or args.timeout<1: ap.error('trials and timeout must be positive')
    if args.engine!='mock' and (not args.model or not args.run_paid): ap.error('Real runs require --model and --run-paid (may consume credits or subscription quota).')
    suite_path=args.suite.resolve(); base=suite_path.parent; suite=json.loads(suite_path.read_text(encoding='utf-8')); cli=args.agentbrief_cli.resolve(); exe=resolve_exe(args.executable or args.engine) if args.engine!='mock' else None
    if args.engine!='mock' and not cli.is_file(): ap.error(f'Build AgentBrief first: {cli} is missing')
    out=args.out.resolve()/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'); out.mkdir(parents=True,exist_ok=False); os.chmod(out,0o700)
    rows=[]; rng=random.Random(args.seed)
    for task in suite['tasks']:
        fixture=(base/task['fixture']).resolve(); grader=(base/task['grader']).resolve(); prompt=(base/task['prompt']).read_text(encoding='utf-8'); source_hash=digest_tree(fixture); brief_hash=digest_tree((base/task['brief']).resolve());
        if any(x in fixture.parts for x in ['.git','node_modules']): raise ValueError('Fixture must be a clean synthetic project')
        for trial in range(1,args.trials+1):
            arms=['baseline','agentbrief']; rng.shuffle(arms)
            for arm in arms:
                with tempfile.TemporaryDirectory(prefix='ab-eval-') as td:
                    root=Path(td); repo=root/'repo'; home=root/'home'; home.mkdir(); shutil.copytree(fixture,repo); env=isolated_env(home,args.engine,args.pass_env)
                    if digest_tree(repo)!=source_hash: raise RuntimeError('Fixture drift')
                    # Fresh local repo; never use the original user's workspace.
                    for argv in [['git','init','-q'],['git','add','-A'],['git','-c','user.name=Benchmark','-c','user.email=benchmark@example.invalid','commit','-qm','fixture']]:
                        p=run(argv,repo,env,30)
                        if p['exit']!=0: raise RuntimeError('Fixture git setup failed: '+p['stderr'])
                    # Preflight confirms the fixture starts with a failing target check.
                    pre=run([sys.executable,str(grader),str(repo)],root,isolated_env(home,args.engine,[]),60)
                    try:
                        initial_checks=json.loads(pre['stdout'])
                        assert isinstance(initial_checks,dict) and initial_checks and all(isinstance(v,bool) for v in initial_checks.values())
                    except (ValueError,AssertionError): raise RuntimeError('Invalid fixture grader: '+task['id'])
                    if pre['exit']!=0 or all(initial_checks.values()): raise RuntimeError('Fixture must start with a failing check: '+task['id'])
                    if arm=='agentbrief':
                        shutil.copytree((base/task['brief']).resolve(),repo/'.brief')
                        if args.engine=='mock':
                            # Only for checking harness mechanics, never evidence of real AgentBrief behavior.
                            (repo/'AGENTS.md').write_text('Mock treatment only.\n',encoding='utf-8')
                        else:
                            c=run([resolve_exe('node'),str(cli),'compile','--project'],repo,env,60)
                            if c['exit']!=0: raise RuntimeError('Compile failed: '+c['stdout']+'\n'+c['stderr'])
                            expected=repo/('AGENTS.md' if args.engine=='codex' else 'CLAUDE.md')
                            if not expected.is_file(): raise RuntimeError('Treatment did not produce native instructions')
                    before=snapshot(repo); arm_start=time.monotonic();
                    p=run(cmd(args.engine,exe,args.model,task,grader),repo,env,args.timeout,prompt)
                    after=snapshot(repo); changes=sorted(k for k in before.keys()|after.keys() if before.get(k)!=after.get(k))
                    # Grader is trusted suite code outside the editable project, no model credentials.
                    g=run([sys.executable,str(grader),str(repo)],root,isolated_env(home,args.engine,[]),60)
                    try:
                        checks=json.loads(g['stdout']); assert isinstance(checks,dict) and checks and all(isinstance(v,bool) for v in checks.values())
                    except (ValueError, AssertionError): checks={}
                    if g['exit']!=0: checks={}
                    allowed=set(task['allowed_paths']); unexpected=sorted(set(changes)-allowed)
                    passed=bool(checks) and all(checks.values()) and not unexpected and p['exit']==0
                    tag=f"{task['id']}-{trial}-{arm}"; log=out/(tag+'.log'); log.write_text(p['stdout']+'\n--- STDERR ---\n'+p['stderr']+'\n--- GRADER ---\n'+g['stdout']+'\n'+g['stderr'],encoding='utf-8'); os.chmod(log,0o600)
                    row=dict(task=task['id'],trial=trial,arm=arm,fixture_sha256=source_hash,brief_sha256=brief_hash,prompt_sha256=hashlib.sha256(prompt.encode()).hexdigest(),runner_exit=p['exit'],timeout=p['timeout'],runner_seconds=p['seconds'],elapsed_seconds=round(time.monotonic()-arm_start,3),checks=checks,initial_checks=initial_checks,changed_paths=changes,unexpected_paths=unexpected,passed=passed,usage=usage_for(args.engine,p['stdout']),log=log.name)
                    rows.append(row); (out/'runs.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows),encoding='utf-8'); print(tag,'PASS' if passed else 'FAIL',flush=True)
    summary={}
    for arm in ['baseline','agentbrief']:
        group=[r for r in rows if r['arm']==arm]; metrics={}
        for key in ['total_tokens','input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reported_cost_usd']:
            vals=[r['usage'][key] for r in group if isinstance(r['usage'][key],(int,float))]; metrics[key]={'n':len(vals),'mean':statistics.mean(vals) if vals else None}
        summary[arm]={'runs':len(group),'passed':sum(r['passed'] for r in group),'pass_rate':sum(r['passed'] for r in group)/len(group),'mean_runner_seconds':statistics.mean(r['runner_seconds'] for r in group),'metrics':metrics}
    pairs=[]
    for r in rows:
        if r['arm']!='baseline': continue
        t=next(x for x in rows if x['task']==r['task'] and x['trial']==r['trial'] and x['arm']=='agentbrief'); a=r['usage']['total_tokens']; b=t['usage']['total_tokens']; pairs.append({'task':r['task'],'trial':r['trial'],'baseline_passed':r['passed'],'treatment_passed':t['passed'],'token_delta':b-a if isinstance(a,int) and isinstance(b,int) else None,'seconds_delta':round(t['runner_seconds']-r['runner_seconds'],3)})
    report={'engine':args.engine,'model':args.model,'seed':args.seed,'trials_per_task':args.trials,'mock_only':args.engine=='mock','suite_sha256':hashlib.sha256(suite_path.read_bytes()).hexdigest(),'cli_sha256':hashlib.sha256(cli.read_bytes()).hexdigest() if cli.is_file() else None,'summary':summary,'pairs':pairs,'limitations':['No automatic API price estimate; missing usage is null.','Workspace isolation is not an OS sandbox; run trusted synthetic tasks in a disposable VM.','No confidence interval; this is an exploratory paired benchmark.','No second repair turn: rework is not measured.','Mock results are harness tests only.']}; (out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8'); print(out/'report.json')
if __name__=='__main__': main()
