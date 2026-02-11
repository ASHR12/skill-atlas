"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  DiscoveredSource,
  GenerationStats,
  PipelinePhase,
  StreamEvent,
} from "@/lib/types";

type SourceProgress = DiscoveredSource & {
  status: "pending" | "scraping" | "complete" | "error";
  step?: string;
  streamingUrl?: string;
  wordCount?: number;
  error?: string;
};

type GuideHistoryItem = {
  id: string;
  topic: string;
  createdAt: string;
  guide: string;
  sources: DiscoveredSource[];
  stats: GenerationStats;
};

const HISTORY_KEY = "skill_atlas_history_v1";

const SOURCE_COLORS: Record<string, string> = {
  docs: "#818cf8",
  github: "#34d399",
  stackoverflow: "#fb923c",
  blog: "#f472b6",
};

const SOURCE_ICONS: Record<string, string> = {
  docs: "D",
  github: "G",
  stackoverflow: "S",
  blog: "B",
};


function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function phaseLabel(phase: PipelinePhase): string {
  if (phase === "discovering") return "Discovering Sources";
  if (phase === "scraping") return "Scraping Sources";
  if (phase === "synthesizing") return "Synthesizing Guide";
  if (phase === "complete") return "Complete";
  if (phase === "error") return "Error";
  return "Ready";
}

export default function HomePage() {
  const abortRef = useRef<AbortController | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  const [topic, setTopic] = useState("");
  const [maxPerType, setMaxPerType] = useState(2);
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [sources, setSources] = useState<SourceProgress[]>([]);
  const [guideMarkdown, setGuideMarkdown] = useState("");
  const [stats, setStats] = useState<GenerationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GuideHistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [guideTab, setGuideTab] = useState<"preview" | "raw">("preview");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as GuideHistoryItem[];
      if (Array.isArray(parsed)) setHistory(parsed);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase === "synthesizing" && guideRef.current) {
      guideRef.current.scrollTop = guideRef.current.scrollHeight;
    }
  }, [guideMarkdown, phase]);

  const persistHistory = (items: GuideHistoryItem[]) => {
    setHistory(items);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  };

  const appendHistory = (entry: GuideHistoryItem) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((i) => i.id !== entry.id)].slice(0, 20);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  };

  const updateSource = (sourceId: string, patch: Partial<SourceProgress>) => {
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, ...patch } : s))
    );
  };

  const resetForNewRun = () => {
    setError(null);
    setStats(null);
    setGuideMarkdown("");
    setSources([]);
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setStatusMessage("Generation canceled.");
  };

  const runGeneration = async () => {
    const t = topic.trim();
    if (!t) { setError("Topic is required."); return; }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    resetForNewRun();
    setPhase("discovering");
    setStatusMessage("Starting generation...");

    try {
      const res = await fetch("/api/generate-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t, maxPerType }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error("Failed to start generation stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: StreamEvent;
          try { event = JSON.parse(line.slice(6)) as StreamEvent; } catch { continue; }

          if (event.type === "phase") { setPhase(event.phase); setStatusMessage(event.message); }
          else if (event.type === "discovery_complete") {
            setSources(event.sources.map((s) => ({ ...s, status: "pending" })));
          }
          else if (event.type === "source_update") {
            updateSource(event.sourceId, { status: event.status, step: event.step, streamingUrl: event.streamingUrl });
          }
          else if (event.type === "source_complete") {
            updateSource(event.sourceId, { status: "complete", wordCount: event.wordCount });
          }
          else if (event.type === "source_error") {
            updateSource(event.sourceId, { status: "error", error: event.error });
          }
          else if (event.type === "guide_chunk") { setGuideMarkdown((p) => p + event.chunk); }
          else if (event.type === "complete") {
            setGuideMarkdown(event.guide);
            setStats(event.stats);
            setPhase("complete");
            appendHistory({ id: makeId(), topic: t, createdAt: new Date().toISOString(), guide: event.guide, sources: event.sources, stats: event.stats });
          }
          else if (event.type === "error") { setError(event.message); setPhase("error"); }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "Unexpected client error.");
    }
  };

  const isWorking = phase === "discovering" || phase === "scraping" || phase === "synthesizing";

  const copyGuide = async () => {
    if (!guideMarkdown.trim()) return;
    try { await navigator.clipboard.writeText(guideMarkdown); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  };

  const downloadGuide = () => {
    if (!guideMarkdown.trim()) return;
    const blob = new Blob([guideMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic.trim().toLowerCase().replace(/\s+/g, "-") || "skill-guide"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadHistoryItem = (item: GuideHistoryItem) => {
    setTopic(item.topic);
    setGuideMarkdown(item.guide);
    setStats(item.stats);
    setPhase("complete");
    setStatusMessage(`Loaded saved guide for "${item.topic}".`);
    setSources(item.sources.map((s) => ({ ...s, status: "complete" as const })));
  };

  const totals = useMemo(() => ({
    total: sources.length,
    complete: sources.filter((s) => s.status === "complete").length,
    scraping: sources.filter((s) => s.status === "scraping").length,
    error: sources.filter((s) => s.status === "error").length,
  }), [sources]);

  const previewSources = useMemo(
    () => sources.filter((s) => Boolean(s.streamingUrl) && s.status === "scraping"),
    [sources]
  );

  const openAllPreviews = () => {
    const urls = Array.from(new Set(previewSources.map((s) => s.streamingUrl).filter(Boolean)));
    for (const u of urls) window.open(u!, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app">
      {/* ── NAV ── */}
      <nav className="topbar">
        <div className="topbar-left">
          <div className="logo">SA</div>
          <span className="app-name">Skill Atlas</span>
        </div>
        <div className={`pill pill-${phase}`}>
          {isWorking && <span className="dot-pulse" />}
          {phaseLabel(phase)}
        </div>
      </nav>

      {/* ── HERO INPUT ── */}
      <header className="hero-bar">
        <h1>Generate a skill guide for any topic</h1>
        <p>We discover docs, GitHub, Stack Overflow, and blogs -- then scrape them all in parallel and synthesize one guide.</p>
        <div className="hero-input">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Docker, GraphQL, Machine Learning..."
            disabled={isWorking}
            onKeyDown={(e) => { if (e.key === "Enter" && !isWorking && topic.trim()) runGeneration(); }}
          />
          <select value={maxPerType} onChange={(e) => setMaxPerType(Number(e.target.value))} disabled={isWorking}>
            <option value={1}>1 / type</option>
            <option value={2}>2 / type</option>
            <option value={3}>3 / type</option>
          </select>
          <button className="btn-gen" onClick={runGeneration} disabled={isWorking || !topic.trim()}>
            {isWorking ? "Working..." : "Generate"}
          </button>
          {isWorking && <button className="btn-cancel" onClick={cancelGeneration}>Cancel</button>}
        </div>
        {statusMessage && <p className="status-msg">{statusMessage}</p>}
        {error && <p className="error-msg">{error}</p>}
      </header>


      {/* ── LIVE PROGRESS (full width) ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>Live Progress</h2>
          <span className="dim">{totals.complete}/{totals.total || 0} done</span>
        </div>
        {sources.length > 0 ? (
          <div className="src-grid">
            {sources.map((s) => (
              <div key={s.id} className={`src src-${s.status}`}>
                <div className="src-top">
                  <span className="src-icon" style={{ background: SOURCE_COLORS[s.type] || "#818cf8" }}>{SOURCE_ICONS[s.type] || "?"}</span>
                  <div className="src-meta">
                    <strong>{s.title}</strong>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                  </div>
                  <span className={`src-badge src-badge-${s.status}`}>
                    {s.status === "scraping" && <span className="dot-pulse" />}
                    {s.status}
                  </span>
                </div>
                <p className="src-step">{s.error || s.step || (s.status === "complete" && s.wordCount ? `${s.wordCount.toLocaleString()} words extracted` : "Waiting...")}</p>
                {s.streamingUrl && (
                  <a className="src-preview-link" href={s.streamingUrl} target="_blank" rel="noreferrer">Open live preview</a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Sources appear here after discovery.</div>
        )}
      </section>

      {/* ── LIVE PREVIEWS (full width, 3/2/1 col) ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>Live Agent Previews</h2>
          {previewSources.length > 0 && <button className="btn-sm" onClick={openAllPreviews}>Open all in tabs</button>}
        </div>
        {previewSources.length > 0 ? (
          <div className="prev-grid">
            {previewSources.map((s) => (
              <div key={s.id} className="prev-tile">
                <div className="prev-top">
                  <span className="src-icon" style={{ background: SOURCE_COLORS[s.type] || "#818cf8", width: 24, height: 24, fontSize: "0.7rem" }}>{SOURCE_ICONS[s.type]}</span>
                  <strong>{s.title}</strong>
                  <a href={s.streamingUrl} target="_blank" rel="noreferrer" className="prev-ext">open</a>
                </div>
                <iframe src={s.streamingUrl} title={`${s.title} preview`} className="prev-frame" />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Previews appear here as each TinyFish agent starts browsing.</div>
        )}
      </section>

      {/* ── GUIDE + HISTORY (two columns) ── */}
      <section className="bottom-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Generated Guide</h2>
            <div className="tab-row">
              <button className={`tab ${guideTab === "preview" ? "tab-on" : ""}`} onClick={() => setGuideTab("preview")}>Preview</button>
              <button className={`tab ${guideTab === "raw" ? "tab-on" : ""}`} onClick={() => setGuideTab("raw")}>Raw</button>
              <button className="btn-sm" onClick={copyGuide} disabled={!guideMarkdown.trim()}>{copied ? "Copied!" : "Copy"}</button>
              <button className="btn-sm" onClick={downloadGuide} disabled={!guideMarkdown.trim()}>Download</button>
            </div>
          </div>
          {stats && <p className="dim" style={{ marginTop: 4 }}>{stats.generatedWords.toLocaleString()} words from {stats.successCount}/{stats.sourceCount} sources</p>}
          {guideMarkdown.trim() ? (
            <div className="guide-scroll" ref={guideRef}>
              {guideTab === "preview" ? (
                <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{guideMarkdown}</ReactMarkdown></div>
              ) : (
                <pre className="raw-md">{guideMarkdown}</pre>
              )}
            </div>
          ) : (
            <div className="empty">Your guide streams here section by section.</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>History</h2>
            {history.length > 0 && <button className="btn-sm" onClick={() => persistHistory([])}>Clear</button>}
          </div>
          {history.length === 0 ? (
            <div className="empty">Past guides are stored in your browser.</div>
          ) : (
            <div className="hist-list">
              {history.map((h) => (
                <button key={h.id} className="hist" onClick={() => loadHistoryItem(h)}>
                  <strong>{h.topic}</strong>
                  <span>{new Date(h.createdAt).toLocaleDateString()} &middot; {h.stats.generatedWords} words</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
