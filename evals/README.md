# Does the brief help?

`agentbrief eval` is a stub. It does not call a model, and it does not score anything.

It writes one JSON file with the same task recorded twice:

- `without_brief` is the task alone.
- `with_brief` is the task plus the compiled project brief (the `AGENTS.md` body when that target is on).

Both arms set `model_output` to `null`. Token counts are the same character estimate `agentbrief check` uses (`characters / chars_per_token`, default 4), not a tokenizer.

## Run it

```bash
agentbrief eval --task evals/tasks/add-health-check.md
```

The result lands in `evals/results/<timestamp>.json`. That directory is gitignored.

## What a real run would add

Point a runner you already trust at the two prompts in the JSON. Use the same model, the same tool, and the same repository snapshot. Fill `model_output` yourself, then compare whatever you care about: did the change stay inside the task, did the project's checks pass, did the agent edit a generated file. This repo does not ship that runner on purpose. A harness that calls an API would need a key, a model choice, and a budget, and a stub that pretends to score those runs would be a lie.
