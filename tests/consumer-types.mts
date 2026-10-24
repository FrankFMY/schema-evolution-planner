import { planEvolution, validateResolutions } from "schema-evolution-planner";
import type { FlatSchema, EvolutionPlan } from "schema-evolution-planner";
const schema: FlatSchema = {
  schemaId: "example",
  fields: [{ id: "field", typeId: "text", required: true }],
};
const plan: EvolutionPlan = planEvolution(schema, schema, {
  classifyType: () => "equal",
});
validateResolutions(plan, []);
// @ts-expect-error classifier must return the compatibility vocabulary
planEvolution(schema, schema, { classifyType: () => "maybe" });
const invalid: FlatSchema = {
  schemaId: "example",
  // @ts-expect-error requiredness is boolean
  fields: [{ id: "x", typeId: "text", required: "yes" }],
};
// @ts-expect-error only declared resolution kinds are accepted
validateResolutions(plan, [{ changeId: "x", kind: "ignore" }]);
void invalid;
