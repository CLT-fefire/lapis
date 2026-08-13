# Lapis

> Personal Markdown Knowledge Workbench — 로컬 마크다운을 백링크·태그·검색으로 항해하는 개인용 지식 도구 (macOS)

## 현재 상태

🎉 **v1.9.0 released** — [Releases](https://github.com/CLT-fefire/lapis/releases) (dmg, Apple Silicon).

로컬 파일시스템의 `.md`만 다룹니다. 외부 동기화·클라우드 전송은 일절 없습니다.

## 주요 기능

- **읽기 ↔ 편집 단일 토글**(`⌘E`) — 기본은 프리뷰(markdown-it), 필요할 때만 CodeMirror 6 편집기로 전환. 우측 컨텍스트 패널에 속성·백링크.
- **위키링크 & 백링크** — `[[노트]]` 점프 + 역참조 패널. frontmatter cross-ref(`related`/`amends`/`superseded_by`)는 관계 타입을 보존해 따로 인덱싱.
- **태그** — **frontmatter `tags:`** nested 인덱싱(`tech/svelte5` → prefix 트리) + 사이드바 탐색.
- **검색** — 파일명 fuzzy(`⌘P`) + 풀텍스트(`⌘⇧F`, **MiniSearch BM25 + 한글 bigram**) + 문서 내 검색(`⌘F`, regex/대소문자/단어).
- **탭 & 창** — `⌘T` 새 탭 / `⌘P` 활성 탭 교체, `⌘,`·`⌘.` 방문 이력. `⌘⇧T`로 **창마다 다른 vault**.
- **읽기 타이포그래피** — 본문 폭 조절(Aa 팝오버, 40~88em). 페인을 오가도 읽던 섹션 위치가 이월된다.
- **다이어그램** — Mermaid 코드블록 렌더(테마 적응) + PNG 내보내기.
- **기타** — 라이트/다크/시스템 테마, 프리뷰 자립형 HTML 내보내기, Finder에서 보기, 링크 자동 갱신(dry-run + 백업), vault git 버전관리.

## 지식 질의 MCP

Lapis가 만든 검색 인덱스를 **Claude Code에 노출**합니다 — 도구 하나(`lapis_query`).

```json
{ "mcpServers": { "lapis": { "command": "<repo>/mcp/lapis-mcp" } } }
```

구조 질의(`doc_kind`·`topic`·`tag`·`backlinks_of`)와 BM25 풀텍스트를 함께 냅니다.

| 문서 | 담당 |
|---|---|
| [`mcp/README.md`](mcp/README.md) | 계약·오류 종류·한계·계측 수치 |
| `knowledge/_global/reference/lapis-query-usage-guide-20260813.md` | **사용 가이드** — 질문을 인자로 옮기는 법, 응답 읽는 법, 안 나올 때 |
| `SharedDocs/rules/knowledge-hub.md` | 언제 이걸 쓰고 언제 grep을 쓰나 (라우팅) |

⚠️ **인덱스 생산자는 앱입니다.** MCP는 캐시를 읽기만 하고, vault가 캐시보다 새로우면 응답에 `stale`을 실어 보냅니다 — 막지는 않습니다.

⚠️ **grep을 대체하지 않습니다.** 계측상 재현율은 grep이 더 높고(AND 100% vs R@10 89.4%), 이 도구의 값은 **랭킹**입니다. 참조 추적(`backlinks_of`)만 압도적입니다 — grep이 3회·15.9KB·오탐 3을 쓴 질문을 1회·1.6KB·오탐 0으로 답합니다.

## 설치 (사용자)

1. [Releases](https://github.com/CLT-fefire/lapis/releases)에서 최신 `Lapis_x.y.z_aarch64.dmg` 다운로드 (Apple Silicon · macOS 11+)
2. dmg를 열고 `Lapis.app`을 `/Applications`로 드래그
3. **첫 실행만** 열기 확인 — Developer ID 서명 빌드이지만 **공증은 하지 않습니다**
   - macOS 14 이하: `Lapis.app` 우클릭 → **열기** → **열기**
   - macOS 15 이상: 시스템 설정 → 개인정보 보호 및 보안 → **"확인 없이 열기"**

## 개발

```bash
npm install
npm run tauri dev       # 데스크톱 앱 (개발 모드)
```

검증:

```bash
npm run check                  # Frontend 타입 체크 (svelte-check)
npm run check:mcp              # MCP 타입 체크 (루트 check는 src/ 만 봅니다)
npm run test                   # vitest
cd src-tauri && cargo check    # Rust 타입 체크
npm run tauri build            # 배포 dmg 빌드
```

> ⚠️ **dev 빌드와 설치본은 앱 데이터 디렉터리가 분리돼 있습니다**(`com.lapis.dev-dev` vs `com.lapis.dev`). 예전엔 공유해서 두 빌드가 서로의 검색 캐시를 덮어쓰며 재인덱싱을 반복했습니다. → `src-tauri/src/paths.rs`

## 기술 스택

| 구분 | 스택 |
|---|---|
| 앱 | Tauri 2 (macOS 데스크톱, Apple Silicon) |
| Frontend | SvelteKit 2 + Svelte 5 (룬) + TypeScript 5 + Vite 6 |
| Backend | Rust (std::fs/std::path 중심, 외부 crate 최소) |
| 에디터 | CodeMirror 6 |
| 마크다운 | markdown-it 14 + js-yaml + 자체 wikilink 룰 + highlight.js |
| 검색 | **MiniSearch**(BM25 + 한글 bigram, Web Worker + shard 캐시). ⚠️ tantivy+lindera는 v1.3.0에서 **제거**됨 |
| 다이어그램 | Mermaid |
| MCP | Node (SDK 무의존, 호출 시점 esbuild 번들) |

## 디렉토리 구조

```text
Lapis/
├── src/              # SvelteKit 프론트엔드
│   ├── lib/          # 컴포넌트 + stores/ + markdown/검색/링크 인덱스
│   ├── app.css       # 디자인 토큰 (테마 SOT)
│   └── routes/       # +page.svelte (워크스페이스)
├── src-tauri/        # Rust 백엔드 (Tauri host)
│   └── src/
│       ├── vault.rs        # list/read/write_note, scan_links, read_vault_bundle …
│       ├── search_cache.rs # 풀텍스트 인덱스 disk 캐시 (meta + shard)
│       └── paths.rs        # 앱 데이터 경로 (dev/릴리즈 분리)
├── mcp/              # 지식 질의 MCP 서버 + 검색 품질 계측 하네스
├── docs/             # 프로젝트 문서 (STATE/PLAN/plans/solutions/adr …)
└── README.md
```

## 문서 · 링크

- [GitHub Releases](https://github.com/CLT-fefire/lapis/releases)
- [팀 Confluence 가이드](https://everysing.atlassian.net/wiki/spaces/IMA/pages/4435017752/Lapis) — 설치·사용·FAQ
- [`mcp/README.md`](mcp/README.md) — 지식 질의 MCP 계약·한계
- `docs/STATE.md` — 개발 진행 상태 (Source of Truth)

## 라이선스

개인용 / 미정.
