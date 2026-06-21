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

export function summarizeChatHistory(chatHistory: any[], limit: number = 10): Array<{ sender: string; text: string }> {
  return chatHistory.slice(-limit).map((entry: any) => ({
    sender: String(entry?.sender || 'user'),
    text: String(entry?.text || '').slice(0, 1200),
  }));
}
