# AgentBrief paired benchmark — experimental

Requires Python 3.12+, Node 20+, Git and (for real trials) an installed, authenticated Claude Code or Codex CLI. Run in a disposable VM, with a clean CLI configuration and synthetic data. This harness isolates fixture copies and homes, not processes at OS level. Never run with production credentials or untrusted fixtures. Grading executes candidate code. Credentials explicitly passed to an agent may be accessible to its shell; use scoped temporary credentials in a disposable environment. Logs can contain sensitive model output. Keep results private unless reviewed.

From the repository root:

```sh
npm ci
npm run build
python evals/benchmark.py --engine mock --trials 2
```

The mock writes prewritten patches in both arms; its scores are a smoke test of the harness, **not** an AI evaluation. For a real experiment choose an exact model identifier available to your account. Model calls can consume quota or incur charges. The fresh per-run home deliberately does not use your normal CLI authentication/config. For example, in WSL/Linux after provisioning an appropriate scoped API key:

```sh
python evals/benchmark.py --engine codex --model YOUR_MODEL --pass-env OPENAI_API_KEY --run-paid --trials 5
python evals/benchmark.py --engine claude --model YOUR_MODEL --pass-env ANTHROPIC_API_KEY --run-paid --trials 5
```

Depending on the installed CLI, authentication may need a different supported environment variable or a dedicated adapter; verify `codex exec --help` / `claude --help`. On Windows use WSL or a native executable via `--executable` (batch shims intentionally rejected). Use same model/settings for both arms. For each engine, 3 tasks × 2 arms × 5 trials = 30 sessions. Run one trial per task first. Results: `evals/results/<timestamp>/runs.jsonl`, `report.json`, and per-run logs. Review logs and CLI version before interpretation. CLI flags follow documented noninteractive modes, but have not been tested against live CLI installations here.

## Method

A frozen fixture is copied to a fresh directory and initialized as a new git repo for each run. The exact same task prompt is sent to each arm. Treatment copies the project's brief into the fixture and invokes the built AgentBrief compiler; baseline does not. Arm order is randomized within trial. Fixtures, briefs, prompt and CLI entrypoint hashes are recorded. The full compiler tree/CLI version is not hashed: record the actual AgentBrief git commit, agent CLI version, model snapshot, environment and settings separately. External graders run predefined checks, and changes outside the allowed files cause failure. Three starter tasks cover basic implementation, authorization, and architecture. The architecture import check is heuristic. These toy fixtures are not representative of real projects; add larger, independently authored tasks and a third arm with a manually curated equivalent native instruction file to distinguish value of the compiler from value of the information supplied.

Metrics: task pass rate, per-check results, changed paths, elapsed runner time, provider-reported tokens and Claude-reported cost if available. Null means unknown, never zero. No subscription dollar conversion or estimated savings. No automatic rework measurement, no confidence intervals, no live integration tests yet. A high pass rate with both arms is not evidence of added value. Do not count retries selectively; report all failed/timeout trials. Pre-register success thresholds and expand beyond three tasks. Suggested exploratory gate: no regression in security or overall quality; lower median paired total token use or time on larger tasks; repeat on different models. A treatment that improves correctness at higher cost may still be valuable.
