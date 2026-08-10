import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reCatalog, reRun, reStatus } from "../src/tools.ts";

describe("echo-reverse-engineering", () => {
  it("catalog live", () => {
    const c = reCatalog();
    assert.equal(c.status, "live");
    assert.ok(c.count >= 5);
  });
  it("status", () => assert.equal(reStatus().status, "live"));
  it("decompile works", async () => {
    const r = await reRun("re.static.decompile", "package.json");
    assert.equal(r.ok, true);
  });
  it("sandbox needs EXECUTE", async () => {
    const r = await reRun("re.dynamic.sandbox_exec_profile");
    assert.equal(r.ok, false);
  });
  it("sandbox with EXECUTE", async () => {
    const r = await reRun("re.dynamic.sandbox_exec_profile", undefined, "EXECUTE");
    assert.equal(r.ok, true);
  });
});
