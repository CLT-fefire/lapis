---
title: Demo vault
doc_kind: reference
topic: getting-started
status: active
tags: [subject/vault]
---

# Demo vault

A small sample vault — 74 notes — so you can see what Lapis does without pointing it
at your own notes. Open this folder with **Open Vault…** and everything below has
something to show.

The note bodies are written in **Korean**. That is deliberate: the full-text index is
built on a Korean bigram tokenizer, and an English-only sample would not demonstrate
the one thing that is hardest to demonstrate. Filenames stay in English kebab-case,
which is what the index is tuned for.

None of this is real documentation. It is sample content shaped to exercise features.

## Things to try

- **Backlinks** — open `search/full-text-search-design.md` and look at the context
  panel (`⌥B`). Eight notes point at it; that reverse list is the primary way to move
  around a vault.
- **Korean full-text search** — press `⌘⇧F` and search for `인덱스` with the
  instrumental particle attached — that is, `인덱스` followed directly by `로`. That
  exact form appears in **no** note, yet 20 notes come back: the bigram index matches
  `인덱스를`, `인덱스가`, and `인덱싱` without needing the particle stripped.
- **Tag tree** — the Tags tab in the sidebar renders `subject/`, `issue/`, `tech/`, and
  `architecture/` as a prefix tree. 23 tags across 4 groups.
- **Code is not a link** — `markdown/code-fence-exclusion.md` contains
  `[[String: Any]]` inside a fenced code block. It stays code; it does not become a
  wikilink.
- **Diagrams** — `search/index-rebuild-strategy.md` and `agent/mcp-server-contract.md`
  render Mermaid, and export to PNG.
- **Cross-reference types** — several notes carry `related:` in their frontmatter, which
  is indexed separately from body links so the relation type survives.
