import test from "node:test";
import assert from "node:assert/strict";
import { recoverStoredResult } from "../lib/stored-result-events.ts";
const type = "offsite_conversion.fb_pixel_lead";
test("old unknown leads are recovered only from a matching configured provider receipt", () => {
  assert.equal(recoverStoredResult('[{"action_type":"link_click","value":"12"}]', type, type), 0);
  assert.equal(recoverStoredResult(JSON.stringify([{ action_type: type, value: "3" }]), type, type), 3);
  for (const raw of ["null", "{}", "invalid", '[{"action_type":"link_click","value":""}]', '[{"action_type":"link_click","value":"invalid"}]', '[{"action_type":"offsite_conversion.custom.123","value":"2"}]']) assert.equal(recoverStoredResult(raw, type, type), null);
  assert.equal(recoverStoredResult("[]", "other_event", type), null);
  assert.equal(recoverStoredResult("[]", type, undefined), null);
});
