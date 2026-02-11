import {
  SafeSearchType,
  search,
  type SearchResult,
} from "duck-duck-scrape";
import type { DiscoveredSource, SourceType } from "@/lib/types";

const SOURCE_TYPES: SourceType[] = [
  "docs",
  "github",
  "stackoverflow",
  "blog",
];

const SOURCE_QUERIES: Record<SourceType, string[]> = {
  docs: [
    "{topic} official documentation",
    "{topic} api reference docs",
    "{topic} developer guide documentation",
    "{topic} getting started guide",
  ],
  github: [
    "{topic} site:github.com",
    "{topic} github issues",
    "{topic} github discussions",
    "{topic} github repository",
  ],
  stackoverflow: [
    "{topic} site:stackoverflow.com",
    "{topic} stackoverflow how to",
    "{topic} stackoverflow error",
    "{topic} stackoverflow best practice",
  ],
  blog: [
    "{topic} tutorial blog",
    "{topic} best practices guide",
    "{topic} tutorial dev.to OR medium.com OR hashnode",
    "{topic} deep dive explained",
  ],
};

const KNOWN_BLOG_DOMAINS = [
  "dev.to",
  "medium.com",
  "hashnode.com",
  "freecodecamp.org",
  "digitalocean.com",
  "smashingmagazine.com",
  "css-tricks.com",
  "martinfowler.com",
  "substack.com",
];

function cleanSnippet(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return url;
  }
}

function createSourceId(type: SourceType, url: string, index: number): string {
  const compact = normalizeUrl(url).replace(/[^a-z0-9]/gi, "").slice(-14);
  return `${type}-${index}-${compact}`;
}

function tokenizeTopic(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[\s/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function isDocsResult(result: SearchResult): boolean {
  const hostname = result.hostname.toLowerCase();
  const url = result.url.toLowerCase();
  const docsHints = [
    "docs.",
    "developer.",
    "readthedocs",
    "/docs",
    "/api",
    "/reference",
    "/manual",
    "/guide",
    "/learn",
    "/getting-started",
    "wiki",
  ];

  if (hostname.includes("github.com") || hostname.includes("stackoverflow.com")) {
    return false;
  }

  // Exclude known blog domains from docs
  if (hasAny(hostname, KNOWN_BLOG_DOMAINS) || hostname.includes("blog.")) {
    return false;
  }

  return hasAny(hostname, docsHints) || hasAny(url, docsHints);
}

function isGithubResult(result: SearchResult): boolean {
  return result.hostname.toLowerCase().includes("github.com");
}

function isStackOverflowResult(result: SearchResult): boolean {
  const hostname = result.hostname.toLowerCase();
  return hostname.includes("stackoverflow.com") || hostname.includes("stackexchange.com");
}

function isBlogResult(result: SearchResult): boolean {
  const hostname = result.hostname.toLowerCase();
  const url = result.url.toLowerCase();

  if (hostname.includes("github.com") || hostname.includes("stackoverflow.com")) {
    return false;
  }

  return (
    hasAny(hostname, KNOWN_BLOG_DOMAINS) ||
    hostname.includes("blog.") ||
    url.includes("/blog/") ||
    url.includes("/tutorial") ||
    url.includes("/guide") ||
    url.includes("/post/") ||
    url.includes("/article")
  );
}

function matchesType(result: SearchResult, type: SourceType): boolean {
  if (type === "docs") return isDocsResult(result);
  if (type === "github") return isGithubResult(result);
  if (type === "stackoverflow") return isStackOverflowResult(result);
  return isBlogResult(result);
}

function scoreResult(
  result: SearchResult,
  type: SourceType,
  topicTokens: string[]
): number {
  const title = result.title.toLowerCase();
  const description = result.rawDescription.toLowerCase();
  const url = result.url.toLowerCase();
  let score = 0;

  for (const token of topicTokens) {
    if (title.includes(token)) score += 2;
    if (description.includes(token)) score += 1;
    if (url.includes(token)) score += 1;
  }

  if (type === "docs") {
    if (url.includes("/docs")) score += 2;
    if (url.includes("/reference")) score += 2;
  }

  if (type === "github") {
    if (url.includes("/discussions")) score += 2;
    if (url.includes("/issues")) score += 2;
    if (url.includes("/wiki")) score += 1;
  }

  if (type === "stackoverflow") {
    if (url.includes("/questions/")) score += 3;
  }

  if (type === "blog") {
    if (url.includes("/tutorial")) score += 2;
    if (url.includes("/guide")) score += 1;
  }

  return score;
}

function defaultFallbacks(topic: string, type: SourceType): DiscoveredSource[] {
  const encoded = encodeURIComponent(topic);
  const make = (url: string, title: string, i: number): DiscoveredSource => ({
    id: createSourceId(type, url, i),
    type,
    title,
    url,
    reason: `Fallback ${type} source for ${topic}.`,
    query: `${topic} ${type}`,
  });

  if (type === "docs") {
    return [
      make(`https://www.google.com/search?q=${encoded}+official+documentation`, `${topic} documentation search`, 0),
      make(`https://www.google.com/search?q=${encoded}+api+reference+docs`, `${topic} API reference`, 1),
      make(`https://www.google.com/search?q=${encoded}+getting+started+guide`, `${topic} getting started`, 2),
    ];
  }

  if (type === "github") {
    return [
      make(`https://github.com/search?q=${encoded}&type=repositories`, `${topic} GitHub repos`, 0),
      make(`https://github.com/search?q=${encoded}&type=discussions`, `${topic} GitHub discussions`, 1),
      make(`https://github.com/search?q=${encoded}&type=issues`, `${topic} GitHub issues`, 2),
    ];
  }

  if (type === "stackoverflow") {
    return [
      make(`https://stackoverflow.com/search?q=${encoded}`, `${topic} Stack Overflow search`, 0),
      make(`https://stackoverflow.com/search?q=${encoded}+error`, `${topic} SO common errors`, 1),
      make(`https://stackoverflow.com/search?q=${encoded}+best+practice`, `${topic} SO best practices`, 2),
    ];
  }

  return [
    make(`https://dev.to/search?q=${encoded}`, `${topic} dev.to articles`, 0),
    make(`https://medium.com/search?q=${encoded}`, `${topic} Medium articles`, 1),
    make(`https://www.google.com/search?q=${encoded}+tutorial+blog`, `${topic} tutorial search`, 2),
  ];
}

async function discoverByType(
  topic: string,
  type: SourceType,
  maxPerType: number
): Promise<DiscoveredSource[]> {
  const topicTokens = tokenizeTopic(topic);
  const queries = SOURCE_QUERIES[type].map((template) =>
    template.replaceAll("{topic}", topic)
  );

  const selected: DiscoveredSource[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    try {
      const response = await search(query, {
        safeSearch: SafeSearchType.MODERATE,
        locale: "en-us",
      });

      const ranked = response.results
        .filter((result) => matchesType(result, type))
        .map((result) => ({
          result,
          score: scoreResult(result, type, topicTokens) + 1, // base score so type-matched results always qualify
        }))
        .sort((left, right) => right.score - left.score);

      for (const entry of ranked) {
        const normalizedUrl = normalizeUrl(entry.result.url);
        if (seen.has(normalizedUrl)) {
          continue;
        }

        seen.add(normalizedUrl);
        selected.push({
          id: createSourceId(type, normalizedUrl, selected.length),
          type,
          title: entry.result.title.trim(),
          url: normalizedUrl,
          reason: cleanSnippet(entry.result.description || entry.result.rawDescription),
          query,
        });

        if (selected.length >= maxPerType) {
          return selected;
        }
      }
    } catch {
      // Discovery can still continue from other queries and fallback sources.
      continue;
    }
  }

  if (selected.length < maxPerType) {
    const fallbacks = defaultFallbacks(topic, type);
    for (const fallback of fallbacks) {
      if (!seen.has(fallback.url)) {
        selected.push(fallback);
      }
      if (selected.length >= maxPerType) {
        break;
      }
    }
  }

  return selected.slice(0, maxPerType);
}

export async function discoverSources(
  topic: string,
  maxPerType = 2
): Promise<DiscoveredSource[]> {
  const limit = Math.max(1, Math.min(maxPerType, 3));
  const results = await Promise.all(
    SOURCE_TYPES.map((type) => discoverByType(topic, type, limit))
  );

  const flattened = results.flat();
  const deduped = new Map<string, DiscoveredSource>();
  for (const source of flattened) {
    if (!deduped.has(source.url)) {
      deduped.set(source.url, source);
    }
  }

  return Array.from(deduped.values());
}
