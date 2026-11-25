import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { compileBrief } from "./compile.js";
import { formatCompile } from "./print.js";
import type { CompileOptions } from "./types.js";

/** Recompile when a source layer changes. Ignores manifests, backups, and the inbox. */
export function watchBrief(options: CompileOptions, log: (line: string) => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  const run = (): void => {
    compileBrief(options)
      .then((report) => log(formatCompile(report)))
      .catch((error: unknown) => log(error instanceof Error ? error.message : "compile failed"));
  };
  const schedule = (filename: string | null): void => {
    if (!filename) return;
    const name = filename.replace(/\\/g, "/");
    if (name.includes("backups") || name.includes("inbox") || name.endsWith("manifest.json") || name.endsWith(".tmp")) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 200);
  };
  const watchers: FSWatcher[] = [];
  for (const dir of [options.briefHome, path.join(options.cwd, ".brief")]) {
    try {
      watchers.push(watch(dir, { recursive: true }, (_event, file) => schedule(file ? file.toString() : null)));
    } catch {
      /* The directory is created by init. Watching a missing one is a no-op. */
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
