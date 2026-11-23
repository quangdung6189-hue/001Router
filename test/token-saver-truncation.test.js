import { test } from "node:test";
import assert from "node:assert/strict";
import { compressText } from "../server/tokenSaver.js";
import { applyRtkStructuredFilter } from "../server/rtkFilters.js";

const sourceFile = Array.from({ length: 300 }, (_, i) => `const value${i} = compute(${i}); // line ${i}`).join("\n");

test("300-line file under Max Chars is kept whole (no middle cut)", () => {
  assert.ok(sourceFile.length < 20000);
  const res = compressText(sourceFile, 20000);
  assert.equal(res.text, sourceFile);
  assert.equal(res.savedChars, 0);
});

test("line-numbered read keeps every line and only trims gutter padding", () => {
  const numbered = Array.from({ length: 300 }, (_, i) => `${String(i + 1).padStart(6)}|row ${i + 1}`).join("\n");
  const res = applyRtkStructuredFilter(numbered);
  assert.equal(res.filter, "read-numbered");
  const lines = res.text.split("\n");
  assert.equal(lines.length, 300);
  assert.equal(lines[149], "150|row 150");
  assert.ok(!res.text.includes("truncated"));
});

test("output above Max Chars is clamped to head 60% + tail 35% budget", () => {
  const big = sourceFile.repeat(4);
  const res = compressText(big, 5000);
  assert.ok(res.text.length <= 5000);
  assert.ok(res.text.includes("truncated"));
  assert.ok(res.text.startsWith("const value0 "));
  assert.ok(res.text.endsWith("// line 299"));
});
