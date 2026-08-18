# Lapis

> A personal knowledge workbench for navigating local Markdown through **backlinks, tags, and full-text search** — native macOS

[한국어](README.md) · **English**

![release](https://img.shields.io/github/v/release/eren0315/lapis?label=release&color=1f6feb)
![platform](https://img.shields.io/badge/platform-macOS_11%2B_(Apple_Silicon)-black)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-blue)

Lapis is a desktop app tuned for **reading and finding** things in a Markdown pile you already have. It is not a tool for writing new notes — it is a tool for following the connections between thousands to tens of thousands of documents.

Your files live only on your local filesystem. No accounts, no cloud sync, no telemetry. All the app does is read `.md` files, build indexes, and — when asked — write atomically.

> ⚠️ **I built this for my own use.** It is shaped around how I work (mostly reading and browsing), and it has no QA and no beta testers. **There will be bugs**, and paths I don't personally exercise are only shallowly verified. You're welcome to use it (MIT), but **please back up notes that matter, or keep them under git.**

**Three things that make it different**

- **Reading is the default** — the first thing you see is a rendered preview; the editor comes out only when you ask for it with `⌘E`.
- **Built for Korean search from the start** — BM25 ranking over a Korean bigram index, so terms match even with particles and inflectional endings attached.
- **An index an agent can use** — the search index the app builds is exposed through an MCP server, so Claude Code can query the same vault.

---

## Features

### Reading-first workflow

- **One toggle, `⌘E`** — preview (markdown-it) ↔ editor (CodeMirror 6). Not two modes; one toggle.
- **Adjustable measure** — 40–88em via the Aa popover, narrowing long documents to a comfortable column width.
- **Your reading position carries over** — move between editor and preview and you stay in the section you were reading.
- **Outline** (`⌘⇧O`) — jump within a document through its heading list.
- **Context panel** (`⌥B`) — keeps frontmatter properties and backlinks beside the body.
- **Themes** — light / dark / follow system.

### Connections between documents

- **Wikilinks** — jump with `[[Note name]]`. `[[...]]` inside fenced code blocks and inline code is **not** treated as a link (e.g. `[[String: Any]]` is code, not a link).
- **Backlinks panel** — every document pointing at this one. Reverse references are the primary way to navigate.
- **Frontmatter cross-refs** — `related`, `amends`, and `superseded_by` are indexed separately, **preserving the relation type**. "The document that corrected this one" doesn't get mixed in with "merely related".
- **Automatic link updates** — rename a file and references to it are followed and fixed, after a **dry-run preview** and a **backup**.

### Search — three layers

| Layer | Shortcut | Engine | When to use |
|---|---|---|---|
| Filename fuzzy | `⌘P` | in-house fuzzy | you roughly know the filename |
| Full-text | `⌘⇧F` | MiniSearch (BM25 + Korean bigram) | you're searching by content |
| Within document | `⌘F` | regex · case · whole word | inside the note you have open |

The full-text index is built in a **Web Worker** and **cached to disk per shard**, so restarting the app doesn't re-read everything from scratch.

### Tags

- **Only frontmatter `tags:`** is indexed. Inline hashtags in the body are deliberately ignored — there's no reliable way to tell them apart from `#define` in code or a URL fragment like `#section`.
- **Nested kebab-case** — build a hierarchy with `/`, as in `tech/svelte5` or `issue/atomic-write`, and the sidebar renders it as a prefix tree.
- Click a tag to narrow the view to its documents.

### Tabs and windows

- `⌘T` new tab · `⌘P` replaces the active tab · `⌘W` close · `⌘1`–`⌘9` select
- `⌘,` / `⌘.` (or `⌘←` / `⌘→`) walk back and forward through visit history
- **`⌘⇧T` opens a new window — each window can hold a different vault.** Useful for keeping personal notes and project docs side by side.

### Getting content out

- **Mermaid** code blocks render (colors adapt to the theme) and export to **PNG**
- **Self-contained HTML export** — a single `.html` with styles inlined, so it looks the same wherever you open it
- **Copy as rich text** — paste into a wiki, an email, or a messenger and formatting survives
- **Reveal in Finder** — open the current note's location directly
- **Vault git version control** — if your vault is a git repository, the app works with its changes

---

## Installation

1. Download the latest `Lapis_x.y.z_aarch64.dmg` from [Releases](https://github.com/eren0315/lapis/releases). (**Apple Silicon** · macOS 11+)
2. Open the dmg and drag `Lapis.app` into `/Applications`.
3. **On first launch only** you need to confirm opening it. The build is signed with a Developer ID but **is not notarized**:
   - macOS 14 and earlier — right-click `Lapis.app` → **Open** → **Open**
   - macOS 15 and later — after trying to launch it, go to System Settings → Privacy & Security → **"Open Anyway"**

> No Intel Mac binary is published. Build from source if you need one (see [Development](#development)).

## Getting started

1. Use **Open Vault…** at the top of the left sidebar to pick a folder containing `.md` files. An empty folder is fine.
2. The first index build runs. It creates links, tags, and full-text in one pass — a few seconds at around 1,000 notes. It **does not block the file tree**, so you can open documents while it works.
3. `⌘P` finds files by name, `⌘⇧F` by content.
4. Write `[[Another note]]` in any note, then check that note's **Backlinks** to see the reverse reference appear.
5. For everything else, `⌘K` — every command lives in the Command Palette.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` | Command Palette — search every command |
| `⌘P` | Quick File Open (filename fuzzy) — replaces the active tab |
| `⌘⇧F` / `⌘⇧P` | Full-text search |
| `⌘F` | Find within the current note |
| `⌘E` | Toggle read ↔ edit |
| `⌘⇧E` | Focus the file tree filter |
| `⌘N` | New note |
| `⌘S` | Save now (autosaves every 2s while editing) |
| `F2` | Rename the current note |
| `⌘⌫` | Move the current note to Trash |
| `⌘T` | New tab |
| `⌘⇧T` | New window (a different vault per window) |
| `⌘W` | Close tab |
| `⌘1`–`⌘9` | Switch to that tab |
| `⌘,` / `⌘.` | Visit history back / forward |
| `⌘←` / `⌘→` | Visit history back / forward |
| `⌘B` | Collapse/expand the sidebar |
| `⌥B` | Collapse/expand the context panel |
| `⌘⇧O` | Outline |
| `⌘⇧C` | Copy the current note's path |

> On Mac Magic Keyboards `F2` is screen brightness by default. Use `Fn+F2`, or turn on "Use F1, F2, etc. keys as standard function keys" in Keyboard settings. Otherwise `⌘K` → "Rename".

---

## Language

The interface is available in **English and Korean**. By default it **follows your OS language**, falling back to English when that language is not supported. Pick System / 한국어 / English under Settings → **Language**.

The Welcome sample note created in an empty vault is written in whatever language is active at the time. Files that already exist are left alone when you switch languages.

## Claude Code integration — knowledge query MCP

The search index Lapis builds is exposed through an MCP server. There is exactly **one** tool (`lapis_query`).

```json
{
  "mcpServers": {
    "lapis": { "command": "/absolute/path/to/lapis/mcp/lapis-mcp" }
  }
}
```

It answers structural queries (`doc_kind`, `topic`, `tag`, `backlinks_of`) and BM25 full-text in a single call. No LLM, no API key — the same arguments produce the same result.

> ⚠️ **Queries are blocked by default.** Turn them on in the app under **Settings → MCP query → Allow**.
> That switch only governs **whether queries are answered**. `lapis-mcp` is a stdio server, so the
> process itself is spawned by the Claude client — to stop it from starting at all, remove the
> `lapis` entry from `mcpServers` above.

**Honest limitations** (measured on a vault of 19,000+ documents):

- **It does not replace grep.** grep has higher recall (100% on AND search vs R@10 89.4%). What this tool adds is **ranking**.
- **Reference tracing (`backlinks_of`) is the one decisive win.** A question that cost grep 3 calls, 15.9 KB, and 3 false positives is answered in 1 call, 1.6 KB, 0 false positives.
- **The app is the index producer.** The MCP server only reads the cache. If the vault is newer than the cache the response carries a `stale` field, but it **does not block** — a hard failure is itself a judgment, and this server doesn't make judgments.

The contract, error kinds, and measurements are in [`mcp/README.md`](mcp/README.md).

---

## Design principles

| Principle | Implementation |
|---|---|
| **Local only** | There is no networking code. No accounts, no sync, no telemetry. |
| **Never a partial write** | Saving is `temp file → POSIX rename` — written in the same directory, then swapped in atomically. On failure the temp file is cleaned up. |
| **No path escape** | The vault root is canonicalized and checked with `starts_with`; extensions are restricted by whitelist. |
| **One index producer only** | Two scanners always drift apart. Wikilink, Markdown-link, and frontmatter extraction live only in Rust, and the MCP server reads what they produce. |
| **Minimal dependencies** | The Rust side stays close to `std::fs` and `std::path`. |

## Tech stack

| Area | Stack |
|---|---|
| App | Tauri 2 (macOS desktop, Apple Silicon) |
| Frontend | SvelteKit 2 + Svelte 5 (runes) + TypeScript 5 + Vite 6 |
| Backend | Rust (`std::fs`/`std::path`-centric, minimal external crates) |
| Editor | CodeMirror 6 |
| Markdown | markdown-it 14 + js-yaml + a custom wikilink rule + highlight.js |
| Search | MiniSearch (BM25 + Korean bigram, Web Worker + shard disk cache) |
| Diagrams | Mermaid |
| MCP | Node (no SDK dependency, bundled with esbuild at call time) |
| Tests | Vitest |

> Search originally ran on tantivy + lindera. That stack was **removed** in v1.3.0 in favor of MiniSearch.

## Project layout

```text
lapis/
├── src/                     # SvelteKit frontend
│   ├── lib/
│   │   ├── stores/          # writable stores per domain (vault, editor, tags, …)
│   │   ├── tauri/           # typed wrappers for Rust commands
│   │   ├── keymap.ts        # global shortcut matching (callers perform the effect)
│   │   ├── searchIndex.ts   # fuzzy + MiniSearch full-text
│   │   ├── linkIndex.ts     # wikilink/md-link resolver + backlinks
│   │   └── *.svelte         # Sidebar · Editor · SearchModal · CommandPalette …
│   ├── app.css              # design tokens (single source of truth for theming)
│   └── routes/+page.svelte  # the workspace
├── src-tauri/               # Rust backend (Tauri host)
│   └── src/
│       ├── vault.rs         # list/read/write_note · scan_links · read_vault_bundle
│       ├── search_cache.rs  # full-text index disk cache (meta + shards)
│       └── paths.rs         # app data paths (dev / release split)
├── mcp/                     # knowledge query MCP server + search quality harness
└── static/
```

## Development

**Requirements** — Node LTS, Rust stable (the version Tauri 2 requires), Xcode Command Line Tools.

```bash
npm install
npm run tauri dev
```

Checks:

```bash
npm run check                  # frontend type check (svelte-check)
npm run check:mcp              # MCP type check (the root check only covers src/)
npm run test                   # Vitest
cd src-tauri && cargo check    # Rust type check
```

Builds:

```bash
npm run tauri build                                    # dmg (host architecture)
npm run tauri build -- --target universal-apple-darwin # universal binary
```

> ⚠️ **Dev builds and the installed app use separate app data directories** (`com.lapis.dev-dev` vs `com.lapis.dev`). They used to share one, so the two builds kept overwriting each other's search cache and re-indexing. → `src-tauri/src/paths.rs`

## Troubleshooting

**The app won't open / "unidentified developer"**
The build isn't notarized. Follow step 3 of [Installation](#installation).

**No search results**
The first index build may still be running — the same reason tags and backlinks can look empty. Give a large vault a moment.

**I wrote `#tag` in the body and it isn't picked up**
That's intended. Only frontmatter `tags:` is indexed.

**The MCP server doesn't show up in my client**
Clients launch servers with a minimal environment, so a homebrew node may not be found. The wrapper probes candidate paths, but if yours lives somewhere unusual, point at it with `LAPIS_NODE`. See [`mcp/README.md`](mcp/README.md).

**MCP responses come back with `stale`**
The vault is newer than the cache. A running app's watcher refreshes it, but **commits take 10–20 seconds**. A handful of entries usually doesn't affect results; hundreds mean the app wasn't running.

## Contributing

This is a tool built for my own convenience, so the roadmap follows how I use it. Features I don't use are low priority, and I may not be able to take a request even after hearing it.

Bug reports are genuinely **welcome**, though — they're the only way I learn where things break on paths I never walk. Please include reproduction steps and your macOS version in [Issues](https://github.com/eren0315/lapis/issues). If you plan to send a PR, open an issue first so we can agree on direction.

## License

MIT
