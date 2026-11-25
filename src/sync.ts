import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface SyncResult {
  messages: string[];
  committed: boolean;
  pushed: boolean;
}

export function syncBrief(briefHome: string, remote?: string): SyncResult {
  if (!existsSync(briefHome)) {
    throw new Error(`No personal brief at ${briefHome}. Run brief init --global first.`);
  }
  ensureRepo(briefHome);
  ensureIdentity(briefHome);
  if (rebaseInProgress(briefHome)) {
    throw new Error(
      "A rebase is already in progress in the brief repo. Finish it or run `git rebase --abort` there, then brief sync again.",
    );
  }
  const messages: string[] = [];
  if (remote) {
    setRemote(briefHome, remote);
    messages.push(`Remote set to ${remote}.`);
  }
  git(briefHome, ["add", "-A"]);
  const staged = git(briefHome, ["diff", "--cached", "--name-only"]);
  let committed = false;
  if (staged.trim()) {
    git(briefHome, ["commit", "-m", "brief sync"]);
    committed = true;
    messages.push("Committed local brief changes.");
  } else {
    messages.push("No local brief changes to commit.");
  }
  let origin = "";
  try {
    origin = git(briefHome, ["remote", "get-url", "origin"]);
  } catch {
    origin = "";
  }
  if (!origin) {
    messages.push("No git remote yet. Add one with `brief sync --remote <git-url>`, then run `brief sync` again.");
    return { messages, committed, pushed: false };
  }
  const branch = currentBranch(briefHome);
  let remoteHasHistory = false;
  try {
    git(briefHome, ["fetch", "origin"]);
    remoteHasHistory = remoteBranchExists(briefHome, branch);
  } catch (error) {
    throw new Error(`Could not fetch ${origin}. ${errorText(error)}`);
  }
  if (remoteHasHistory) {
    try {
      git(briefHome, ["pull", "--rebase", "origin", branch]);
      messages.push(`Rebased on origin/${branch}.`);
    } catch (error) {
      try {
        git(briefHome, ["rebase", "--abort"]);
      } catch {
        /* already clean, or abort failed because rebase had not started */
      }
      throw new Error(
        `Could not rebase on origin/${branch}. Local commits were left in place and nothing was force-pushed. ${errorText(error)}`,
      );
    }
  }
  git(briefHome, ["push", "-u", "origin", branch]);
  messages.push(`Pushed ${branch} to origin.`);
  return { messages, committed, pushed: true };
}

export function ensureRepo(briefHome: string): void {
  if (existsSync(path.join(briefHome, ".git"))) return;
  git(briefHome, ["init", "-b", "main"]);
}

export function ensureIdentity(briefHome: string): void {
  if (!gitConfig(briefHome, "user.name")) {
    const name = process.env["GIT_AUTHOR_NAME"] || process.env["USER"] || "brief";
    git(briefHome, ["config", "user.name", name]);
  }
  if (!gitConfig(briefHome, "user.email")) {
    const email = process.env["GIT_AUTHOR_EMAIL"] || "brief@localhost";
    git(briefHome, ["config", "user.email", email]);
  }
}

export function initialCommit(briefHome: string): boolean {
  ensureRepo(briefHome);
  ensureIdentity(briefHome);
  try {
    git(briefHome, ["rev-parse", "HEAD"]);
    return false;
  } catch {
    git(briefHome, ["add", "-A"]);
    git(briefHome, ["commit", "-m", "Initial builder brief"]);
    return true;
  }
}

function setRemote(briefHome: string, remote: string): void {
  try {
    git(briefHome, ["remote", "get-url", "origin"]);
    git(briefHome, ["remote", "set-url", "origin", remote]);
  } catch {
    git(briefHome, ["remote", "add", "origin", remote]);
  }
}

function currentBranch(briefHome: string): string {
  const branch = git(briefHome, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : "main";
}

function remoteBranchExists(briefHome: string, branch: string): boolean {
  try {
    git(briefHome, ["rev-parse", "--verify", `origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function rebaseInProgress(briefHome: string): boolean {
  return (
    existsSync(path.join(briefHome, ".git", "rebase-merge")) ||
    existsSync(path.join(briefHome, ".git", "rebase-apply"))
  );
}

function gitConfig(briefHome: string, key: string): string {
  try {
    return git(briefHome, ["config", key]);
  } catch {
    return "";
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr;
    const text = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr ?? "";
    const line = text.trim().split("\n").at(-1);
    if (line) return line;
  }
  if (error instanceof Error) return error.message;
  return "git failed";
}
