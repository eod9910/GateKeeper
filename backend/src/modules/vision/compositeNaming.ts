export function suggestCompositeName(stages: Array<{ pattern_id: string }>, intent: string): string {
  const ids = stages.map((stage) => stage.pattern_id);
  if (ids.includes('rdp_swing_structure') && ids.includes('fib_location_primitive')) {
    return `RDP Fib Pullback ${capitalizeIntent(intent)} Composite`;
  }
  if (ids.includes('regime_filter')) {
    return `Regime Filtered ${capitalizeIntent(intent)} Composite`;
  }
  return `${capitalizeIntent(intent)} Composite`;
}

export function capitalizeIntent(intent: string): string {
  const value = String(intent || 'entry').trim().toLowerCase();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Entry';
}

export function normalizeCompositeId(value: string): string {
  let patternId = String(value || 'new_composite')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!patternId) patternId = 'new_composite';
  if (!patternId.endsWith('_composite')) patternId += '_composite';
  return patternId;
}

export function buildCompositeStageId(role: string, existingIds: string[]): string {
  const roleMap: Record<string, string> = {
    anchor_structure: 'structure',
    location: 'location',
    location_filter: 'location',
    timing_trigger: 'timing',
    trigger: 'timing',
    context: 'context',
    state_filter: 'filter',
    regime_state: 'regime',
    structure_filter: 'structure_filter',
  };
  const base = roleMap[String(role || '').trim()] || 'stage';
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}
