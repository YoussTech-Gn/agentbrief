import path from "node:path";
import { planCompilation } from "./compile.js";
import type { CompileOptions } from "./types.js";
import { readText, stamp, writeText } from "./util.js";

const DEFAULT_TASK = `# Task

Add a \`health()\` function that returns \`{ ok: true }\` and a test that calls it.

Keep the change inside the existing module style. Do not add a dependency.
`;

export interface EvalResult {
  outFile: string;
  stub: true;
  withBriefTokens: number;
  withoutBriefTokens: number;
}

/**
 * Record the same task with and without the compiled brief.
 * This does not call a model. See evals/README.md.
 */
export async function evalBrief(options: CompileOptions & { task?: string; outDir?: string }): Promise<EvalResult> {
  const taskPath = options.task;
  const task = taskPath ? ((await readText(taskPath)) ?? DEFAULT_TASK) : DEFAULT_TASK;
  let withBrief = task.trim();
  let withTokens = Math.ceil(withBrief.length / 4);
  try {
    const planned = await planCompilation({ ...options, scopes: options.scopes ?? ["project"] });
    const project = planned.plans.find((plan) => plan.scope === "project" && plan.target === "agents") ?? planned.plans[0];
    if (project) {
      withBrief = `${task.trim()}\n\n---\n\n${project.inner}`;
      withTokens = project.tokens + Math.ceil(task.length / 4);
    }
  } catch {
    /* A repo with no brief still produces a comparable pair. */
  }
  const withoutTokens = Math.max(1, Math.ceil(task.trim().length / 4));
  const result = {
    stub: true as const,
    note: "This harness does not call a model. model_output is null on both arms. Wire a runner yourself if you want scores; brief only records the prompts and token estimates.",
    recordedAt: new Date().toISOString(),
    task: task.trim(),
    without_brief: {
      prompt: task.trim(),
      tokens_estimate: withoutTokens,
      model_output: null,
    },
    with_brief: {
      prompt: withBrief,
      tokens_estimate: withTokens,
      model_output: null,
    },
  };
  const dir = options.outDir ?? path.join(options.cwd, "evals", "results");
  const outFile = path.join(dir, `${stamp()}.json`);
  await writeText(outFile, `${JSON.stringify(result, null, 2)}\n`);
  return { outFile, stub: true, withBriefTokens: withTokens, withoutBriefTokens: withoutTokens };
}
