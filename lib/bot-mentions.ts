import type { Bot } from "@/lib/workroom-store";

export type BotMentionQuery = {
  query: string;
  start: number;
};

/**
 * Returns the current slash query only when it starts a mention, rather than a
 * path, URL, or ordinary word. The final slash wins so several bots can be
 * mentioned naturally in one composer value.
 */
export function trailingBotMentionQuery(value: string): BotMentionQuery | null {
  const start = value.lastIndexOf("/");
  if (start < 0) return null;

  const preceding = value[start - 1];
  if (preceding && !/\s/.test(preceding)) return null;

  const query = value.slice(start + 1);
  if (/\r|\n/.test(query) || query.endsWith(" ")) return null;
  return { query, start };
}

export function matchingBotsForMention(
  bots: Bot[],
  value: string,
  limit = 6,
): Bot[] {
  const mention = trailingBotMentionQuery(value);
  if (!mention) return [];
  const query = mention.query.trim().toLocaleLowerCase();
  return bots
    .filter((bot) => !query || bot.name.toLocaleLowerCase().includes(query))
    .slice(0, limit);
}

export function insertBotMention(value: string, _botName: string): string {
  const mention = trailingBotMentionQuery(value);
  if (!mention) return value;
  return value.slice(0, mention.start);
}
