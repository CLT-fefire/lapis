# Changelog

**English** · [한국어](CHANGELOG.ko.md)

Version history for Lapis. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
trimmed down for a one-person project. Versioning follows [Semantic Versioning](https://semver.org/) loosely.

> **No binaries are published.** Nothing is attached to GitHub Releases — only tags are pushed.
> Build from source as described in [the README's install section](README.md#installation).

> **⚠️ History rewrite notice (2026-08-18)** — the whole history was rewritten with `git filter-repo`
> when the repository moved to a personal account. **Every commit SHA before v1.10.0 changed.** Tags were
> updated to point at the new SHAs, but old SHA references in external documents and PR pages no longer resolve.

---

## [1.13.0] — 2026-08-24

### Changed
- **Changing one note no longer re-reads the whole vault on startup** ([#192]). The cache key was a
  single hash over every file's `(path, mtime, size)`, so one edited note invalidated all of it. On the
  author's vault that meant re-reading **52.6 MB** of note bodies and re-indexing for **~5.3 s** —
  triggered, in practice, by 38 changed files out of 19,364 (0.2%). Because the vault is written by
  other tools rather than by Lapis, most launches took that path: something changed on 19 of the last
  30 days. Startup now compares a per-file stat snapshot against the previous one and, when few files
  moved, repairs only those — the same incremental machinery the file watcher already used. A full
  rebuild still happens when the change set is large, when the shard count would change, or when the
  snapshot is missing or does not match. The snapshot lives in its own file (231 KB gzipped, +1.6% of
  the cache) rather than in the metadata read on every launch, so an unchanged vault costs nothing extra.

### Fixed
- **Search result snippets could show a note's YAML header instead of the matching text** ([#191]).
  Ranking finds Korean text by character bigrams, but the snippet extractor only looked for the query
  typed verbatim. When a word carried a different particle — searching `인덱스로` against a note
  reading `인덱스를` — nothing matched and the fallback printed the first 120 characters, which by
  convention is the frontmatter block. The result was a search hit that could not show why it matched.
  Snippets now try the raw words first and then the same bigrams ranking uses, and never start inside
  frontmatter.
- **Switching vaults could leak the previous vault's notes into search results** ([#191]). Opening a
  vault cleared the link index but left the full-text worker loaded. Shards are only reset for the ones
  the new vault writes, and the shard count follows note count — so going from a large vault (8 shards)
  to a small one (1 shard) left shards 1–7 in memory, and every ready shard answers queries.
- **Five code fence languages rendered without any highlighting** ([#193]). Measured across the whole
  vault: `svelte` (18 fences), `dart` (15), `ruby` (7), `http` (4), and `objective-c` (2). The first
  three had no language registered; the last two were spelling variants no registered alias covered.
  `svelte` maps to the XML grammar, which still colors markup and the contents of `<script>`/`<style>`.

## [1.12.2] — 2026-08-24

### Fixed
- **Tables blew out sideways, while the columns that would have fit folded to one character per line**
  ([#189]). Inline code carried no line-breaking rule, so a long path without spaces
  (`dontalk/…/Foo.swift:1234`, or a brace shorthand like `A/{B,C,D}`) stayed a single unbreakable chunk.
  In a paragraph it pushed the whole pane sideways; in a table it inflated that column's minimum width,
  and the automatic table layout squeezed whatever was left over to the other columns — Korean breaks
  between any two characters, so the squeeze showed up as **one character per line** in a cell 545px tall.
  Inline code now wraps with `overflow-wrap: anywhere`, the one value that also lowers the minimum width
  (`break-word` does not, and would have left the table alone). Code blocks are excluded and still scroll
  horizontally, and exported HTML picks up the same rule. Measured on the author's vault: 321 of 1,301
  notes (24.7%) carry an inline code token longer than 60 characters with no space in it.

## [1.12.1] — 2026-08-21

### Fixed
- **A broken diagram left a "Syntax error in text" graphic stuck on screen** ([#187]). Mermaid draws
  its own error graphic into a temporary `div` it appends to `document.body`, and on a parse failure it
  throws without removing it. So the bomb icon floated at the bottom of the window, survived every note
  switch, and only went away when the app restarted — the note on screen did not even need to contain a
  diagram, because the wreckage came from some earlier note. Mermaid's error rendering is now suppressed
  and the temporary nodes are cleaned up; the failure is reported inline, where the broken block is.

## [1.12.0] — 2026-08-21

### Fixed
- **Editing a property could wipe a note's entire frontmatter** ([#184]). When the YAML failed to parse,
  the app read it as "no properties at all" and rewrote the block with only the key you just edited —
  everything else was gone. It now refuses the write and tells you to fix the YAML in the editor first.
  Measured on the author's vault: 1 note out of 19,213 is in exactly that state today.
- **Dates were rewritten on every property edit** ([#184]). `created: 2026-08-13` came back as
  `2026-08-13T00:00:00.000Z`, because js-yaml's default schema turns timestamps into `Date` objects.
  Reading and writing now both use the CORE schema, so dates stay text. The same bug leaked into the
  UI, where the properties panel showed `Thu Aug 20 2026 09:00:00 GMT+0900`.
- **The blank line between frontmatter and body vanished** on every property edit ([#184]) — the
  separator pattern swallowed the newline. Automatic link updates shared the same splitter and the
  same bug.

### Added
- **The search measurement harness now gates cost, not just quality** ([#182]). `lapis-eval` reports
  p50/p95/max latency next to R@1/R@10/MRR, adds a long-query probe (16 and 32 words — the quality
  cases can never produce one), and exits non-zero when a latency budget is exceeded. A previous
  change passed every quality metric while being four times slower; that was caught by hand.
- **`lapis-bench`** ([#182]) — index build cost: milliseconds per 1,000 notes, growth ratio from n/2 to
  n (to catch superlinear regressions), and **JSON bytes per note**. The size metric is the primary
  gate: it is deterministic, so a 15% margin is enough, while a wall-clock budget loose enough to
  survive a busy machine cannot detect a tokenizer regression at all.
- **42 tests for the frontmatter parser** ([#184]), which had none, and one more for effect dependency
  registration through a helper call ([#185]).

### Changed
- **Preview post-processing effects were rewritten** ([#185]). Five `$effect`s declared their
  dependency by assigning to a variable they never used (`const _html = parsed.html`); the pattern
  breaks silently if a guard moves in front of it. They now call a named `trackPreviewHtml()`, and the
  repeated "null check → `tick()` → null check again → post-process" sequence moved into one helper.
  No behavior change — verified by hand across wikilink colors, mermaid, theme switching, and `⌘F`.

## [1.11.0] — 2026-08-20

### Added
- **CI** — `.github/workflows/ci.yml`. On pull requests and pushes to `main`, it runs `svelte-check`,
  the MCP type check, vitest, and the vite build on Ubuntu, plus `cargo fmt --check`, `cargo clippy`
  (warnings as errors), `cargo check`, and `cargo test` on macOS.
- **`CHANGELOG.md`** — this file. With GitHub Releases unused, it stands in for release notes.
- **A test project for DOM and reactivity** (`*.dom.test.ts`), alongside the existing node one. Preview
  post-processing and Svelte effect timing can now be tested without mounting a component. It carries a
  canary: without `resolve.conditions: ["browser"]` vitest compiles for SSR, `$effect` becomes a no-op,
  and every reactivity test passes vacuously — the canary fails loudly instead.
- **`⌘⇧F` full-text search now offers the structural arm too** — matching tags and `doc_kind`/`topic`
  facets appear below the content hits. This alternative existed only in `⌘K` before.
  It was meant to help short queries, and measurement says it does not: the structural vocabulary is
  English (4 of 4,643 distinct tags contain Hangul, 5 of 299 topics, none of the 23 doc kinds), while
  the queries that score badly are Korean. They cannot meet. What this actually helps is queries
  written in the vocabulary's own language. Short Korean queries remain unsolved, and the answer is
  not here.
- **Window position and size survive a restart.** Every window remembers its own geometry, keyed by
  label, so a second window reopens where the last one was. If the monitor it was on is gone, the
  window falls back to a default position instead of restoring off-screen.

### Changed
- **Full-text combination now degrades in four steps instead of two.** It was AND-then-OR: if a single
  query word was missing from the target, AND returned nothing and the whole query fell back to OR,
  matching **10,346 documents on average** — 53% of the corpus. Typing a half-remembered title is not an
  edge case, and that was the worst path. Two stages now fill the gap: `AND-1` (drop one word, AND the
  rest) and `OR-min` (OR results filtered by matched-term count). Measured on 19,292 notes / 360 cases,
  queries carrying one bogus word went from **10,346 matches to 220 (−98%)** with R@1 **67.2% → 68.9%**.
  Clean queries are byte-for-byte unchanged — the new stages are only reachable when AND finds nothing.
  `AND-1` is capped at 8 words because it is O(n²): uncapped it scored 1.1pt higher but ran 4× slower
  (118ms average against 29ms before, and 860ms on a 32-word query).
- The MCP response field `used[].combine` gained two values, `AND-1` and `OR-min`. See `mcp/README.md`.
- Install instructions moved from a Releases download to building from source. Binary distribution stopped.
- **English is now the primary language for published documents.** `README.md` and `CHANGELOG.md` are the
  English originals; Korean lives in `README.ko.md` and `CHANGELOG.ko.md`. The former `README.en.md`
  became `README.md`.

### Fixed
- `mcp/lapis-eval` silently ignored its sample-size argument — the wrapper did not forward `"$@"`, so
  every run used the default. Two measurements were compared under different case counts before this
  surfaced.
- The release badge in the README was dead — with every release deleted, `github/v/release` had nothing
  to resolve. Replaced with a tag-based `github/v/tag`.

---

## [1.10.0] — 2026-08-19

UI localization and an MCP query toggle. Moving the repository to a personal account brought along
a round of cleanup for public consumption.

### Added
- **UI localization (ko/en)** — built on Paraglide JS 2. English is the source language and Korean is the
  translation. It follows the OS language by default and can be overridden in settings. 309 messages ([#171])
- **MCP query toggle** — turn the `lapis_query` tool on and off from app settings. **Blocked by default**,
  and the gate sits on `tools/call` rather than `tools/list`, so it takes effect without a restart ([#170])
- MIT LICENSE ([#166]), an English README and a language switcher ([#168])

### Fixed
- The properties autocomplete dropdown was clipped instead of escaping the context panel ([#169])
- The MCP wrapper depended on `PATH`, so the server never started under Claude Desktop ([#163])
- Partial settings writes — saving only some fields reset the rest to their defaults. The symptom stayed
  hidden while there was only one field ([#170])

### Docs
- README rewritten, repository URLs updated ([#165]), personal-tool disclaimer added ([#167])
- Corrected the search stack — the README had long claimed "tantivy + lindera", but that stack was removed
  in v1.3.0 ([#161], [#164])
- Added an MCP usage guide ([#162])

---

## [1.9.0] — 2026-08-13

Opened the knowledge vault up to queries from Claude Code, and cleared out several cache faults that had
been failing silently along the way.

### Added
- **`lapis_query` MCP server** — serves full-text and structural queries (backlinks, topic, tag, doc_kind)
  over the index the app builds. It exposes exactly one tool ([#156])
- Start editing where you were reading — the section anchor carries across the read/edit switch ([#154])

### Changed
- Full-text combination switched to AND-first with an OR fallback. Measurement showed the bottleneck was
  the combination strategy, not the tokenizer ([#159])

### Fixed
- Six faults where cache meta and shards drifted apart ([#155])
- Edits did not refresh the on-disk cache — a duplicated gate at the call site ([#158])
- Development and release builds shared an app data directory; they are now separate ([#157])

---

## [1.8.0] — 2026-08-11

Per-window vaults and a single read/edit toggle. The dormant graph code was removed.

### Added
- **A different vault per window** — watcher refcounting plus per-window event routing
- `⌘T` opens a new tab; `⌘P` now replaces the active tab
- Click the topbar path label to copy the absolute path

### Changed
- **Removed the Editor/Preview split in favor of a single read↔edit toggle**
- Editor loads lazily — startup payload 1089 KB → 543 KB
- Shortcut matching extracted to `keymap.ts` (27 tests); the welcome document to `welcomeDoc.ts`
- Removed the dormant graph feature (3,135 lines)

### Fixed
- New windows opened the previous vault — the per-window key is now evaluated lazily

---

## [1.7.0] — 2026-08-06

### Added
- Reading typography pass — adjustable measure, heading hierarchy, paragraph spacing ([#144])
- Debug build markers — window title and a topbar badge ([#146])

### Fixed
- The pane toolbar's ⋯ menu wrapped one character per line (a v1.6.0 regression) ([#145])

---

## [1.6.0] — 2026-08-05

A full UI overhaul. The shell layout borrows from chat apps (Discord): a left icon rail and a right
context panel.

### Added
- Design tokens — three surface layers, larger radii, two density steps ([#130])
- A permanent left icon rail with active-section indication ([#132]), and a new right context panel ([#133])
- Vault header dropdown and a bottom status bar ([#139]), rail tooltips ([#138])
- **Unread markers for notes that changed while you were away** ([#140])
- Enter/exit motion for overlays ([#137]); tab chip and category collapse motion ([#141])

### Changed
- Removed hard borders in favor of the three surface layers ([#131]); new accent color ([#135])
- Fresh installs default to a collapsed Editor; slimmer topbar ([#134])
- Items rendered as chips, rail pill morphing, uppercase categories ([#136])

### Fixed
- Outline entries clipped at the bottom; section badges capped at 9999+ ([#142])

---

## [1.5.0] — 2026-08-03

### Added
- Reveal in Finder — from the file tree, tabs, and both panes ([#127])
- Export the preview as a self-contained HTML file ([#128])
- A ⋯ overflow menu on the pane toolbar ([#126])

---

## [1.4.0] — 2026-06-22

Search quality and responsiveness.

### Added
- **Initial-consonant search in the Quick Switcher** — Korean jamo matching ([#119])
- **A Korean bigram tokenizer for full-text** — recall for compounds and inflections ([#120])
- Force index rebuild in settings — ignore the cache, reset the worker, rebuild everything ([#123])

### Changed
- Debounced palette search with lazily generated snippets ([#121])
- Quick Switcher normalization cache and progressive filtering ([#122])
- Git auto-commit now `add`s only changed paths, avoiding a full working-tree scan ([#118])

---

## [1.3.0] — 2026-06-18

### Removed
- **The entire claude-mem integration** ([#117]). **The tantivy + lindera morphological search engine went
  with it** — search has been a single MiniSearch stack ever since. The README failed to reflect this for
  a long time and was only corrected in v1.10.0.

---

## [1.2.2] — 2026-06-18

### Changed
- Graph feature temporarily disabled pending a 3D redesign ([#114])
- Watcher reindexing moved to the background, so live changes no longer block the sidebar ([#113])

### Fixed
- The mirror sync indicator got stuck on "syncing" forever — a listener re-registration race ([#115])

---

## [1.2.1] — 2026-06-18

### Fixed
- **A UTF-8 character boundary panic in `strip_md_extension`** — an immediate crash after release.
  Replaced with byte-slice comparison ([#110])
- Index build spinner freeze; the watcher missing the search index ([#111], [#112])

### Added
- Incremental indexing and a `.mmd` watcher ([#112])

---

## [1.2.0] — 2026-06-15

Version control the vault with git.

### Added
- A git version-control backend for the vault — shell-out commands ([#104])
- Auto-commit plus a banner for starting version control ([#105])
- Git history viewer — a "History" section in Neighborhood ([#106])
- A settings entry point for git version control, reachable after dismissing the banner ([#107])

### Fixed
- Git commands blocked the IPC thread and froze the UI for 30 seconds — async + `spawn_blocking` ([#108])

---

## [1.1.0] — 2026-06-11

### Added
- On-demand betweenness with a "bridge notes" toggle ([#97]); undirected conversion and a weighting toggle ([#101])
- Disparity filter backbone mode ([#98])
- A global `doc_kind` type filter for the graph ([#100])
- MOC suggestion diagnostics — MOC candidates, bridge notes, orphan notes ([#102])
- Drag-resizable expanded sidebar sections ([#99])

---

## [1.0.0] — 2026-06-08

A document-level knowledge graph and a restructured sidebar.

### Added
- Frontmatter type relation index and the Neighborhood panel ([#92])
- Field lens grouping in the Files tab ([#93])
- Document-level knowledge graph — data model and Local/ego mode ([#94]), Global mode and encoding ([#95])
- Vertical accordion sidebar navigation with an icon rail ([#96])

> The graph feature was disabled in v1.2.2 and its code removed in v1.8.0. It is not in the app today.

---

## [0.12.1] — 2026-06-05

### Fixed
- Tab context-menu actions like "Close other tabs" did nothing ([#90])

---

## [0.12.0] — 2026-06-04

### Added
- Persisted note tabs, restored per vault ([#85])
- Drag to reorder tabs; "close other tabs" from the context menu ([#86])
- Preview font size (zoom) control ([#87])

### Fixed
- Backlink cache now invalidates immediately on in-app rename, delete, and move ([#88])

---

## [0.11.0] — 2026-06-04

A note navigation bundle.

### Added
- **Wikilink autocomplete (`[[`)** — a CodeMirror completion dropdown ([#79])
- Note back/forward navigation ([#80]) and a history dropdown ([#81])
- **Note tabs (multiple open notes)** ([#82])
- A favorites/pins sidebar tab with recent notes ([#83])

---

## [0.10.0] — 2026-06-02

### Added
- Document outline (TOC) panel, synced both ways with the editor and preview ([#73])
- Word/character count and reading time in the topbar ([#72])
- An entry point for adding Properties even when frontmatter is empty ([#77])

### Changed
- Spacing tokenized — exact-match px values replaced with `--sp-*` ([#74])
- A `ModalShell` primitive and normalized z-index tokens ([#75])
- Automatic link updating now identifies code regions via an AST (markdown-it) instead of regex ([#76])
- Icon buttons unified under `.btn--icon` ([#77])

---

## [0.9.1] — 2026-06-01

### Fixed
- Mermaid PNG export — worked around WKWebView canvas tainting (blob → data URL) ([#71])

---

## [0.9.0] — 2026-06-01

### Added
- Syntax highlighting for preview code blocks — highlight.js wired to the `--cm-*` tokens ([#68])

### Changed
- **A full design system overhaul** — tokens plus a three-way theme (light/dark/system) ([#64])
- Normalized sizes and shapes; a button primitive ([#67])

### Fixed
- Mermaid diagram legibility in light mode — theme-adaptive rendering ([#66])

---

## [0.8.0] — 2026-05-29

### Added
- Mermaid diagram PNG export — atomic save from a hover button ([#62])

---

## [0.7.0] — 2026-05-27

### Added
- Collapsible sidebar — `⌘B`, a header button, and a collapsed strip ([#60])

---

## [0.6.0] — 2026-05-21

A performance bundle for large vaults.

### Changed
- Removed search cold init; added an LRU cache and a release profile ([#49])
- Vault cold-start bundle — `read_vault_bundle` on rayon ([#50])
- MiniSearch disk cache ([#51]); gzipped cache and lazy `fullTextIndex` loading ([#52])
- Split cache meta and JSON IPC; moved MiniSearch into a Web Worker ([#53])
- Virtualized the file tree ([#55])
- Sharded progressive loading of the search index — partial search 1.8s in, after the first shard ([#56]),
  with the shard count scaled to vault size ([#57])

### Added
- Copy the current note's absolute path; filter the sidebar tree by search ([#54])

---

## [0.5.1] — 2026-05-19

### Added
- Backup `max_keep` exposed in settings (1–100) ([#47])

### Removed
- The graph view, removed entirely — ADR-001 ([#45])

---

## [0.5.0] — 2026-05-18

### Added
- Dry-run preview for automatic link updating, with `.lapis` snapshot backups ([#42])
- Backup pruning (max 20) and automatic rollback on write failure ([#43])
- In-document search options — regex, case, whole word ([#39])
- vitest adopted, with golden tests for linkRewrite ([#41])

---

## [0.4.0] — 2026-05-14

### Added
- F2 rename and `⌘⌫` delete, Properties add, backlink invalidation ([#34])
- An F2 fallback in the Command Palette plus a note about Mac Magic Keyboards ([#35])
- Support for standalone `.mmd` files ([#36])

---

## [0.3.0] — 2026-05-14

### Added
- Export claude-mem session summaries into the vault; memory FTS search and a related-memory panel
- A `lapis-mem.db` mirror and a live sync engine
- The tantivy + lindera Korean morphological search engine
- The claude-mem integration made optional, off by default ([#30])

> Everything in this section was **removed in v1.3.0**.

---

## [0.2.0] — 2026-05-12

The first tag. Everything from Phase 0 through 5.0 landed here.

### Added
- Tauri 2 + SvelteKit + TypeScript scaffolding; a CodeMirror 6 + markdown-it + frontmatter proof of concept
- Open a vault, file tree, scroll sync
- Wikilinks, a backlinks panel, and safe link navigation
- Quick Switcher (`⌘P`), full-text search (`⌘⇧F`), a tag index, and Files/Tags sidebar tabs
- Editing and saving (`⌘S` + autosave) with **atomic writes**
- Frontmatter four-key schema recognition, hierarchical nested tags, `doc_kind`/`topic` facet filters
- A file watcher — external changes detected automatically, with conflict handling
- Vault operations (create, delete, rename, move) with automatic link updating
- The `⌘K` command palette; expandable backlink chips with context snippets
- Inline frontmatter editing, inline Mermaid code block rendering, relative image paths and a published-asset gallery
- In-document search — `⌘F` in each of the editor and preview

<!-- link references -->

[Unreleased]: https://github.com/eren0315/lapis/compare/v1.12.1...main
[1.13.0]: https://github.com/eren0315/lapis/compare/v1.12.2...v1.13.0
[1.12.2]: https://github.com/eren0315/lapis/compare/v1.12.1...v1.12.2
[1.12.1]: https://github.com/eren0315/lapis/compare/v1.12.0...v1.12.1
[1.12.0]: https://github.com/eren0315/lapis/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/eren0315/lapis/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/eren0315/lapis/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/eren0315/lapis/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/eren0315/lapis/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/eren0315/lapis/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/eren0315/lapis/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/eren0315/lapis/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/eren0315/lapis/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/eren0315/lapis/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/eren0315/lapis/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/eren0315/lapis/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/eren0315/lapis/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/eren0315/lapis/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/eren0315/lapis/compare/v0.12.1...v1.0.0
[0.12.1]: https://github.com/eren0315/lapis/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/eren0315/lapis/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/eren0315/lapis/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/eren0315/lapis/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/eren0315/lapis/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/eren0315/lapis/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/eren0315/lapis/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/eren0315/lapis/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/eren0315/lapis/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/eren0315/lapis/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/eren0315/lapis/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/eren0315/lapis/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/eren0315/lapis/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eren0315/lapis/releases/tag/v0.2.0

[#193]: https://github.com/eren0315/lapis/pull/193
[#192]: https://github.com/eren0315/lapis/pull/192
[#191]: https://github.com/eren0315/lapis/pull/191
[#189]: https://github.com/eren0315/lapis/pull/189
[#187]: https://github.com/eren0315/lapis/pull/187
[#185]: https://github.com/eren0315/lapis/pull/185
[#184]: https://github.com/eren0315/lapis/pull/184
[#182]: https://github.com/eren0315/lapis/pull/182
[#171]: https://github.com/eren0315/lapis/pull/171
[#170]: https://github.com/eren0315/lapis/pull/170
[#169]: https://github.com/eren0315/lapis/pull/169
[#168]: https://github.com/eren0315/lapis/pull/168
[#167]: https://github.com/eren0315/lapis/pull/167
[#166]: https://github.com/eren0315/lapis/pull/166
[#165]: https://github.com/eren0315/lapis/pull/165
[#164]: https://github.com/eren0315/lapis/pull/164
[#163]: https://github.com/eren0315/lapis/pull/163
[#162]: https://github.com/eren0315/lapis/pull/162
[#161]: https://github.com/eren0315/lapis/pull/161
[#159]: https://github.com/eren0315/lapis/pull/159
[#158]: https://github.com/eren0315/lapis/pull/158
[#157]: https://github.com/eren0315/lapis/pull/157
[#156]: https://github.com/eren0315/lapis/pull/156
[#155]: https://github.com/eren0315/lapis/pull/155
[#154]: https://github.com/eren0315/lapis/pull/154
[#146]: https://github.com/eren0315/lapis/pull/146
[#145]: https://github.com/eren0315/lapis/pull/145
[#144]: https://github.com/eren0315/lapis/pull/144
[#142]: https://github.com/eren0315/lapis/pull/142
[#141]: https://github.com/eren0315/lapis/pull/141
[#140]: https://github.com/eren0315/lapis/pull/140
[#139]: https://github.com/eren0315/lapis/pull/139
[#138]: https://github.com/eren0315/lapis/pull/138
[#137]: https://github.com/eren0315/lapis/pull/137
[#136]: https://github.com/eren0315/lapis/pull/136
[#135]: https://github.com/eren0315/lapis/pull/135
[#134]: https://github.com/eren0315/lapis/pull/134
[#133]: https://github.com/eren0315/lapis/pull/133
[#132]: https://github.com/eren0315/lapis/pull/132
[#131]: https://github.com/eren0315/lapis/pull/131
[#130]: https://github.com/eren0315/lapis/pull/130
[#128]: https://github.com/eren0315/lapis/pull/128
[#127]: https://github.com/eren0315/lapis/pull/127
[#126]: https://github.com/eren0315/lapis/pull/126
[#123]: https://github.com/eren0315/lapis/pull/123
[#122]: https://github.com/eren0315/lapis/pull/122
[#121]: https://github.com/eren0315/lapis/pull/121
[#120]: https://github.com/eren0315/lapis/pull/120
[#119]: https://github.com/eren0315/lapis/pull/119
[#118]: https://github.com/eren0315/lapis/pull/118
[#117]: https://github.com/eren0315/lapis/pull/117
[#115]: https://github.com/eren0315/lapis/pull/115
[#114]: https://github.com/eren0315/lapis/pull/114
[#113]: https://github.com/eren0315/lapis/pull/113
[#112]: https://github.com/eren0315/lapis/pull/112
[#111]: https://github.com/eren0315/lapis/pull/111
[#110]: https://github.com/eren0315/lapis/pull/110
[#108]: https://github.com/eren0315/lapis/pull/108
[#107]: https://github.com/eren0315/lapis/pull/107
[#106]: https://github.com/eren0315/lapis/pull/106
[#105]: https://github.com/eren0315/lapis/pull/105
[#104]: https://github.com/eren0315/lapis/pull/104
[#102]: https://github.com/eren0315/lapis/pull/102
[#101]: https://github.com/eren0315/lapis/pull/101
[#100]: https://github.com/eren0315/lapis/pull/100
[#99]: https://github.com/eren0315/lapis/pull/99
[#98]: https://github.com/eren0315/lapis/pull/98
[#97]: https://github.com/eren0315/lapis/pull/97
[#96]: https://github.com/eren0315/lapis/pull/96
[#95]: https://github.com/eren0315/lapis/pull/95
[#94]: https://github.com/eren0315/lapis/pull/94
[#93]: https://github.com/eren0315/lapis/pull/93
[#92]: https://github.com/eren0315/lapis/pull/92
[#90]: https://github.com/eren0315/lapis/pull/90
[#88]: https://github.com/eren0315/lapis/pull/88
[#87]: https://github.com/eren0315/lapis/pull/87
[#86]: https://github.com/eren0315/lapis/pull/86
[#85]: https://github.com/eren0315/lapis/pull/85
[#83]: https://github.com/eren0315/lapis/pull/83
[#82]: https://github.com/eren0315/lapis/pull/82
[#81]: https://github.com/eren0315/lapis/pull/81
[#80]: https://github.com/eren0315/lapis/pull/80
[#79]: https://github.com/eren0315/lapis/pull/79
[#77]: https://github.com/eren0315/lapis/pull/77
[#76]: https://github.com/eren0315/lapis/pull/76
[#75]: https://github.com/eren0315/lapis/pull/75
[#74]: https://github.com/eren0315/lapis/pull/74
[#73]: https://github.com/eren0315/lapis/pull/73
[#72]: https://github.com/eren0315/lapis/pull/72
[#71]: https://github.com/eren0315/lapis/pull/71
[#68]: https://github.com/eren0315/lapis/pull/68
[#67]: https://github.com/eren0315/lapis/pull/67
[#66]: https://github.com/eren0315/lapis/pull/66
[#64]: https://github.com/eren0315/lapis/pull/64
[#62]: https://github.com/eren0315/lapis/pull/62
[#60]: https://github.com/eren0315/lapis/pull/60
[#57]: https://github.com/eren0315/lapis/pull/57
[#56]: https://github.com/eren0315/lapis/pull/56
[#55]: https://github.com/eren0315/lapis/pull/55
[#54]: https://github.com/eren0315/lapis/pull/54
[#53]: https://github.com/eren0315/lapis/pull/53
[#52]: https://github.com/eren0315/lapis/pull/52
[#51]: https://github.com/eren0315/lapis/pull/51
[#50]: https://github.com/eren0315/lapis/pull/50
[#49]: https://github.com/eren0315/lapis/pull/49
[#47]: https://github.com/eren0315/lapis/pull/47
[#45]: https://github.com/eren0315/lapis/pull/45
[#43]: https://github.com/eren0315/lapis/pull/43
[#42]: https://github.com/eren0315/lapis/pull/42
[#41]: https://github.com/eren0315/lapis/pull/41
[#39]: https://github.com/eren0315/lapis/pull/39
[#36]: https://github.com/eren0315/lapis/pull/36
[#35]: https://github.com/eren0315/lapis/pull/35
[#34]: https://github.com/eren0315/lapis/pull/34
[#30]: https://github.com/eren0315/lapis/pull/30
