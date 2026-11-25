import type { CheckReport, CompileReport } from "./types.js";

const useColor = Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];

function paint(code: number, text: string): string {
  if (!useColor) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function formatCompile(report: CompileReport): string {
  const lines: string[] = [
    `variant ${report.variant}, composition ${report.composition}, scopes ${report.scopes.join(", ") || "none"}`,
  ];
  if (report.files.length === 0) lines.push("No files to write.");
  for (const file of report.files) {
    const flag = file.overBudget ? " over-budget" : "";
    const extra = file.reason ? ` — ${file.reason}` : "";
    const backup = file.backup ? ` (backup ${file.backup})` : "";
    lines.push(`${pad(file.status)} ${file.displayPath}  ${file.tokens} tok${flag}${extra}${backup}`);
  }
  for (const warning of report.warnings) lines.push(paint(33, `warning  ${warning}`));
  const skipped = report.files.filter((file) => file.status === "skipped").length;
  lines.push(skipped === 0 ? "Compile finished." : `Compile finished with ${skipped} file(s) left untouched.`);
  return lines.join("\n");
}

export function formatCheck(report: CheckReport): string {
  const lines: string[] = [`variant ${report.variant}, composition ${report.composition}`];
  for (const file of report.files) {
    const color = file.status === "ok" ? 32 : 31;
    lines.push(`${paint(color, pad(file.status))} ${file.displayPath}  ${file.tokens} tok`);
  }
  const errors = report.findings.filter((finding) => finding.severity === "error");
  const warnings = report.findings.filter((finding) => finding.severity === "warning");
  for (const finding of errors) lines.push(paint(31, `error    ${finding.message}`));
  for (const finding of warnings) lines.push(paint(33, `warning  ${finding.message}`));
  if (report.sessions.length) {
    lines.push("Sessions (verified loads, estimated tokens):");
    for (const session of report.sessions) {
      lines.push(`  ${session.label}  ~${session.tokens}  ${session.parts.join(" + ") || "(none)"}`);
    }
  }
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return lines.join("\n");
}

export function checkFailed(report: CheckReport, strict: boolean): boolean {
  return report.findings.some((finding) => finding.severity === "error" || (strict && finding.severity === "warning"));
}

function pad(status: string): string {
  return status.padEnd(9, " ");
}
