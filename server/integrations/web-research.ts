export type PublicWebResult = {
  title: string;
  url: string;
  snippet?: string;
};

type DuckDuckGoTopic = {
  FirstURL?: unknown;
  Text?: unknown;
  Topics?: DuckDuckGoTopic[];
};

type DuckDuckGoResponse = {
  AbstractText?: unknown;
  AbstractURL?: unknown;
  Heading?: unknown;
  RelatedTopics?: DuckDuckGoTopic[];
};

const MAX_RESULTS = 4;
const QUERY_LIMIT = 240;

function isSafePublicUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return false;
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^0\./.test(host) ||
      /^\[?(::1|fc|fd)/i.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function titleFromTopic(topic: DuckDuckGoTopic) {
  if (typeof topic.Text !== "string") return null;
  const separator = topic.Text.indexOf(" - ");
  return (separator >= 0 ? topic.Text.slice(0, separator) : topic.Text).trim();
}

function flattenTopics(topics: DuckDuckGoTopic[] = []): DuckDuckGoTopic[] {
  return topics.flatMap((topic) => [topic, ...flattenTopics(topic.Topics)]);
}

/**
 * Looks up a short public result list with a fixed provider endpoint. The app
 * never opens arbitrary returned URLs on the server; returned links are shown
 * to the user as search results they may choose to open themselves.
 */
export async function searchPublicWeb(
  query: string,
): Promise<PublicWebResult[]> {
  const cleanQuery = query.replace(/\s+/g, " ").trim().slice(0, QUERY_LIMIT);
  if (!cleanQuery) return [];

  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return [];

    const payload = (await response.json()) as DuckDuckGoResponse;
    const candidates: PublicWebResult[] = [];
    if (isSafePublicUrl(payload.AbstractURL)) {
      candidates.push({
        title:
          typeof payload.Heading === "string" && payload.Heading.trim()
            ? payload.Heading.trim()
            : new URL(payload.AbstractURL).hostname,
        url: payload.AbstractURL,
        snippet:
          typeof payload.AbstractText === "string"
            ? payload.AbstractText.slice(0, 260)
            : undefined,
      });
    }

    for (const topic of flattenTopics(payload.RelatedTopics)) {
      if (!isSafePublicUrl(topic.FirstURL) || candidates.length >= MAX_RESULTS)
        continue;
      const title = titleFromTopic(topic) || new URL(topic.FirstURL).hostname;
      candidates.push({
        title,
        url: topic.FirstURL,
        snippet:
          typeof topic.Text === "string" ? topic.Text.slice(0, 260) : undefined,
      });
    }

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    });
  } catch {
    return [];
  }
}
