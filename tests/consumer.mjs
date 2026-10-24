import assert from "node:assert/strict";
import { planEvolution, validateResolutions } from "schema-evolution-planner";
const classifyType = (from, to) =>
  from === to
    ? "equal"
    : from === "decimal" && to === "int"
      ? "narrowing"
      : "incompatible";
const previous = {
  schemaId: "invoice",
  fields: [
    { id: "amount", typeId: "decimal", required: false },
    { id: "old", typeId: "text", required: false },
  ],
};
const next = {
  schemaId: "invoice",
  fields: [
    { id: "amount", typeId: "int", required: true },
    { id: "new", typeId: "text", required: true },
    { id: "note", typeId: "text", required: false },
  ],
};
const plan = planEvolution(previous, next, { classifyType });
assert.equal(plan.status, "requires_resolution");
assert.deepEqual(
  plan.changes.map((x) => x.code),
  [
    "type_narrowed",
    "requiredness_tightened",
    "field_added_required",
    "field_added_optional",
    "field_removed",
  ],
);
assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
assert.deepEqual(
  planEvolution(
    { ...previous, fields: [...previous.fields].reverse() },
    { ...next, fields: [...next.fields].reverse() },
    { classifyType },
  ),
  plan,
);
const resolutions = plan.changes
  .filter((x) => x.requiredResolutionKind)
  .map((x) => ({
    changeId: x.changeId,
    kind: x.requiredResolutionKind,
    reference:
      x.requiredResolutionKind === "drop_confirmed"
        ? undefined
        : "reviewed-operation-v1",
  }));
assert.deepEqual(validateResolutions(plan, resolutions), {
  ready: true,
  issues: [],
});
assert.equal(validateResolutions(plan, []).ready, false);
assert.ok(
  validateResolutions(plan, [...resolutions, resolutions[0]]).issues.some(
    (x) => x.code === "duplicate_resolution",
  ),
);
assert.ok(
  validateResolutions(plan, [
    { changeId: "unknown", kind: "backfill", reference: "x" },
  ]).issues.some((x) => x.code === "unknown_change"),
);
const wrong = resolutions.map((x, i) =>
  i === 0 ? { ...x, kind: "backfill" } : x,
);
assert.ok(
  validateResolutions(plan, wrong).issues.some(
    (x) => x.code === "wrong_resolution_kind",
  ),
);
assert.ok(
  validateResolutions(
    plan,
    resolutions.map((x) => ({ ...x, reference: " " })),
  ).issues.some((x) => x.code === "missing_reference"),
);
const blocked = planEvolution(previous, next, {
  classifyType: () => "incompatible",
});
assert.equal(blocked.status, "blocked");
assert.equal(validateResolutions(blocked, []).ready, false);
assert.throws(
  () =>
    planEvolution(previous, { ...next, schemaId: "other" }, { classifyType }),
  /schemaId/,
);
console.log("installed schema changes/fingerprints/resolutions consumer: PASS");
