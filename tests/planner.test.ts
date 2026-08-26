import { describe, expect, test } from "vitest";

import { planEvolution, validateResolutions } from "../src/index.js";
import type { FlatSchema, TypeCompatibility } from "../src/index.js";

const classify = (previous: string, next: string): TypeCompatibility => {
  if (previous === next) return "equal";
  if (previous === "int" && next === "decimal") return "widening";
  if (previous === "decimal" && next === "int") return "narrowing";
  if (previous === "text" && next === "uuid") return "transform_required";
  return "incompatible";
};

const schema = (fields: FlatSchema["fields"]): FlatSchema => ({
  schemaId: "invoice",
  fields,
});

describe("schema evolution planner", () => {
  test("classifies safe additions and requiredness/type changes", () => {
    const previous = schema([
      { id: "amount", typeId: "int", required: true },
      { id: "memo", typeId: "text", required: true },
      { id: "legacy", typeId: "text", required: false },
    ]);
    const next = schema([
      { id: "amount", typeId: "decimal", required: true },
      { id: "memo", typeId: "text", required: false },
      { id: "legacy", typeId: "text", required: true },
      { id: "note", typeId: "text", required: false },
      { id: "owner", typeId: "uuid", required: true },
    ]);
    const plan = planEvolution(previous, next, { classifyType: classify });
    expect(plan.status).toBe("requires_resolution");
    expect(plan.changes.map(({ code, status }) => [code, status])).toEqual([
      ["type_widened", "safe"],
      ["requiredness_tightened", "requires_resolution"],
      ["requiredness_relaxed", "safe"],
      ["field_added_optional", "safe"],
      ["field_added_required", "requires_resolution"],
    ]);
  });

  test("blocks incompatible types and requires transform for narrowing", () => {
    const previous = schema([
      { id: "amount", typeId: "decimal", required: true },
      { id: "owner", typeId: "text", required: true },
      { id: "opaque", typeId: "json", required: false },
    ]);
    const next = schema([
      { id: "amount", typeId: "int", required: true },
      { id: "owner", typeId: "uuid", required: true },
      { id: "opaque", typeId: "binary", required: false },
    ]);
    const plan = planEvolution(previous, next, { classifyType: classify });
    expect(plan.status).toBe("blocked");
    expect(plan.changes.map(({ code, status }) => [code, status])).toEqual([
      ["type_narrowed", "requires_resolution"],
      ["type_incompatible", "blocked"],
      ["type_transform_required", "requires_resolution"],
    ]);
  });

  test("validates exact resolution kind, uniqueness, and complete readiness", () => {
    const plan = planEvolution(
      schema([
        { id: "old", typeId: "text", required: false },
        { id: "amount", typeId: "decimal", required: true },
      ]),
      schema([
        { id: "required", typeId: "text", required: true },
        { id: "amount", typeId: "int", required: true },
      ]),
      { classifyType: classify },
    );
    const required = Object.fromEntries(
      plan.changes.map((change) => [change.code, change.changeId]),
    );
    expect(validateResolutions(plan, [])).toEqual(
      expect.objectContaining({ ready: false }),
    );
    const valid = validateResolutions(plan, [
      { changeId: required.field_removed!, kind: "drop_confirmed" },
      {
        changeId: required.field_added_required!,
        kind: "backfill",
        reference: "backfill-required-v1",
      },
      {
        changeId: required.type_narrowed!,
        kind: "transform",
        reference: "decimal-to-int-v1",
      },
    ]);
    expect(valid).toEqual({ ready: true, issues: [] });
    expect(
      validateResolutions(plan, [
        {
          changeId: required.field_removed!,
          kind: "transform",
          reference: "wrong",
        },
      ]).issues,
    ).toContainEqual(
      expect.objectContaining({ code: "wrong_resolution_kind" }),
    );
    expect(
      validateResolutions(plan, [
        { changeId: required.field_removed!, kind: "drop_confirmed" },
        { changeId: required.field_removed!, kind: "drop_confirmed" },
      ]).issues,
    ).toContainEqual(expect.objectContaining({ code: "duplicate_resolution" }));
  });

  test("fingerprint and change ordering ignore input field order", () => {
    const previous = schema([
      { id: "b", typeId: "text", required: false },
      { id: "a", typeId: "int", required: true },
    ]);
    const next = schema([
      { id: "c", typeId: "text", required: false },
      { id: "a", typeId: "decimal", required: true },
    ]);
    const first = planEvolution(previous, next, { classifyType: classify });
    const second = planEvolution(
      schema([...previous.fields].reverse()),
      schema([...next.fields].reverse()),
      { classifyType: classify },
    );
    expect(second).toEqual(first);
  });

  test("rejects duplicate fields, schema identity drift and invalid classifier output", () => {
    expect(() =>
      planEvolution(
        schema([
          { id: "x", typeId: "text", required: false },
          { id: "x", typeId: "text", required: false },
        ]),
        schema([]),
        { classifyType: classify },
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      planEvolution(
        schema([]),
        { schemaId: "other", fields: [] },
        { classifyType: classify },
      ),
    ).toThrow(/schemaId/);
    expect(() =>
      planEvolution(
        schema([{ id: "x", typeId: "a", required: false }]),
        schema([{ id: "x", typeId: "b", required: false }]),
        { classifyType: () => "mystery" as TypeCompatibility },
      ),
    ).toThrow(/classifier/);
    expect(() =>
      planEvolution(
        { schemaId: null, fields: [] } as unknown as FlatSchema,
        schema([]),
        {
          classifyType: classify,
        },
      ),
    ).toThrow(/schemaId/);
    for (const field of [
      { id: null, typeId: "text", required: false },
      { id: undefined, typeId: "text", required: false },
      { id: "field", typeId: null, required: false },
    ]) {
      expect(() =>
        planEvolution(
          schema([field as unknown as FlatSchema["fields"][number]]),
          schema([]),
          { classifyType: classify },
        ),
      ).toThrow(/invalid field/);
    }
  });
});
