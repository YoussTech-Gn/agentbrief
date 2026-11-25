import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { acceptProposal, listPending, proposeChange, rejectProposal } from "../dist/proposals.js";
import { makeWorkspace, read, write } from "./helpers.mjs";

test("propose only writes the inbox until review accepts it", async () => {
  const workspace = await makeWorkspace();
  try {
    const preferences = path.join(workspace.briefHome, "preferences.md");
    await write(preferences, "# Preferences\n\nKeep names plain.\n");
    const before = await read(preferences);
    const proposal = await proposeChange({
      cwd: workspace.cwd,
      briefHome: workspace.briefHome,
      title: "Prefer early returns",
      body: "When a branch is a guard, return early.",
      layer: "personal",
      file: "preferences.md",
      action: "append",
      source: "agent",
    });
    assert.equal(await read(preferences), before);
    assert.equal((await listPending(workspace.cwd, workspace.briefHome)).length, 1);
    const accepted = await acceptProposal(workspace.cwd, workspace.briefHome, proposal.id);
    assert.equal(accepted.status, "accepted");
    const after = await read(preferences);
    assert.match(after, /## Learned: Prefer early returns/);
    assert.match(after, /return early/);
    assert.match(after, /Keep names plain/);
    const parked = await read(path.join(workspace.briefHome, "inbox", "accepted", `${proposal.id}.md`));
    await write(path.join(workspace.briefHome, "inbox", `${proposal.id}.md`), parked.replace("status: accepted", "status: pending"));
    await acceptProposal(workspace.cwd, workspace.briefHome, proposal.id);
    const twice = await read(preferences);
    assert.equal(twice.split("return early").length, after.split("return early").length);
  } finally {
    await workspace.cleanup();
  }
});

test("reject archives the proposal and leaves the source alone", async () => {
  const workspace = await makeWorkspace();
  try {
    const project = path.join(workspace.cwd, ".brief", "project.md");
    await write(project, "# Project\n\nUnchanged.\n");
    const proposal = await proposeChange({
      cwd: workspace.cwd,
      briefHome: workspace.briefHome,
      title: "Add a cache",
      body: "Cache the list endpoint.",
      layer: "project",
      file: "project.md",
      action: "append",
      source: "cli",
    });
    await rejectProposal(workspace.cwd, workspace.briefHome, proposal.id, "not this slice");
    assert.equal(await read(project), "# Project\n\nUnchanged.\n");
    const archived = await read(path.join(workspace.cwd, ".brief", "inbox", "rejected", `${proposal.id}.md`));
    assert.match(archived, /not this slice/);
    assert.equal((await listPending(workspace.cwd, workspace.briefHome)).length, 0);
  } finally {
    await workspace.cleanup();
  }
});
