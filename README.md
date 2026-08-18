# Lapis

> 로컬 마크다운을 **백링크 · 태그 · 풀텍스트 검색**으로 항해하는 개인용 지식 워크벤치 — macOS 네이티브

![release](https://img.shields.io/github/v/release/eren0315/lapis?label=release&color=1f6feb)
![platform](https://img.shields.io/badge/platform-macOS_11%2B_(Apple_Silicon)-black)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-blue)

Lapis는 이미 쌓인 마크다운 더미를 **읽고 찾는** 데 최적화된 데스크톱 앱입니다. 새 노트를 쓰는 도구가 아니라, 수천~수만 개 문서 사이의 연결을 따라가는 도구입니다.

파일은 로컬 파일시스템에만 있습니다. 계정도, 클라우드 동기화도, 텔레메트리도 없습니다. 앱이 하는 일은 `.md` 파일을 읽고, 인덱스를 만들고, 필요하면 원자적으로 쓰는 것뿐입니다.

**설계상 다른 점 세 가지**

- **읽기가 기본** — 처음 보이는 화면이 렌더링된 프리뷰이고, 편집기는 `⌘E`로 필요할 때만 꺼냅니다.
- **한글 검색을 전제로 만듦** — BM25 랭킹에 한글 bigram 색인을 얹어, 조사·어미가 붙어도 걸립니다.
- **에이전트가 쓸 수 있는 인덱스** — 앱이 만든 검색 인덱스를 MCP 서버로 노출해 Claude Code가 같은 vault를 질의합니다.

---

## 주요 기능

### 읽기 중심 워크플로

- **`⌘E` 단일 토글** — 프리뷰(markdown-it) ↔ 편집기(CodeMirror 6). 모드가 두 개가 아니라 한 개의 토글입니다.
- **본문 폭 조절** — Aa 팝오버에서 40~88em. 긴 문서를 읽기 좋은 단 폭으로 좁힙니다.
- **읽던 위치 이월** — 편집기와 프리뷰를 오가도 보고 있던 섹션에 그대로 머무릅니다.
- **아웃라인**(`⌘⇧O`) — 헤딩 목록으로 문서 안을 점프.
- **컨텍스트 패널**(`⌥B`) — frontmatter 속성과 백링크를 본문 옆에 붙여 둡니다.
- **테마** — 라이트 / 다크 / 시스템 따라가기.

### 문서 사이의 연결

- **위키링크** — `[[노트 이름]]`으로 점프. 코드펜스와 인라인 코드 안의 `[[...]]`는 링크로 보지 않습니다(예: `[[String: Any]]`은 코드 표현입니다).
- **백링크 패널** — 이 문서를 가리키는 문서 목록. 역참조가 탐색의 1차 수단입니다.
- **frontmatter cross-ref** — `related` · `amends` · `superseded_by`를 **관계 타입을 보존해** 따로 인덱싱합니다. "이 문서를 정정한 문서"와 "그냥 관련 문서"가 섞이지 않습니다.
- **링크 자동 갱신** — 파일 이름을 바꾸면 그를 가리키던 참조를 따라가 고칩니다. 실행 전 **dry-run 미리보기**와 **백업**을 거칩니다.

### 검색 — 세 층

| 층 | 단축키 | 엔진 | 쓰는 때 |
|---|---|---|---|
| 파일명 fuzzy | `⌘P` | 자체 fuzzy | 파일 이름을 대충 아는 경우 |
| 풀텍스트 | `⌘⇧F` | MiniSearch (BM25 + 한글 bigram) | 내용으로 찾을 때 |
| 문서 내 | `⌘F` | regex · 대소문자 · 단어 단위 | 열어 둔 문서 안에서 |

풀텍스트 인덱스는 **Web Worker**에서 만들고 **shard 단위로 디스크에 캐시**합니다. 앱을 다시 켤 때 처음부터 다시 읽지 않습니다.

### 태그

- **frontmatter `tags:`만** 인덱싱합니다. 본문 인라인 해시태그는 의도적으로 무시합니다 — 코드 안의 `#define`이나 URL fragment(`#section`)와 구분할 방법이 없기 때문입니다.
- **nested kebab-case** — `tech/svelte5`, `issue/atomic-write`처럼 `/`로 계층을 만들면 사이드바가 prefix 트리로 렌더합니다.
- 태그를 눌러 해당 문서만 좁혀 보기.

### 탭과 창

- `⌘T` 새 탭 · `⌘P` 활성 탭 교체 · `⌘W` 닫기 · `⌘1`~`⌘9` 선택
- `⌘,` / `⌘.` (또는 `⌘←` / `⌘→`) 방문 이력 뒤로 · 앞으로
- **`⌘⇧T` 새 창 — 창마다 다른 vault를 엽니다.** 개인 노트와 프로젝트 문서를 나란히 두고 봅니다.

### 내보내기 · 바깥으로 옮기기

- **Mermaid** 코드블록 렌더(테마에 맞춰 색이 바뀝니다) + **PNG 내보내기**
- **자립형 HTML 내보내기** — 스타일이 파일 안에 들어간 단일 `.html`. 어디서 열어도 같게 보입니다.
- **리치 텍스트 복사** — 위키·메일·메신저의 서식 입력란에 붙여넣으면 서식이 유지됩니다.
- **Finder에서 보기** — 현재 노트를 Finder에서 바로 엽니다.
- **vault git 버전관리** — vault가 git 저장소면 앱에서 변경을 다룹니다.

---

## 설치

1. [Releases](https://github.com/eren0315/lapis/releases)에서 최신 `Lapis_x.y.z_aarch64.dmg`를 내려받습니다. (**Apple Silicon** · macOS 11+)
2. dmg를 열고 `Lapis.app`을 `/Applications`로 드래그합니다.
3. **첫 실행에만** 열기 확인이 필요합니다. Developer ID로 서명했지만 **공증(notarization)은 하지 않습니다**:
   - macOS 14 이하 — `Lapis.app` 우클릭 → **열기** → **열기**
   - macOS 15 이상 — 실행 후 시스템 설정 → 개인정보 보호 및 보안 → **"확인 없이 열기"**

> Intel Mac용 바이너리는 배포하지 않습니다. 필요하면 소스에서 빌드하세요(아래 [개발](#개발)).

## 시작하기

1. 좌측 사이드바 상단 **Vault 열기…** 로 `.md`가 들어 있는 폴더를 고릅니다. 빈 폴더도 됩니다.
2. 첫 인덱싱이 돌아갑니다. 링크·태그·풀텍스트를 한 번에 만들며, 1,000개 규모에서 수 초입니다. **트리 표시를 막지 않으므로** 인덱싱 중에도 문서를 열 수 있습니다.
3. `⌘P`로 파일 이름을, `⌘⇧F`로 내용을 찾습니다.
4. 아무 노트에 `[[다른 노트]]`를 적어 두고, 그 다른 노트의 **Backlinks**에서 역참조가 잡히는지 봅니다.
5. 나머지는 `⌘K` — 모든 명령이 Command Palette에 있습니다.

## 단축키

| 단축키 | 동작 |
|---|---|
| `⌘K` | Command Palette — 모든 명령 검색 |
| `⌘P` | Quick File Open (파일명 fuzzy) — 활성 탭을 교체 |
| `⌘⇧F` / `⌘⇧P` | 풀텍스트 검색 |
| `⌘F` | 현재 노트 안에서 찾기 |
| `⌘E` | 읽기 ↔ 편집 토글 |
| `⌘⇧E` | 파일 트리 필터로 포커스 |
| `⌘N` | 새 노트 |
| `⌘S` | 즉시 저장 (편집 중에는 2초마다 자동 저장) |
| `F2` | 현재 노트 이름 변경 |
| `⌘⌫` | 현재 노트를 휴지통으로 |
| `⌘T` | 새 탭 |
| `⌘⇧T` | 새 창 (창마다 다른 vault) |
| `⌘W` | 탭 닫기 |
| `⌘1`~`⌘9` | 해당 탭으로 |
| `⌘,` / `⌘.` | 방문 이력 뒤로 / 앞으로 |
| `⌘←` / `⌘→` | 방문 이력 뒤로 / 앞으로 |
| `⌘B` | 사이드바 접기/펴기 |
| `⌥B` | 컨텍스트 패널 접기/펴기 |
| `⌘⇧O` | 아웃라인 |
| `⌘⇧C` | 현재 노트 경로 복사 |

> `F2`는 Mac 매직 키보드에서 기본이 화면 밝기입니다. `Fn+F2`를 쓰거나, 키보드 설정에서 "F1, F2 등을 표준 기능 키로 사용"을 켜세요. 아니면 `⌘K` → "Rename".

---

## Claude Code 연동 — 지식 질의 MCP

Lapis가 만든 검색 인덱스를 MCP 서버로 노출합니다. 도구는 **하나**(`lapis_query`)입니다.

```json
{
  "mcpServers": {
    "lapis": { "command": "/절대/경로/lapis/mcp/lapis-mcp" }
  }
}
```

구조 질의(`doc_kind` · `topic` · `tag` · `backlinks_of`)와 BM25 풀텍스트를 한 번에 냅니다. LLM도 API 키도 없습니다 — 같은 인자를 주면 같은 결과가 나옵니다.

**정직한 한계** (19,000+ 문서 vault에서 실측):

- **grep을 대체하지 않습니다.** 재현율은 grep이 더 높습니다(AND 검색 100% vs R@10 89.4%). 이 도구의 값은 **랭킹**입니다.
- **참조 추적(`backlinks_of`)만 압도적입니다.** grep이 3회 호출·15.9KB·오탐 3건을 쓴 질문을 1회·1.6KB·오탐 0건으로 답합니다.
- **인덱스 생산자는 앱입니다.** MCP는 캐시를 읽기만 합니다. vault가 캐시보다 새로우면 응답에 `stale`을 실어 보내지만 **막지는 않습니다** — 하드 실패 자체가 판단이고, 이 서버는 판단하지 않습니다.

계약 · 오류 종류 · 계측 수치는 [`mcp/README.md`](mcp/README.md)에 있습니다.

---

## 설계 원칙

| 원칙 | 구현 |
|---|---|
| **로컬 온리** | 네트워크 코드가 없습니다. 계정·동기화·텔레메트리 없음. |
| **부분 쓰기 금지** | 저장은 `temp file → POSIX rename`. 같은 디렉터리에 쓰고 원자적으로 갈아끼웁니다. 실패하면 temp를 정리합니다. |
| **경로 탈출 차단** | vault root를 canonicalize한 뒤 `starts_with`로 검사하고, 확장자는 화이트리스트로 제한합니다. |
| **인덱스는 한 곳에서만 만든다** | 스캐너를 두 벌 두면 반드시 어긋납니다. wikilink·md link·frontmatter 추출은 전부 Rust에만 있고, MCP는 그 산출물을 읽습니다. |
| **외부 의존 최소** | Rust 쪽은 `std::fs`/`std::path` 중심입니다. |

## 기술 스택

| 구분 | 스택 |
|---|---|
| 앱 | Tauri 2 (macOS 데스크톱, Apple Silicon) |
| Frontend | SvelteKit 2 + Svelte 5 (룬) + TypeScript 5 + Vite 6 |
| Backend | Rust (`std::fs`/`std::path` 중심, 외부 crate 최소) |
| 에디터 | CodeMirror 6 |
| 마크다운 | markdown-it 14 + js-yaml + 자체 wikilink 룰 + highlight.js |
| 검색 | MiniSearch (BM25 + 한글 bigram, Web Worker + shard 디스크 캐시) |
| 다이어그램 | Mermaid |
| MCP | Node (SDK 무의존, 호출 시점 esbuild 번들) |
| 테스트 | Vitest |

> 검색은 초기에 tantivy + lindera였습니다. v1.3.0에서 **제거**하고 MiniSearch로 옮겼습니다.

## 프로젝트 구조

```text
lapis/
├── src/                     # SvelteKit 프론트엔드
│   ├── lib/
│   │   ├── stores/          # 도메인별 writable store (vault, editor, tags, …)
│   │   ├── tauri/           # Rust 명령의 typed 래퍼
│   │   ├── keymap.ts        # 전역 단축키 매칭 (실행은 호출자가)
│   │   ├── searchIndex.ts   # fuzzy + MiniSearch 풀텍스트
│   │   ├── linkIndex.ts     # wikilink/md link resolver + 백링크
│   │   └── *.svelte         # Sidebar · Editor · SearchModal · CommandPalette …
│   ├── app.css              # 디자인 토큰 (테마의 단일 진실원)
│   └── routes/+page.svelte  # 워크스페이스
├── src-tauri/               # Rust 백엔드 (Tauri host)
│   └── src/
│       ├── vault.rs         # list/read/write_note · scan_links · read_vault_bundle
│       ├── search_cache.rs  # 풀텍스트 인덱스 디스크 캐시 (meta + shard)
│       └── paths.rs         # 앱 데이터 경로 (dev / 릴리즈 분리)
├── mcp/                     # 지식 질의 MCP 서버 + 검색 품질 계측 하네스
└── static/
```

## 개발

**요구사항** — Node LTS, Rust stable(Tauri 2 요구 버전), Xcode Command Line Tools.

```bash
npm install
npm run tauri dev
```

검증:

```bash
npm run check                  # Frontend 타입 체크 (svelte-check)
npm run check:mcp              # MCP 타입 체크 (루트 check는 src/ 만 봅니다)
npm run test                   # Vitest
cd src-tauri && cargo check    # Rust 타입 체크
```

빌드:

```bash
npm run tauri build                                    # dmg (호스트 아키텍처)
npm run tauri build -- --target universal-apple-darwin # universal binary
```

> ⚠️ **dev 빌드와 설치본은 앱 데이터 디렉터리가 분리돼 있습니다**(`com.lapis.dev-dev` vs `com.lapis.dev`). 예전엔 공유해서 두 빌드가 서로의 검색 캐시를 덮어쓰며 재인덱싱을 반복했습니다. → `src-tauri/src/paths.rs`

## 트러블슈팅

**앱이 열리지 않습니다 / "확인할 수 없는 개발자"**
공증하지 않은 빌드입니다. 위 [설치](#설치) 3번을 따르세요.

**검색 결과가 안 나옵니다**
첫 인덱싱이 아직 도는 중일 수 있습니다. 태그·백링크가 비어 보이는 것도 같은 이유입니다. 큰 vault는 잠시 기다리세요.

**태그를 본문에 `#태그`로 적었는데 안 잡힙니다**
의도된 동작입니다. frontmatter `tags:`만 인덱싱합니다.

**MCP 서버가 클라이언트에 뜨지 않습니다**
클라이언트는 서버를 최소 환경으로 띄우기 때문에 homebrew node를 못 찾을 수 있습니다. 래퍼가 후보 경로를 훑지만, 특이한 위치에 있으면 `LAPIS_NODE`로 절대 경로를 주세요. 자세한 내용은 [`mcp/README.md`](mcp/README.md).

**MCP 응답에 `stale`이 붙어 나옵니다**
vault가 캐시보다 새롭다는 뜻입니다. 앱이 떠 있으면 watcher가 갱신하지만 **커밋까지 10~20초** 걸립니다. 몇 건이면 보통 결과에 영향이 없고, 수백 건이면 앱이 꺼져 있었다는 신호입니다.

## 기여

개인 용도로 만든 도구라 로드맵은 제 사용 패턴을 따라갑니다. 버그 리포트와 제안은 [Issues](https://github.com/eren0315/lapis/issues)로 환영합니다. PR을 보내실 거면 먼저 이슈로 방향을 맞춰 주세요.

## 라이선스

MIT
