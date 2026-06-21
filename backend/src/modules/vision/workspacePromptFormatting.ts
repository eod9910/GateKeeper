export function summarizePrimitiveInventory(primitives: any[], limit: number = 30): any[] {
  return primitives.slice(0, limit).map((primitive: any) => ({
    pattern_id: primitive?.pattern_id ?? null,
    name: primitive?.name ?? null,
    indicator_role: primitive?.indicator_role ?? null,
    description: primitive?.description ?? null,
    tunable_params: Array.isArray(primitive?.tunable_params)
      ? primitive.tunable_params.slice(0, 8).map((param: any) => ({
          key: param?.key ?? null,
          type: param?.type ?? null,
          default: param?.default ?? null,
        }))
      : [],
  }));
}
