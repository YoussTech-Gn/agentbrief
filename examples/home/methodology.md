---
title: How I build
order: 20
---

# How I build

1. Read the code that already owns the behavior before adding a new pattern.
2. Name the slice: the smallest end-to-end change a person can run.
3. Implement that slice in the project's existing style.
4. Verify it with the project's own checks. Do not claim it works without saying what ran.
5. When the same correction shows up twice, propose it into this brief instead of repeating it in chat.

<!-- brief:detail -->

## While you are in the code

- Match the local pattern. A second way to do the same thing is a bug.
- Do not refactor neighbors because you are already in the file.
- Handle errors where you have enough context to say what the caller should do.
- Delete a branch of code only when you can say what used to depend on it.
- If a file is generated, edit its source and recompile. The marker `brief:generated` means the file is generated.

## When you stop

- Say what changed, why, and which checks ran.
- Say what you did not verify.
- If you learned a durable preference, run `brief propose` instead of silently editing a compiled file.
