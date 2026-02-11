import { buildGuideMarkdown, countWords, normalizeExtraction } from "@/lib/guide-builder";
import { discoverSources } from "@/lib/source-discovery";
import { buildExtractionGoal, runTinyFishTask } from "@/lib/tinyfish";
import type { ScrapeResult, ScrapeSuccess, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Read body BEFORE creating the stream (avoids body-consumed race in Next.js)
  const body = (await request.json()) as {
    topic?: string;
    maxPerType?: number;
  };

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  let closed = false;
  let writeQueue = Promise.resolve();

  const sendEvent = async (event: StreamEvent) => {
    if (closed) {
      return;
    }

    writeQueue = writeQueue.then(async () => {
      if (closed) {
        return;
      }
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        closed = true;
      }
    });

    await writeQueue;
  };

  const closeWriter = async () => {
    if (closed) {
      return;
    }

    try {
      await writeQueue;
      closed = true;
      await writer.close();
    } catch {
      closed = true;
    }
  };

  (async () => {
    try {

      const topic = body.topic?.trim() ?? "";
      const maxPerType = Number.isFinite(body.maxPerType)
        ? Math.max(1, Math.min(Number(body.maxPerType), 3))
        : 2;

      if (!topic) {
        await sendEvent({
          type: "error",
          message: "Topic is required.",
        });
        return;
      }

      const apiKey = process.env.TINYFISH_API_KEY;
      if (!apiKey) {
        await sendEvent({
          type: "error",
          message: "TINYFISH_API_KEY is not configured on the server.",
        });
        return;
      }

      await sendEvent({
        type: "phase",
        phase: "discovering",
        message: "Discovering relevant docs, GitHub, Stack Overflow, and blog sources...",
      });

      const discoveredSources = await discoverSources(topic, maxPerType);
      if (discoveredSources.length === 0) {
        throw new Error("No sources were discovered for this topic.");
      }

      await sendEvent({
        type: "discovery_complete",
        sources: discoveredSources,
      });

      await sendEvent({
        type: "phase",
        phase: "scraping",
        message: `Scraping ${discoveredSources.length} sources in parallel with TinyFish...`,
      });

      const scrapeResults = await Promise.all(
        discoveredSources.map(async (source): Promise<ScrapeResult> => {
          await sendEvent({
            type: "source_update",
            sourceId: source.id,
            status: "scraping",
            step: "Launching TinyFish browser agent...",
          });

          const runResult = await runTinyFishTask(
            {
              url: source.url,
              goal: buildExtractionGoal(topic, source.type),
              browser_profile: "lite",
            },
            apiKey,
            {
              onStep: async (message) => {
                await sendEvent({
                  type: "source_update",
                  sourceId: source.id,
                  status: "scraping",
                  step: message,
                });
              },
              onStreamingUrl: async (streamingUrl) => {
                await sendEvent({
                  type: "source_update",
                  sourceId: source.id,
                  status: "scraping",
                  step: "Live browser preview available.",
                  streamingUrl,
                });
              },
            }
          );

          if (!runResult.success || runResult.result === undefined) {
            const message = runResult.error || "TinyFish did not return extracted content.";
            await sendEvent({
              type: "source_error",
              sourceId: source.id,
              error: message,
            });
            return {
              source,
              status: "error",
              error: message,
            };
          }

          const extracted = normalizeExtraction(runResult.result, source);
          const wordCount = countWords(extracted.rawText);

          await sendEvent({
            type: "source_complete",
            sourceId: source.id,
            wordCount,
          });

          return {
            source,
            status: "complete",
            extracted,
            wordCount,
          };
        })
      );

      const successfulScrapes = scrapeResults.filter(
        (result): result is ScrapeSuccess => result.status === "complete"
      );

      if (successfulScrapes.length === 0) {
        throw new Error("Scraping finished, but no source returned usable content.");
      }

      await sendEvent({
        type: "phase",
        phase: "synthesizing",
        message: "Synthesizing a single markdown skill guide...",
      });

      const guide = buildGuideMarkdown(topic, successfulScrapes);
      let streamedGuide = "";
      for (const section of guide.sections) {
        const chunk = `${section}\n`;
        streamedGuide += chunk;
        await sendEvent({
          type: "guide_chunk",
          chunk,
        });
      }

      const finalGuide = streamedGuide.trim();
      await sendEvent({
        type: "phase",
        phase: "complete",
        message: "Guide generation complete.",
      });
      await sendEvent({
        type: "complete",
        guide: finalGuide,
        sources: discoveredSources,
        stats: {
          sourceCount: discoveredSources.length,
          successCount: successfulScrapes.length,
          generatedWords: countWords(finalGuide),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected server error.";
      await sendEvent({
        type: "phase",
        phase: "error",
        message,
      });
      await sendEvent({
        type: "error",
        message,
      });
    } finally {
      await closeWriter();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
