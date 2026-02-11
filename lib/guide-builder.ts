import type {
  ApiReference,
  CommonIssue,
  DiscoveredSource,
  GuideBuildResult,
  PracticalExample,
  ResourceLink,
  ScrapeSuccess,
  StructuredExtraction,
} from "@/lib/types";

function stripCodeFence(input: string): string {
  let text = input.trim();

  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }

  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }

  return text.trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function parseMaybeObject(input: unknown): Record<string, unknown> | null {
  if (typeof input === "object" && input !== null) {
    return input as Record<string, unknown>;
  }

  if (typeof input === "string") {
    const cleaned = stripCodeFence(input);
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function toStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const values: string[] = [];
  for (const entry of input) {
    if (typeof entry === "string" && entry.trim()) {
      values.push(entry.trim());
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const candidate = firstString(
        obj.title,
        obj.name,
        obj.value,
        obj.text,
        obj.description
      );
      if (candidate) {
        values.push(candidate);
      }
    }
  }

  return values;
}

function toApiList(input: unknown): ApiReference[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const apis: ApiReference[] = [];

  for (const entry of input) {
    if (typeof entry === "string" && entry.trim()) {
      apis.push({
        name: entry.trim(),
        description: "Referenced API from source content.",
      });
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const name = firstString(obj.name, obj.method, obj.api, obj.function);
      const description = firstString(
        obj.description,
        obj.explanation,
        obj.purpose,
        obj.detail
      );

      if (name) {
        apis.push({
          name,
          description: description || "No description provided in source.",
          signature: firstString(obj.signature, obj.syntax, obj.example),
        });
      }
    }
  }

  return apis;
}

function toExampleList(input: unknown): PracticalExample[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const examples: PracticalExample[] = [];
  for (const entry of input) {
    if (typeof entry === "string" && entry.trim()) {
      examples.push({
        title: "Example",
        code: entry.trim(),
      });
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const code = firstString(obj.code, obj.snippet, obj.example, obj.content);
      if (!code) {
        continue;
      }

      examples.push({
        title: firstString(obj.title, obj.name) || "Example",
        code,
        explanation: firstString(
          obj.explanation,
          obj.why,
          obj.context,
          obj.description
        ),
        language: firstString(obj.language, obj.lang),
      });
    }
  }

  return examples;
}

function toIssueList(input: unknown): CommonIssue[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const issues: CommonIssue[] = [];
  for (const entry of input) {
    if (typeof entry === "string" && entry.trim()) {
      issues.push({
        issue: entry.trim(),
        fix: "Validate context and use the accepted solution from source discussions.",
      });
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const issue = firstString(
        obj.issue,
        obj.problem,
        obj.title,
        obj.error,
        obj.mistake
      );
      if (!issue) {
        continue;
      }

      issues.push({
        issue,
        fix:
          firstString(obj.fix, obj.solution, obj.resolution, obj.answer) ||
          "Review the thread for the accepted fix and adjust implementation details.",
      });
    }
  }

  return issues;
}

function toResourceList(input: unknown): ResourceLink[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const resources: ResourceLink[] = [];
  for (const entry of input) {
    if (typeof entry === "string" && entry.startsWith("http")) {
      resources.push({
        label: entry,
        url: entry,
      });
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const url = firstString(obj.url, obj.link, obj.href);
      if (!url.startsWith("http")) {
        continue;
      }
      resources.push({
        label: firstString(obj.label, obj.title, obj.name) || url,
        url,
        note: firstString(obj.note, obj.reason, obj.description),
      });
    }
  }

  return resources;
}

function deriveOverview(rawText: string): string {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) {
    return "No high-level overview could be extracted from this source.";
  }
  return text.slice(0, 360);
}

function uniqueByLowerCase(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function uniqueResources(values: ResourceLink[], max: number): ResourceLink[] {
  const seen = new Set<string>();
  const out: ResourceLink[] = [];
  for (const value of values) {
    const key = value.url.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function extractRawText(obj: Record<string, unknown>, fallback: unknown): string {
  return firstString(
    obj.rawText,
    obj.content,
    obj.body,
    obj.markdown,
    obj.notes,
    typeof fallback === "string" ? fallback : ""
  );
}

export function normalizeExtraction(
  raw: unknown,
  source: DiscoveredSource
): StructuredExtraction {
  const parsed = parseMaybeObject(raw);
  if (!parsed) {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    return {
      overview: deriveOverview(text),
      coreConcepts: [],
      apis: [],
      examples: [],
      commonIssues: [],
      bestPractices: [],
      resources: [{ label: source.title, url: source.url, note: source.reason }],
      rawText: text,
    };
  }

  const rawText = extractRawText(parsed, raw);
  const overview = firstString(parsed.overview, parsed.summary, parsed.intro);

  return {
    overview: overview || deriveOverview(rawText),
    coreConcepts: uniqueByLowerCase(
      [
        ...toStringList(parsed.coreConcepts),
        ...toStringList(parsed.keyPoints),
      ],
      20
    ),
    apis: toApiList(parsed.apis || parsed.apiMethods || parsed.methods),
    examples: toExampleList(parsed.examples || parsed.codeExamples),
    commonIssues: toIssueList(
      parsed.commonIssues || parsed.issues || parsed.gotchas || parsed.commonMistakes
    ),
    bestPractices: uniqueByLowerCase(
      [
        ...toStringList(parsed.bestPractices),
        ...toStringList(parsed.tips),
      ],
      20
    ),
    resources: uniqueResources(
      [
        ...toResourceList(parsed.resources || parsed.links),
        { label: source.title, url: source.url, note: source.reason },
      ],
      20
    ),
    rawText,
  };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString();
}

function renderOverview(results: ScrapeSuccess[]): string {
  const overviewLines = uniqueByLowerCase(
    results.map((item) => item.extracted.overview).filter(Boolean),
    4
  );

  if (overviewLines.length === 0) {
    return "No reliable overview was extracted from the selected sources.";
  }

  return overviewLines.map((line) => `- ${line}`).join("\n");
}

function renderCoreConcepts(results: ScrapeSuccess[]): string {
  const concepts = uniqueByLowerCase(
    results.flatMap((item) => item.extracted.coreConcepts),
    14
  );
  const bestPractices = uniqueByLowerCase(
    results.flatMap((item) => item.extracted.bestPractices),
    10
  );
  const apis = results.flatMap((item) =>
    item.extracted.apis.map((api) => ({ ...api, source: item.source.title }))
  );

  let section = "";
  if (concepts.length > 0) {
    section += concepts.map((concept) => `- ${concept}`).join("\n");
  } else {
    section += "- No explicit concept list found; review examples and resources for details.";
  }

  if (apis.length > 0) {
    section += "\n\n### API Surface\n\n";
    section += "| API | Description | Signature |\n";
    section += "| --- | --- | --- |\n";
    for (const api of apis.slice(0, 14)) {
      section += `| ${api.name} | ${api.description} _(from ${api.source})_ | ${
        api.signature ? `\`${api.signature}\`` : "n/a"
      } |\n`;
    }
  }

  if (bestPractices.length > 0) {
    section += "\n\n### Best Practices\n\n";
    section += bestPractices.map((tip) => `- ${tip}`).join("\n");
  }

  return section;
}

function renderExamples(results: ScrapeSuccess[]): string {
  const examples = results.flatMap((item) =>
    item.extracted.examples.map((example) => ({
      ...example,
      sourceTitle: item.source.title,
    }))
  );

  if (examples.length === 0) {
    return "No standalone code examples were extracted. Use the resources section to inspect original examples.";
  }

  return examples
    .slice(0, 8)
    .map((example, index) => {
      const language = example.language || "text";
      const explanation = example.explanation
        ? `\n${example.explanation}`
        : "\nSource included code without additional explanation.";
      return `### Example ${index + 1}: ${example.title}\n\n\`\`\`${language}\n${
        example.code
      }\n\`\`\`\n${explanation}\n\n_Source: ${example.sourceTitle}_`;
    })
    .join("\n\n");
}

function renderGotchas(results: ScrapeSuccess[]): string {
  const issues = results.flatMap((item) => item.extracted.commonIssues);

  if (issues.length === 0) {
    return "- No explicit gotchas were extracted; check linked GitHub and Stack Overflow sources for troubleshooting context.";
  }

  return issues
    .slice(0, 12)
    .map((item) => `- **${item.issue}**\n  - Fix: ${item.fix}`)
    .join("\n");
}

function renderResources(results: ScrapeSuccess[]): string {
  const resources = uniqueResources(
    results.flatMap((item) => item.extracted.resources),
    40
  );

  return resources.map((resource) => {
    const note = resource.note ? ` - ${resource.note}` : "";
    return `- [${resource.label}](${resource.url})${note}`;
  }).join("\n");
}

export function buildGuideMarkdown(
  topic: string,
  results: ScrapeSuccess[]
): GuideBuildResult {
  const generatedAt = new Date().toISOString();

  const header = `# ${topic} Skill Guide

Generated: ${formatDate(generatedAt)}
Sources scraped successfully: ${results.length}
`;

  const sections = [
    `${header}\n`,
    `## Overview\n\n${renderOverview(results)}\n`,
    `## Core Concepts\n\n${renderCoreConcepts(results)}\n`,
    `## Practical Examples\n\n${renderExamples(results)}\n`,
    `## Common Gotchas\n\n${renderGotchas(results)}\n`,
    `## Resources\n\n${renderResources(results)}\n`,
  ];

  return {
    markdown: sections.join("\n"),
    sections,
  };
}
