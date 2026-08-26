import { createHash } from "node:crypto";

export interface SchemaField {
  id: string;
  typeId: string;
  required: boolean;
}

export interface FlatSchema {
  schemaId: string;
  fields: readonly SchemaField[];
}

export type TypeCompatibility =
  "equal" | "widening" | "narrowing" | "transform_required" | "incompatible";

export type ChangeStatus = "safe" | "requires_resolution" | "blocked";
export type PlanStatus = "safe" | "requires_resolution" | "blocked";
export type ChangeCode =
  | "field_added_optional"
  | "field_added_required"
  | "field_removed"
  | "requiredness_relaxed"
  | "requiredness_tightened"
  | "type_widened"
  | "type_narrowed"
  | "type_transform_required"
  | "type_incompatible";
export type ResolutionKind = "backfill" | "drop_confirmed" | "transform";

export interface EvolutionChange {
  changeId: string;
  fieldId: string;
  code: ChangeCode;
  status: ChangeStatus;
  fromTypeId?: string;
  toTypeId?: string;
  requiredResolutionKind?: ResolutionKind;
}

export interface EvolutionPlan {
  schemaId: string;
  fingerprint: string;
  status: PlanStatus;
  changes: EvolutionChange[];
}

export interface PlanEvolutionOptions {
  classifyType(previousTypeId: string, nextTypeId: string): TypeCompatibility;
}

export interface EvolutionResolution {
  changeId: string;
  kind: ResolutionKind;
  reference?: string;
}

export interface ResolutionIssue {
  code:
    | "plan_blocked"
    | "unknown_change"
    | "duplicate_resolution"
    | "wrong_resolution_kind"
    | "missing_reference"
    | "missing_resolution";
  changeId?: string;
}

export interface ResolutionValidation {
  ready: boolean;
  issues: ResolutionIssue[];
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const COMPATIBILITIES = new Set<TypeCompatibility>([
  "equal",
  "widening",
  "narrowing",
  "transform_required",
  "incompatible",
]);
const CODE_ORDER: readonly ChangeCode[] = [
  "type_widened",
  "type_narrowed",
  "type_transform_required",
  "type_incompatible",
  "requiredness_relaxed",
  "requiredness_tightened",
  "field_removed",
  "field_added_optional",
  "field_added_required",
];
const codeRank = new Map(CODE_ORDER.map((code, index) => [code, index]));

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateSchema(
  schema: FlatSchema,
  name: string,
): Map<string, SchemaField> {
  if (
    !schema ||
    typeof schema !== "object" ||
    typeof schema.schemaId !== "string" ||
    !IDENTIFIER.test(schema.schemaId)
  ) {
    throw new TypeError(
      `${name}.schemaId must be a bounded portable identifier`,
    );
  }
  if (!Array.isArray(schema.fields) || schema.fields.length > 10_000) {
    throw new TypeError(
      `${name}.fields must be an array with at most 10000 entries`,
    );
  }
  const fields = new Map<string, SchemaField>();
  for (const field of schema.fields) {
    if (
      !field ||
      typeof field !== "object" ||
      typeof field.id !== "string" ||
      typeof field.typeId !== "string" ||
      !IDENTIFIER.test(field.id) ||
      !IDENTIFIER.test(field.typeId)
    ) {
      throw new TypeError(`${name} contains an invalid field`);
    }
    if (typeof field.required !== "boolean")
      throw new TypeError(`${name}.${field.id}.required must be boolean`);
    if (fields.has(field.id))
      throw new TypeError(`${name} contains duplicate field ${field.id}`);
    fields.set(field.id, {
      id: field.id,
      typeId: field.typeId,
      required: field.required,
    });
  }
  return fields;
}

function makeChange(
  fieldId: string,
  code: ChangeCode,
  status: ChangeStatus,
  details: Pick<
    EvolutionChange,
    "fromTypeId" | "toTypeId" | "requiredResolutionKind"
  > = {},
): EvolutionChange {
  const identity = [
    fieldId,
    code,
    details.fromTypeId ?? "",
    details.toTypeId ?? "",
    details.requiredResolutionKind ?? "",
  ].join("\u001f");
  const change: EvolutionChange = {
    changeId: digest(identity),
    fieldId,
    code,
    status,
  };
  if (details.fromTypeId !== undefined) change.fromTypeId = details.fromTypeId;
  if (details.toTypeId !== undefined) change.toTypeId = details.toTypeId;
  if (details.requiredResolutionKind !== undefined)
    change.requiredResolutionKind = details.requiredResolutionKind;
  return change;
}

function canonicalSchema(
  schemaId: string,
  fields: Map<string, SchemaField>,
): string {
  const sorted = [...fields.values()].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  return JSON.stringify({ schemaId, fields: sorted });
}

export function planEvolution(
  previous: FlatSchema,
  next: FlatSchema,
  options: PlanEvolutionOptions,
): EvolutionPlan {
  if (!options || typeof options.classifyType !== "function")
    throw new TypeError("classifyType must be a function");
  const previousFields = validateSchema(previous, "previous");
  const nextFields = validateSchema(next, "next");
  if (previous.schemaId !== next.schemaId)
    throw new TypeError(
      "schemaId must remain stable during one evolution plan",
    );
  const fieldIds = new Set([...previousFields.keys(), ...nextFields.keys()]);
  const changes: EvolutionChange[] = [];

  for (const fieldId of [...fieldIds].sort(compareCodePoints)) {
    const before = previousFields.get(fieldId);
    const after = nextFields.get(fieldId);
    if (!before && after) {
      changes.push(
        after.required
          ? makeChange(fieldId, "field_added_required", "requires_resolution", {
              toTypeId: after.typeId,
              requiredResolutionKind: "backfill",
            })
          : makeChange(fieldId, "field_added_optional", "safe", {
              toTypeId: after.typeId,
            }),
      );
      continue;
    }
    if (before && !after) {
      changes.push(
        makeChange(fieldId, "field_removed", "requires_resolution", {
          fromTypeId: before.typeId,
          requiredResolutionKind: "drop_confirmed",
        }),
      );
      continue;
    }
    if (!before || !after) continue;

    const compatibility = options.classifyType(before.typeId, after.typeId);
    if (!COMPATIBILITIES.has(compatibility))
      throw new TypeError(
        "type compatibility classifier returned an invalid value",
      );
    if (compatibility === "widening") {
      changes.push(
        makeChange(fieldId, "type_widened", "safe", {
          fromTypeId: before.typeId,
          toTypeId: after.typeId,
        }),
      );
    } else if (compatibility === "narrowing") {
      changes.push(
        makeChange(fieldId, "type_narrowed", "requires_resolution", {
          fromTypeId: before.typeId,
          toTypeId: after.typeId,
          requiredResolutionKind: "transform",
        }),
      );
    } else if (compatibility === "transform_required") {
      changes.push(
        makeChange(fieldId, "type_transform_required", "requires_resolution", {
          fromTypeId: before.typeId,
          toTypeId: after.typeId,
          requiredResolutionKind: "transform",
        }),
      );
    } else if (compatibility === "incompatible") {
      changes.push(
        makeChange(fieldId, "type_incompatible", "blocked", {
          fromTypeId: before.typeId,
          toTypeId: after.typeId,
        }),
      );
    }

    if (before.required && !after.required) {
      changes.push(makeChange(fieldId, "requiredness_relaxed", "safe"));
    } else if (!before.required && after.required) {
      changes.push(
        makeChange(fieldId, "requiredness_tightened", "requires_resolution", {
          requiredResolutionKind: "backfill",
        }),
      );
    }
  }

  changes.sort(
    (left, right) =>
      compareCodePoints(left.fieldId, right.fieldId) ||
      (codeRank.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
        (codeRank.get(right.code) ?? Number.MAX_SAFE_INTEGER),
  );
  const status: PlanStatus = changes.some(
    (change) => change.status === "blocked",
  )
    ? "blocked"
    : changes.some((change) => change.status === "requires_resolution")
      ? "requires_resolution"
      : "safe";
  const fingerprint = digest(
    [
      canonicalSchema(previous.schemaId, previousFields),
      canonicalSchema(next.schemaId, nextFields),
      JSON.stringify(changes),
    ].join("\n"),
  );
  return { schemaId: previous.schemaId, fingerprint, status, changes };
}

export function validateResolutions(
  plan: EvolutionPlan,
  resolutions: readonly EvolutionResolution[],
): ResolutionValidation {
  if (
    !plan ||
    typeof plan !== "object" ||
    !Array.isArray(plan.changes) ||
    !Array.isArray(resolutions)
  ) {
    throw new TypeError("plan and resolutions must use the declared contracts");
  }
  const issues: ResolutionIssue[] = [];
  if (plan.status === "blocked") issues.push({ code: "plan_blocked" });
  const changeById = new Map(
    plan.changes.map((change) => [change.changeId, change]),
  );
  const resolutionById = new Map<string, EvolutionResolution>();
  for (const resolution of resolutions) {
    if (!resolution || typeof resolution.changeId !== "string")
      throw new TypeError("invalid resolution");
    if (resolutionById.has(resolution.changeId)) {
      issues.push({
        code: "duplicate_resolution",
        changeId: resolution.changeId,
      });
      continue;
    }
    resolutionById.set(resolution.changeId, resolution);
    const change = changeById.get(resolution.changeId);
    if (!change) {
      issues.push({ code: "unknown_change", changeId: resolution.changeId });
      continue;
    }
    if (change.requiredResolutionKind !== resolution.kind) {
      issues.push({
        code: "wrong_resolution_kind",
        changeId: resolution.changeId,
      });
      continue;
    }
    if (
      (resolution.kind === "backfill" || resolution.kind === "transform") &&
      !resolution.reference?.trim()
    ) {
      issues.push({ code: "missing_reference", changeId: resolution.changeId });
    }
  }
  for (const change of plan.changes) {
    if (
      change.status === "requires_resolution" &&
      !resolutionById.has(change.changeId)
    ) {
      issues.push({ code: "missing_resolution", changeId: change.changeId });
    }
  }
  issues.sort(
    (left, right) =>
      compareCodePoints(left.changeId ?? "", right.changeId ?? "") ||
      compareCodePoints(left.code, right.code),
  );
  return { ready: plan.status !== "blocked" && issues.length === 0, issues };
}
