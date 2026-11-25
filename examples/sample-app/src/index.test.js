import assert from "node:assert/strict";
import test from "node:test";
import { health } from "./index.js";

test("health reports ok", () => {
  assert.deepEqual(health(), { ok: true });
});
