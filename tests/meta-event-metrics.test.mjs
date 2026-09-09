import test from "node:test";
import assert from "node:assert/strict";
import { callbackFormOpens } from "../lib/meta-event-metrics.ts";

test("keeps callback-form opens separate from Lead and accepts Meta action-type prefixes", () => {
  const metric = callbackFormOpens([
    { rawActions: JSON.stringify([
      { action_type: "offsite_conversion.fb_pixel_lead", value: "4" },
      { action_type: "offsite_conversion.fb_pixel_SubscribedButtonClick", value: "7" },
    ]) },
    { rawActions: JSON.stringify([{ action_type: "SubscribedButtonClick", value: "2" }]) },
  ]);
  assert.equal(metric.value, 9);
  assert.deepEqual(metric.actionTypes, ["SubscribedButtonClick", "offsite_conversion.fb_pixel_SubscribedButtonClick"]);
});

test("distinguishes an observed zero from unavailable Meta action data", () => {
  assert.equal(callbackFormOpens([{ rawActions: "[]" }]).value, 0);
  assert.equal(callbackFormOpens([{ rawActions: "null" }]).value, null);
  assert.equal(callbackFormOpens([{ rawActions: "not json" }]).value, null);
});
