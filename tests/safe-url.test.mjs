import test from "node:test";
import assert from "node:assert/strict";
import { safeHttpUrl } from "../lib/safe-url.ts";

test("accepts only absolute HTTP(S) URLs for operator-controlled links and previews", () => {
  assert.equal(safeHttpUrl("https://example.test/image.jpg"), "https://example.test/image.jpg");
  assert.equal(safeHttpUrl("http://example.test/path"), "http://example.test/path");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safeHttpUrl("//example.test/image.jpg"), null);
  assert.equal(safeHttpUrl(null), null);
});
