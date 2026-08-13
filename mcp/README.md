# lapis-mcp — 지식 vault 질의 MCP

Lapis 앱이 만든 검색 인덱스를 Claude Code에 노출한다. **도구 하나**(`lapis_query`).

```
사용자 → Claude Code → MCP → Lapis 캐시
           (판단)      (실행만)
```

MCP는 판단하지 않는다. LLM도 API 키도 없다. 같은 인자 → 같은 결과. 결과가 나쁘면 원인이
둘로만 좁혀진다 — 인자를 잘못 채웠나 / 인덱스에 없나.

## 등록

`~/.claude.json` 또는 프로젝트 `.mcp.json`:

```json
{
  "mcpServers": {
    "lapis": { "command": "/Users/Shared/Source/Personal/Lapis/mcp/lapis-mcp" }
  }
}
```

`lapis-mcp`가 호출 시점에 esbuild로 번들한다(16 KB, ~30ms). 사전 빌드 단계가 없다 —
커밋된 산출물을 두면 소스와 어긋나도 아무 신호가 없기 때문이다.

## 전제 — 인덱스 생산자는 앱이다

Node엔 vault 스캐너가 없다. `extract_wikilinks`(코드펜스·인라인코드 제외) ·
`extract_md_links` · `collect_all_props`가 전부 Rust 전용이다. 재구현하면 스캐너가 두 벌이
되고 drift가 생긴다. → **MCP는 캐시를 읽기만 하고, stale이면 실패한다.**

앱이 떠 있으면 watcher가 2초 안에 갱신하므로 실사용에서 문제가 되지 않는다.

## 인자

| 인자 | 팔 | 뜻 |
|---|---|---|
| `text` | BM25 | 풀텍스트. 한글 bigram, 영문 3글자+ prefix |
| `doc_kind` | 구조 | 정확일치. ⚠️ **frontmatter 선언 기준**이라 폴더와 다를 수 있다 |
| `topic` | 구조 | 정확일치 |
| `tag` | 구조 | **nested prefix** — `tech` → `tech/*` 전부 |
| `backlinks_of` | 구조 | 이 문서를 참조하는 문서. 경로·노트 이름 아무거나 |
| `list` | — | `topics`\|`tags`\|`doc_kinds` 값을 빈도순 열거 |
| `sources` | — | 팔 한정 |
| `exclude` | — | vault 상대 **문자열 prefix** 배열 |
| `include_archive` | — | `_memories` 기본 제외 해제 |
| `limit` | — | 기본 10, 상한 50. `0`은 1로 클램프(기본값으로 튀지 않는다) |
| `vault` | — | vault 루트 절대 경로 |

### 알아야 하는 동작 4가지

1. **구조 + `text`를 같이 주면 구조가 필터, BM25가 순위.** 구조만 주면 그 집합을 먼저 싣는다.
   **`limit`은 항상 지킨다**(상한 50). 집합이 더 크면 `structural_total`로 전체 크기를,
   버린 게 있으면 `truncated: true`를 낸다. ⚠️ 초기엔 "구조는 안 자른다"를 전건 적재로
   구현했다가 `{doc_kind:"solution", limit:10}`이 **130행 38 KB**를 냈다 — 바이트를 줄이려고
   만든 도구가 그 반대를 했다. 지금은 같은 질의가 **3.0 KB**다.
2. **`backlinks_of`는 본문 링크 ∪ frontmatter `related`/`amends`/`superseded_by`.**
   `via`가 근거를 구분해 낸다. 본문만 보면 실측 8건 중 3건을 놓친다.
3. **`_memories`는 기본 제외.** vault의 94%(18,039/19,222)라서 BM25 상위를 익사시킨다.
4. **`exclude`는 디렉터리 경계가 아니라 문자열 prefix.** `lapis/plans/lapis-cli-`처럼 세그먼트
   중간에서 끊어도 된다. 부작용으로 `_memories`가 `_memories-old/`도 뺀다.

## 실패는 소리내어

`{ error: { kind, message, remedy } }`.

`cache_absent` · `version_skew` · `corrupt` · `stale` · `vault_ambiguous` ·
`vault_not_found` · `path_not_indexed` · `shard_incomplete` · `no_criteria`

**부분 인덱스로 검색하지 않는다.** shard가 하나라도 결손·skew면 실패한다 — "검색했는데
안 나온다"는 소비자에게 "없다"로 읽히고, 그건 없는 것보다 나쁘다.

## 상주 비용 (2026-08-13 실측, 19,222 노트)

| | 콜드 | RSS |
|---|---:|---:|
| 구조 팔 | 196 ms | **201 MB** |
| + BM25 8 shard | +1,400 ms | ~1,030 MB |

5배 차이라 **BM25는 `text`가 처음 올 때만 로드**한다. 판정 4문항 중 3개가 구조 팔이다.

## grep과 비교 (2026-08-13 판정, 양팔 모두 정답표 미열람 세션)

| | grep | 인덱스 |
|---|---:|---:|
| 호출 수 | 10 | 10 |
| 응답 바이트 | 45 KB | **14.6 KB** |
| 첫 시도 완전 | 2/4 | 2/4 |

**호출 수는 동률이고 바이트만 3.1배 낫다.** 압도적인 건 참조 추적 하나다 — grep이 3회
15.9 KB에 오탐 3을 낸 질문을 1회 1.6 KB에 8/8 오탐 0으로 답한다.

⚠️ **두 팔의 실패 방향이 반대다.** `_memories`에서 grep은 4문항 전부 0건(어휘 불일치 —
기록은 "창", 질의는 "윈도우")인데 BM25는 거기에 상위를 익사당한다. 같은 코퍼스가 한 팔은
못 닿고 한 팔은 압도당하니, **둘 다 쓰는 게 맞다.**

## 남은 한계

- **한글 bigram이 짧은 질의에 과민하다.** `"멀티 윈도우"` 63점 vs 영문 혼합 1,494점.
  점수 스케일도 질의 간 비교가 안 돼(848 vs 73) 절대 임계값을 못 세운다. 인덱스
  토크나이저 문제라 MCP에서 못 고친다 — 앱을 바꾸면 `CACHE_VERSION` bump다.
- **stale 판정이 mtime 프록시다.** meta의 `fingerprint`가 Rust `DefaultHasher`(std가 값
  안정성을 부정)라 JS로 재현할 수 없다. **삭제만 있고 수정이 없는 변경을 놓친다.**
- **캐시 디렉터리가 dev·릴리즈 공통**(`com.lapis.dev`). 두 빌드의 `CACHE_VERSION`이 다르면
  서로의 캐시를 덮어쓴다. MCP 결함은 아니지만 개발 중엔 겪는다.

## 개발

```bash
npm run test -- mcp/     # 픽스처 기반 53건 (라이브 캐시에 의존하지 않는다)
npm run check:mcp        # tsc — ⚠️ 루트 `npm run check`는 `src/`만 본다
```

⚠️ `mcp/tsconfig.json`의 `moduleResolution`은 **`bundler`여야 한다.** 실행 경로가 esbuild
번들이고 앱 코드가 확장자 없는 import를 쓴다. `nodenext`로 두면 타입이 오류 없이 조용히
`any`로 떨어진다.
