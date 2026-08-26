# Schema Evolution Planner

A deterministic TypeScript planner for **flat named-field schemas**. It classifies safe changes, explicit-resolution changes, and blocked incompatibilities without executing a database migration.

## What it does

- opaque schema, field, and type IDs;
- injected type-compatibility policy;
- safe optional additions, widening and required→optional changes;
- explicit backfill, transform and drop-confirmation tasks;
- blocked incompatible type transitions;
- deterministic code-point ordering, change IDs and SHA-256 plan fingerprints;
- exact resolution validation with duplicate, unknown, wrong-kind, missing-reference and missing-resolution issues.

## Installation

```bash
npm install https://github.com/FrankFMY/schema-evolution-planner/releases/download/v0.1.0/schema-evolution-planner-0.1.0.tgz
```

## Example

```ts
import { planEvolution, validateResolutions } from "schema-evolution-planner";

const plan = planEvolution(
  {
    schemaId: "customer",
    fields: [{ id: "age", typeId: "int", required: false }],
  },
  {
    schemaId: "customer",
    fields: [{ id: "age", typeId: "decimal", required: true }],
  },
  {
    classifyType(previous, next) {
      if (previous === next) return "equal";
      if (previous === "int" && next === "decimal") return "widening";
      return "incompatible";
    },
  },
);

const required = plan.changes.find(
  (change) => change.code === "requiredness_tightened",
)!;
const readiness = validateResolutions(plan, [
  {
    changeId: required.changeId,
    kind: "backfill",
    reference: "customer-age-backfill-v1",
  },
]);
```

## Explicit boundaries

- The planner does not execute SQL, inspect rows, infer a rename, move data, or promise rollback.
- A rename is represented as remove + add and needs caller-owned explicit resolutions.
- `classifyType` owns semantic compatibility; string equality alone is not treated as a universal type system.
- The initial core handles flat fields only. Nested objects, arrays, indexes, constraints, SQL dialects, generated migration code, and automatic transforms remain adapter-owned.
- A `ready` plan means declared resolutions are structurally complete, not that data execution will succeed.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm run check
npm test
npm run build
npm run pack:check
```

## Author

**Artem Prianishnikov** — https://github.com/FrankFMY

## License

Apache-2.0 © 2026 Artem Prianishnikov.
