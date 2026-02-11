# Skill Atlas

Generate comprehensive skill guides for any technical topic. Skill Atlas discovers relevant sources across documentation, GitHub, Stack Overflow, and technical blogs, scrapes them all in parallel using [TinyFish](https://tinyfish.ai) web agents, and synthesizes a single markdown guide.

## How It Works

```
Topic Input
    │
    ▼
┌─────────────────────────────┐
│  1. Source Discovery        │  DuckDuckGo search to find
│     (docs, github, SO, blog)│  real URLs per source type
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  2. Parallel Scraping       │  TinyFish browser agents
│     (all sources at once)   │  extract structured JSON
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  3. Guide Synthesis         │  Merge all extractions into
│     (markdown output)       │  one organized skill guide
└─────────────────────────────┘
```

### Source Types

| Type | What it finds | What it extracts |
|------|--------------|-----------------|
| **Documentation** | Official docs, API references | APIs, method signatures, canonical usage |
| **GitHub** | Issues, discussions, repos | Bugs, fixes, edge cases, workarounds |
| **Stack Overflow** | Q&A threads | Debugging patterns, accepted solutions |
| **Technical Blogs** | Tutorials, deep dives | Implementation examples, best practices |

### Output Sections

The generated guide includes:
- **Overview** - What the topic is about
- **Core Concepts** - Key ideas, API surface, best practices
- **Practical Examples** - Code snippets from real sources
- **Common Gotchas** - Real issues and fixes from GitHub/SO
- **Resources** - Links to all scraped sources

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **TinyFish API** - Browser automation for parallel scraping
- **DuckDuckGo** - Source discovery (via `duck-duck-scrape`)
- **react-markdown** + **remark-gfm** - Markdown rendering

## Prerequisites

- **Node.js 18+**
- **npm**
- A **TinyFish API key** - [Get one here](https://tinyfish.ai)

## Setup

1. **Clone the repository:**

```bash
git clone https://github.com/ASHR12/skill-atlas.git
cd skill-atlas
```

2. **Install dependencies:**

```bash
npm install
```

3. **Create your environment file:**

```bash
cp .env.local.example .env.local
```

4. **Add your TinyFish API key** to `.env.local`:

```
TINYFISH_API_KEY=sk-tinyfish-your-key-here
```

5. **Start the development server:**

```bash
npm run dev
```

6. **Open** [http://localhost:3000](http://localhost:3000)

## Usage

1. Type any technical topic (e.g. "Docker", "GraphQL", "Gemini API")
2. Choose how many sources per type (1-3)
3. Click **Generate**
4. Watch live progress as TinyFish agents scrape each source in parallel
5. View the generated markdown guide (Preview or Raw)
6. Copy or download the guide
7. Past guides are saved in browser history for quick access

## Project Structure

```
skill-atlas/
├── app/
│   ├── api/
│   │   └── generate-guide/
│   │       └── route.ts        # SSE streaming pipeline endpoint
│   ├── globals.css              # Full app styles
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Main UI (input, progress, guide, history)
├── lib/
│   ├── guide-builder.ts         # Extraction normalization + markdown synthesis
│   ├── source-discovery.ts      # DuckDuckGo source discovery
│   ├── tinyfish.ts              # TinyFish SSE client + extraction prompts
│   └── types.ts                 # Shared TypeScript types
├── .env.local.example           # Example environment variables
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TINYFISH_API_KEY` | Yes | Your TinyFish API key for browser automation |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## License

MIT
