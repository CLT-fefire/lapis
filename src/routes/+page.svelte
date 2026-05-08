<script lang="ts">
  import Editor from "$lib/Editor.svelte";
  import { parseNote } from "$lib/markdown";

  const SAMPLE = `---
title: Lapis Phase 0 PoC
date: 2026-05-08
tags: [phase-0, poc, codemirror, markdown-it, tauri]
status: in-progress
priority: P0
author: 정철화
---

# Lapis Phase 0 — PoC 동작 확인

이 화면이 보인다면 **3개 PoC가 동시에 작동하는 것**입니다:

1. **Tauri 2** 데스크톱 앱 컨테이너가 SvelteKit을 호스팅
2. **CodeMirror 6** 에디터가 좌측에서 마크다운을 편집
3. **markdown-it + js-yaml** 파서가 우측에 실시간 렌더링과 frontmatter Properties를 표시

## 다음 시도해볼 것

- [ ] 좌측 에디터에서 frontmatter의 \`status\` 값을 \`done\`으로 바꿔보기 (Properties 패널이 즉시 갱신)
- [ ] \`tags\` 배열에 항목 추가
- [ ] 본문에 wikilink 작성: \`[[다른-노트]]\` (Phase 1에서 인식·점프 구현)
- [ ] 코드 블록 시도:

\`\`\`rust
fn main() {
    println!("Lapis가 살아 있다");
}
\`\`\`

## 인용문 / 표 테스트

> "당장 적용하지 않아도 사용하는 데 전혀 문제가 없는 게 내 바이브 코딩 셋팅이니까."

| 영역 | 라이브러리 | 상태 |
|---|---|---|
| 에디터 | CodeMirror 6 | ✅ |
| 마크다운 | markdown-it | ✅ |
| Frontmatter | js-yaml | ✅ |
| 셸 | Tauri 2 | ✅ |
`;

  let raw = $state(SAMPLE);
  const parsed = $derived(parseNote(raw));
</script>

<div class="app">
  <header class="topbar">
    <span class="brand">Lapis</span>
    <span class="phase">Phase 0 — PoC</span>
    <span class="meta">CodeMirror 6 · markdown-it · Tauri 2</span>
  </header>

  <div class="workspace">
    <section class="pane editor-pane">
      <div class="pane-title">Editor</div>
      <div class="pane-body">
        <Editor bind:value={raw} />
      </div>
    </section>

    <section class="pane preview-pane">
      <div class="pane-title">Preview</div>
      <div class="pane-body">
        {#if Object.keys(parsed.data).length > 0}
          <details class="properties" open>
            <summary>Properties ({Object.keys(parsed.data).length})</summary>
            <table>
              <tbody>
                {#each Object.entries(parsed.data) as [key, value]}
                  <tr>
                    <th>{key}</th>
                    <td>
                      {#if Array.isArray(value)}
                        {#each value as v, i}
                          <span class="chip">{v}</span>
                        {/each}
                      {:else if typeof value === "object" && value !== null}
                        <code>{JSON.stringify(value)}</code>
                      {:else}
                        {value}
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
        <article class="rendered">
          {@html parsed.html}
        </article>
      </div>
    </section>
  </div>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100vh;
    overflow: hidden;
    background: #1e1e1e;
    color: #e8e8e8;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Apple SD Gothic Neo", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid #333;
    background: #252526;
    font-size: 13px;
  }

  .brand {
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #6dd6ff;
  }

  .phase {
    color: #aaa;
  }

  .meta {
    margin-left: auto;
    color: #777;
    font-size: 12px;
  }

  .workspace {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    overflow: hidden;
  }

  .pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid #333;
  }

  .pane:last-child {
    border-right: none;
  }

  .pane-title {
    padding: 6px 14px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    background: #2a2a2a;
    border-bottom: 1px solid #333;
  }

  .pane-body {
    flex: 1;
    overflow: auto;
  }

  .preview-pane .pane-body {
    padding: 20px 28px;
  }

  .properties {
    background: #252526;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 24px;
  }

  .properties summary {
    cursor: pointer;
    color: #6dd6ff;
    font-weight: 600;
    font-size: 13px;
    user-select: none;
  }

  .properties table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 13px;
  }

  .properties th {
    text-align: left;
    color: #888;
    padding: 4px 12px 4px 0;
    font-weight: 500;
    width: 110px;
    vertical-align: top;
  }

  .properties td {
    padding: 4px 0;
    color: #ddd;
  }

  .chip {
    display: inline-block;
    padding: 1px 8px;
    margin: 2px 4px 2px 0;
    background: #2d4a5a;
    border-radius: 10px;
    font-size: 12px;
    color: #9adff7;
  }

  .rendered {
    line-height: 1.65;
    font-size: 15px;
  }

  .rendered :global(h1) {
    font-size: 1.8em;
    border-bottom: 1px solid #333;
    padding-bottom: 6px;
    margin-top: 0;
  }

  .rendered :global(h2) {
    font-size: 1.35em;
    margin-top: 1.6em;
    color: #e8e8e8;
  }

  .rendered :global(h3) {
    font-size: 1.1em;
    color: #ccc;
  }

  .rendered :global(a) {
    color: #6dd6ff;
  }

  .rendered :global(code) {
    background: #2d2d2d;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.9em;
    color: #f0a;
  }

  .rendered :global(pre) {
    background: #161616;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    border: 1px solid #2a2a2a;
  }

  .rendered :global(pre code) {
    background: transparent;
    color: #e8e8e8;
    padding: 0;
  }

  .rendered :global(blockquote) {
    border-left: 3px solid #6dd6ff;
    margin: 1em 0;
    padding: 0 14px;
    color: #bbb;
  }

  .rendered :global(table) {
    border-collapse: collapse;
    margin: 1em 0;
  }

  .rendered :global(th),
  .rendered :global(td) {
    border: 1px solid #3a3a3a;
    padding: 6px 12px;
  }

  .rendered :global(th) {
    background: #2a2a2a;
  }

  .rendered :global(ul),
  .rendered :global(ol) {
    padding-left: 1.5em;
  }

  .rendered :global(li) {
    margin: 0.2em 0;
  }
</style>
