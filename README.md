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

The npm release is pending maintainer approval. [npm package](https://www.npmjs.com/package/schema-evolution-planner). Until approval, the existing GitHub asset above remains usable; build this candidate with `npm ci && npm run build && npm pack` from a source checkout.

Runtime: ESM on Node.js 20+. The root module uses `node:crypto` and is not a browser entry point. No runtime dependencies.

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
- Plans and compatibility callbacks are trusted caller-owned values. Validate external/persisted data before using it; a fingerprint is an integrity identifier, not authentication.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm run check
npm test
npm run build
npm run pack:check
npm run package:check
```

## Author

**Artem Prianishnikov** — https://github.com/FrankFMY

- Website: https://frankfmy.com
- Email: Pryanishnikovartem@gmail.com · frankfmy@proton.me
- Telegram: https://t.me/FrankFMY
- LinkedIn: https://www.linkedin.com/in/frankfmy/
- X: https://x.com/FrankFMY
- npm: https://www.npmjs.com/~frankfmy

## License

Apache-2.0 © 2026 Artem Prianishnikov. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
