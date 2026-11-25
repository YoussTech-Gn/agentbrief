import { planCompilation } from "./compile.js";
import { hashInner, parseRegion, PRESERVED_NOTE } from "./markers.js";
import { listPending, proposeChange } from "./proposals.js";
import type { CompileOptions, Proposal } from "./types.js";
import { normalize, readText } from "./util.js";

export interface CaptureOptions extends CompileOptions {
  /** Also capture hand-written text added below `<!-- brief:end -->`. */
  includeOutside?: boolean;
}

export interface CaptureResult {
  created: Proposal[];
  skipped: Array<{ displayPath: string; reason: string }>;
}

/**
 * Inspect compiled tool instruction files for edits made inside generated
 * regions (e.g. by Claude auto-memory, Gemini `/memory add`, or hand edits)
 * and turn the added lines into pending proposals in the inbox.
 */
export async function captureEdits(options: CaptureOptions): Promise<CaptureResult> {
  const planned = await planCompilation(options);
  const existingPending = await listPending(options.cwd, options.briefHome);
  const seenBodies = new Set(existingPending.map((item) => normalize(item.body)));
  const created: Proposal[] = [];
  const skipped: Array<{ displayPath: string; reason: string }> = [];

  for (const plan of planned.plans) {
    const existing = await readText(plan.absPath);
    if (!existing) continue;
    const region = parseRegion(existing);
    if (!region) {
      skipped.push({ displayPath: plan.displayPath, reason: "no brief markers found" });
      continue;
    }

    const bodyHash = hashInner(region.inner);
    const markerHash = region.attrs["hash"];
    const editedInside = bodyHash !== plan.hash && (!markerHash || bodyHash !== markerHash);

    const addedParts: string[] = [];
    if (editedInside) {
      const diff = extractAddedLines(plan.inner, region.inner);
      if (diff) addedParts.push(diff);
    }

    if (options.includeOutside && region.postamble.trim()) {
      const cleanedOutside = region.postamble.replace(PRESERVED_NOTE, "").trim();
      if (cleanedOutside) addedParts.push(cleanedOutside);
    }

    const capturedBody = normalize(addedParts.join("\n\n"));
    if (!capturedBody) continue;

    if (seenBodies.has(capturedBody)) {
      skipped.push({ displayPath: plan.displayPath, reason: "already pending in inbox" });
      continue;
    }

    const layer = plan.scope === "global" ? "personal" : "project";
    const file = plan.scope === "global" ? "preferences.md" : "project.md";
    const proposal = await proposeChange({
      cwd: options.cwd,
      briefHome: options.briefHome,
      title: `Captured from ${plan.target} (${plan.displayPath})`,
      body: capturedBody,
      layer,
      file,
      action: "append",
      source: `capture:${plan.target}`,
    });
    seenBodies.add(capturedBody);
    created.push(proposal);
  }

  return { created, skipped };
}

/** Return lines present in `actual` that were not present in `expected`. */
export function extractAddedLines(expected: string, actual: string): string {
  const baseLines = new Set(
    normalize(expected)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const added: string[] = [];
  for (const rawLine of normalize(actual).split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (added.length > 0 && added[added.length - 1] !== "") added.push("");
      continue;
    }
    if (!baseLines.has(trimmed)) {
      added.push(rawLine);
    }
  }
  return added.join("\n").trim();
}
