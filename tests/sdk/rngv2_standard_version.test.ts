import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_REVISION_V1_2,
  PROTOCOL_REVISION_V1_3_2,
  standardVersionForRngV2Revision,
} from "../../sdk/verify.ts";

test("protocol revisions match the program constants", () => {
  assert.equal(PROTOCOL_REVISION_V1_3_2, 1);
  assert.equal(PROTOCOL_REVISION_V1_2, 2);
});

test("single-phase settle is labelled 1.2.1, not the two-phase standard", () => {
  assert.equal(standardVersionForRngV2Revision(PROTOCOL_REVISION_V1_2), "1.2.1");
  assert.equal(standardVersionForRngV2Revision(0), "1.2.1");
});

test("two-phase attest is labelled 1.3.2", () => {
  assert.equal(standardVersionForRngV2Revision(PROTOCOL_REVISION_V1_3_2), "1.3.2");
});
