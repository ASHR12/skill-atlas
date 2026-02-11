import type { SourceType, TinyFishEvent, TinyFishRunResult } from "@/lib/types";

const TINYFISH_SSE_URL = "https://agent.tinyfish.ai/v1/automation/run-sse";

export interface TinyFishTaskRequest {
  url: string;
  goal: string;
  browser_profile?: "lite" | "stealth";
}

interface TinyFishCallbacks {
  onStep?: (message: string) => Promise<void> | void;
  onStreamingUrl?: (url: string) => Promise<void> | void;
}

function parseSseLine(line: string): TinyFishEvent | null {
  if (!line.startsWith("data:")) {
    return null;
  }

  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(payload) as TinyFishEvent;
  } catch {
    return null;
  }
}

function readStepMessage(event: TinyFishEvent): string {
  return (
    event.purpose ||
    event.action ||
    event.message ||
    event.step ||
    event.description ||
    event.text ||
    event.content ||
    "Processing source..."
  );
}

function readStreamingUrl(event: TinyFishEvent): string | undefined {
  if (typeof event.streamingUrl === "string" && event.streamingUrl.length > 0) {
    return event.streamingUrl;
  }

  const maybeUrl = (event as Record<string, unknown>).url;
  if (typeof maybeUrl === "string" && maybeUrl.startsWith("http")) {
    return maybeUrl;
  }

  return undefined;
}

function isComplete(event: TinyFishEvent): boolean {
  const type = event.type?.toUpperCase();
  const status = event.status?.toUpperCase();
  return type === "COMPLETE" && (!status || status === "COMPLETED" || status === "DONE");
}

function isFailure(event: TinyFishEvent): boolean {
  const type = event.type?.toUpperCase();
  const status = event.status?.toUpperCase();
  return type === "ERROR" || status === "FAILED" || status === "ERROR";
}

export async function runTinyFishTask(
  request: TinyFishTaskRequest,
  apiKey: string,
  callbacks?: TinyFishCallbacks
): Promise<TinyFishRunResult> {
  let streamingUrl: string | undefined;

  try {
    const response = await fetch(TINYFISH_SSE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `TinyFish request failed (${response.status}): ${text}`,
      };
    }

    if (!response.body) {
      return {
        success: false,
        error: "TinyFish response body was empty.",
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseSseLine(line);
        if (!event) {
          continue;
        }

        const maybeStreamingUrl = readStreamingUrl(event);
        if (maybeStreamingUrl) {
          streamingUrl = maybeStreamingUrl;
          await callbacks?.onStreamingUrl?.(maybeStreamingUrl);
        }

        if (event.type?.toUpperCase() === "STEP") {
          await callbacks?.onStep?.(readStepMessage(event));
        }

        if (isComplete(event)) {
          const objectEvent = event as Record<string, unknown>;
          return {
            success: true,
            result:
              event.resultJson ??
              event.result ??
              objectEvent.output ??
              objectEvent.data ??
              null,
            streamingUrl,
          };
        }

        if (isFailure(event)) {
          return {
            success: false,
            error: event.message || "TinyFish reported a failure event.",
            streamingUrl,
          };
        }
      }
    }

    return {
      success: false,
      error: "TinyFish stream ended before a completion event.",
      streamingUrl,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      streamingUrl,
    };
  }
}

export function buildExtractionGoal(topic: string, sourceType: SourceType): string {
  const sourceInstructions: Record<SourceType, string> = {
    docs:
      "Focus on APIs, method signatures, key architecture details, and official recommendations.",
    github:
      "Focus on real developer pain points, issue resolution patterns, and practical workaround snippets.",
    stackoverflow:
      "Focus on question/answer patterns, accepted fixes, and recurring debugging techniques.",
    blog:
      "Focus on practical implementation examples, lessons learned, and actionable best practices.",
  };

  return `You are extracting technical learning material for the topic "${topic}".

SOURCE TYPE: ${sourceType}
${sourceInstructions[sourceType]}

TASK:
Read this page and extract structured JSON covering core ideas and practical usage.

Return ONLY valid JSON with this schema:
{
  "overview": "2-4 sentence summary of what this page teaches about ${topic}",
  "coreConcepts": ["concept 1", "concept 2"],
  "apis": [
    {
      "name": "API or method name",
      "description": "What it does",
      "signature": "function signature or call shape if available"
    }
  ],
  "examples": [
    {
      "title": "Example title",
      "code": "copyable code example",
      "explanation": "why it matters",
      "language": "js/ts/python/etc if known"
    }
  ],
  "commonIssues": [
    {
      "issue": "Common error or gotcha",
      "fix": "How to solve or avoid it"
    }
  ],
  "bestPractices": ["best practice 1", "best practice 2"],
  "resources": [
    {
      "label": "resource name",
      "url": "absolute URL",
      "note": "why this is useful"
    }
  ],
  "rawText": "Optional concise markdown notes from the page"
}

Rules:
- If a field is unavailable, return an empty array or empty string.
- Do not include markdown code fences.
- Keep entries concise but specific.
- Ensure returned JSON is parseable.`;
}
