/** Eight 2,000-character entries: the largest recentContext the chat routes accept. Entry 0 states the goal. Every entry shares terms with the follow-up so the relevance gate keeps it. */
export const MAX_HISTORY_FOR_TEST: string[] = Array.from({ length: 8 }, (_, i) =>
  (i === 0 ? "Please MIGRATE-GOAL the billing service to the new schema. " : `Turn ${i} about the billing migration schema. `)
    .padEnd(2000, `billing migration schema note ${i}. `).slice(0, 2000));
