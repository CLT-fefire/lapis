# Changelog

[English](CHANGELOG.md) · **한국어**

> 원본은 영어판 [`CHANGELOG.md`](CHANGELOG.md)입니다. 이 문서는 번역본이라 한 발 늦을 수 있습니다.

Lapis의 버전별 변경 이력. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르되,
1인 프로젝트에 맞게 축약했다. 버전 체계는 [Semantic Versioning](https://semver.org/lang/ko/)을 느슨하게 따른다.

> **바이너리 배포는 하지 않는다.** GitHub Releases에 올려둔 산출물이 없고 태그만 단다.
> 설치는 [README의 설치 절](README.ko.md#설치)대로 소스에서 빌드한다.

> **⚠️ 히스토리 재작성 고지 (2026-08-18)** — 저장소를 개인 계정으로 옮기면서 `git filter-repo`로
> 전체 히스토리를 재작성했다. **v1.10.0 이전 커밋의 SHA는 전부 바뀌었다.** 태그는 새 SHA를 가리키도록
> 갱신됐지만, 외부 문서·PR 페이지에 남은 옛 SHA 참조는 더 이상 해소되지 않는다.

---

## [1.15.0] — 2026-08-26

### Added
- **vault 전체 태그 이름 바꾸기·병합** ([#202]). 태그는 `/`로 계층을 이루고 사이드바가 접두 트리로
  그리는데, 오타 하나를 고치려면 그 태그가 든 노트를 **전부 손으로 열어야 했다.** 노트 rename은
  오래전부터 인용 링크를 자동으로 고쳐왔는데 태그에는 그 짝이 없었다. 하위 태그도 부모를 따라간다 —
  `tech`를 `stack`으로 바꾸면 `tech/svelte5`는 `stack/svelte5`가 된다. 경계는 **`/`에서만** 인정해
  `technical`은 건드리지 않는다. 이미 있는 태그로 바꾸면 둘이 합쳐지고, 적용 전에 그 사실을 알린다.

  적용은 노트 rename의 트랜잭션을 **그대로** 탄다: dry-run 미리보기 → 백업 → 순차 쓰기 → 실패 시
  롤백. 그리고 `related:` 갱신과 마찬가지로 YAML을 **파싱하지 않고 줄 단위로** 고친다 — #184에서
  파싱 실패가 노트의 frontmatter를 통째로 날린 그 교훈이다. 본문의 `#tag`는 의도적으로 그대로 둔다.
  인덱서가 그걸 무시하는 데는 이유가 있기 때문이다.
- **vault 전체 리터럴·정규식 검색** (`⌘⇧G`) ([#200]). 문서 **내** 검색(`⌘F`)에는 regex·대소문자·단어
  단위가 오래전부터 있었는데, vault **전체**(`⌘⇧F`)는 BM25 토큰 매칭뿐이었다. 이 공백이 문제인 이유는
  **BM25와 grep이 반대 방향으로 실패**하기 때문이다 — 이 vault 실측에서 `_memories`의 4문항에 grep은
  전부 0건이었고(기록은 "창", 질의는 "윈도우") BM25는 같은 트리에서 상위를 익사당했다.
  `mcp/README.md`가 "둘 다 쓰는 게 맞다"고 결론냈는데 앱에는 한 팔만 있었다. 매칭은 Rust에서,
  `read_vault_bundle`이 이미 쓰는 rayon 병렬 walk 위에서 돈다. 결과를 클릭하면 같은 패턴으로 문서 내
  검색이 켜져 노트 맨 위가 아니라 찾은 자리에서 시작한다.

  ⚠️ 매치 오프셋은 **Rust가** UTF-16 코드 단위로 돌려준다. 프런트에서 다시 계산하면 두 번 틀린다 —
  Rust `regex`에는 역참조·lookaround가 없어 JS `RegExp`가 다른 곳을 매치할 수 있고, 바이트 오프셋을
  쓰면 한글이 든 줄에서 하이라이트가 통째로 어긋난다.
- **끊긴 링크 감사** ([#199]). 프리뷰가 미해소 위키링크에 클래스를 붙이긴 하지만 **그 노트를
  열었을 때만** 보인다. 19,000 노트에서 눈으로 훑어 찾을 수 있는 게 아니다. README가 밝히듯
  **vault를 쓰는 게 Lapis가 아니라 바깥 도구들**이라 이게 문제가 된다 — 앱 안에서의 rename은
  가리키는 링크를 따라가 고치지만, 밖에서 파일이 지워지거나 이름이 바뀌면 조용히 끊기고 그
  경로엔 아무 신호가 없었다. 새 명령이 미해소 본문 링크를 전부 열거하되 **대상별로 묶고 참조
  수 내림차순으로** 낸다 — 고칠 단위가 "링크 하나"가 아니라 "없는 노트 하나"라, 목록 위쪽이
  곧 가장 싸게 고치는 순서다. 인덱스 빌드가 아니라 **요청 시에만** 계산해 기동 경로는 그대로다.

  ⚠️ frontmatter 상호참조는 의도적으로 제외한다. `relations.ts`는 "노트로 resolve되면 관계"를
  정의로 삼기 때문에, 그 필드를 감사하면 `status: welcome` · `priority: high` 같은 평범한
  스칼라가 전부 끊긴 링크로 잡힌다. 본문 링크는 문법 자체가 링크 선언이라 그 모호함이 없다.
- **질의를 가로질러 비교되는 상대 점수 `rel`** ([#198]). raw BM25 점수는 질의 간 비교가 안 됐다 —
  같은 코퍼스가 `"멀티 윈도우"`에 63점, 영문 혼합에 1,494점을 냈다(다른 표본은 848 vs 73).
  IDF가 질의 term 구성에 따라 통째로 달라지고 shard-local이기까지 해서다. 그래서 **절대 임계값을
  세울 수 없었고**, 특히 `OR` 폴백에서 아팠다 — 일부러 넓게 긁는 단계인데 꼬리를 자를 기준이
  없었다. 이제 랭킹 결과마다 그 질의의 top-1을 `1.0`으로 둔 `rel`이 실린다. MCP 도구는 `min_rel`로
  꼬리를 자르고, 자른 건수를 `used[].dropped_by_min_rel`로 보고한다 — 걸러진 결과가 조용히
  사라지지 않는다. **랭킹 순서는 그대로다.** 기존 정렬 뒤에 얹는 단조 변환이라 계측 하네스의
  R@1·R@10·MRR이 변하지 않는다.

### Fixed
- **stale 판정이 추정에서 정확 판정으로** ([#201]). `mcp/README.md`가 남은 한계로 적어둔 항목이다 —
  캐시 fingerprint가 Rust `DefaultHasher`에서 나왔는데 std가 그 값의 안정성을 **명시적으로 보장하지
  않아** MCP 서버가 재현할 수 없었고, 그래서 mtime 비교로 물러섰다. 그 프록시는 **mtime이 움직이지
  않은 채 내용만 바뀐 파일을 놓친다** — 색인이 낡았는데 "최신"이라고 답하는 셈이라 "모르겠다"고
  답하는 것보다 나쁘다. 이제 해시가 명세된 FNV-1a 구성이고, 양쪽이 같은 문서화된 계약에서
  구현하며, `vault.rs`와 `mcp/fingerprint.test.ts`가 **동일한 벡터**로 고정한다. 응답에는
  `stale.changed`(정확한 판정)와 `stale.fingerprint`가 실린다.

  fingerprint 입력의 경로도 `/`로 정규화한다. 두 번째 문제가 함께 닫힌다 — 같은 vault가
  **macOS와 Windows에서 다른 fingerprint**를 내서, 양쪽에서 열면 매번 전체 재빌드였다.

  ⚠️ **캐시 버전 7 → 8.** 올린 뒤 첫 기동에서 인덱스를 한 번 전부 다시 만든다(19,000 노트 기준
  약 1분). 한 번뿐이다.

---

## [1.14.0] — 2026-08-26

### Added
- **Windows (x64) 지원** ([#196]). macOS와 나란히 Windows 10+에서 빌드·실행된다. CI의 Rust 검사·테스트도
  이제 **양쪽**에서 돈다. 세 가지를 고쳐야 했다. **경로** — Rust는 프런트에 `\` 구분자 문자열을 넘기는데
  프런트는 20여 곳에서 `/`로 쪼갠다. 게다가 Windows `canonicalize()`는 확장 길이 경로(`\\?\C:\...`)를
  낸다. 경계 헬퍼 하나(`uipath::to_ui`)가 둘 다 정규화하고, MCP 서버도 같은 계약(`normPath`)을 갖는다.
  **이미지** — 정적 asset 프로토콜 scope가 macOS 배치를 전제해서, vault가 사용자 폴더 밖(`D:\notes`)이면
  이미지가 **하나도** 안 떴다. 이제 열린 vault를 런타임에 등록한다 — 정적 scope보다 오히려 *좁다*.
  **단축키** — 존재하지도 않는 `⌘K`를 팔레트가 그대로 보여주고 있었다. 라벨과 샘플 노트를 표시 시점에
  `Ctrl+K`로 바꾼다.

### Fixed
- **지식 질의 MCP 서버가 Windows에서 캐시를 영영 찾지 못하던 것** ([#196]). 앱 데이터 경로가
  `~/Library/Application Support`로 박혀 있어, 인덱스가 멀쩡해도 모든 질의가 `cache_absent`로 답했다.

---

## [1.13.0] — 2026-08-24

### Changed
- **노트 하나를 고쳐도 기동 때 vault 전량을 다시 읽던 것** ([#192]). 캐시 키가 모든 파일의
  `(경로, mtime, 크기)`를 한 덩어리로 해싱한 값이라, 노트 한 개가 바뀌면 전부가 무효였다.
  작성자 vault 기준으로 그건 본문 **52.6 MB** 재읽기 + **약 5.3 s** 재색인인데, 실제 방아쇠는
  19,364개 중 **38개(0.2%)** 변경이다. vault를 쓰는 게 Lapis가 아니라 바깥 도구들이라 평상시
  기동의 대다수가 그 경로였다 — 최근 30일 중 **19일**에 변경이 있었다. 이제 기동 시 파일별 stat
  스냅샷을 이전 것과 대조해, 움직인 파일이 적으면 그것만 고친다(파일 watcher가 이미 쓰던 증분
  기계장치 그대로). 변경이 많거나, shard 수가 바뀌거나, 스냅샷이 없거나 어긋나면 예전처럼 전체를
  다시 만든다. 스냅샷은 매 기동 읽히는 메타데이터가 아니라 **별도 파일**에 둔다(gzip 231 KB,
  캐시의 +1.6%) — 바뀐 게 없는 vault는 추가 비용이 0이다.

### Fixed
- **검색 결과 스니펫이 매치된 본문 대신 노트의 YAML 머리말을 보여줄 수 있었다** ([#191]).
  랭킹은 한국어를 글자 bigram으로 찾는데 스니펫 추출기는 입력한 질의 그대로만 찾았다. 조사가
  다르면 — 질의 `인덱스로`, 본문 `인덱스를` — 매치가 0이 되고 폴백이 본문 앞 120자를 냈다.
  규약상 그 자리는 frontmatter 블록이다. 검색이 찾아낸 문서를 두고 왜 걸렸는지 못 보여준 셈이다.
  이제 어절 그대로 → 랭킹과 같은 bigram 순으로 내려가고, frontmatter에서는 시작하지 않는다.
- **vault를 바꾸면 이전 vault의 노트가 검색 결과로 새어 나올 수 있었다** ([#191]). vault를 열 때
  링크 인덱스는 비웠지만 풀텍스트 워커는 그대로 남았다. shard는 새 vault가 쓰는 것만 초기화되고
  shard 수는 노트 수를 따르므로, 큰 vault(8 shard) → 작은 vault(1 shard) 전환이면 shard 1–7이
  메모리에 남는다. 그리고 준비된 shard는 전부 질의에 답한다.
- **코드펜스 5종이 하이라이트 없이 그려졌다** ([#193]). vault 전량 실측: `svelte`(18개) ·
  `dart`(15) · `ruby`(7) · `http`(4) · `objective-c`(2). 앞 셋은 언어가 등록돼 있지 않았고,
  뒤 둘은 등록된 alias가 커버하지 않는 표기였다. `svelte`는 XML 문법에 연결했다 — 마크업과
  `<script>`/`<style>` 안쪽은 그대로 칠해진다.

## [1.12.2] — 2026-08-24

### Fixed
- **표가 가로로 터지고, 정작 줄이면 들어갈 열이 한 줄에 한 글자씩 접혔다** ([#189]). 인라인 코드에
  줄바꿈 선언이 없어 공백 없는 긴 경로(`dontalk/…/Foo.swift:1234`, brace 축약 `A/{B,C,D}`)가 끊을 곳
  없는 한 덩어리로 남았다. 문단에서는 페인 전체를 가로로 밀고, 표에서는 그 열의 최소 폭을 키워
  자동 레이아웃이 남은 폭을 다른 열에서 짜냈다 — 한글은 어느 글자에서나 끊기므로 그 압박이
  **한 줄에 한 글자**로, 높이 545px짜리 셀로 나타났다. 이제 인라인 코드에 `overflow-wrap: anywhere`가
  걸린다. 최소 폭까지 낮추는 값은 이것뿐이다(`break-word`는 낮추지 않아 표에는 듣지 않는다).
  코드블록은 배제해 그대로 가로 스크롤하고, 내보낸 HTML에도 같은 규칙이 실린다. 허브 실측: md
  1,301개 중 **321개(24.7%)**가 공백 없는 60자 초과 인라인 코드 토큰을 갖고 있다.

## [1.12.1] — 2026-08-21

### Fixed
- **다이어그램 하나가 깨지면 "Syntax error in text" 그림이 화면에 박혀 있었다** ([#187]). mermaid는
  자기 에러 그림을 `document.body`에 붙인 임시 `div`에 그리는데, 파싱이 실패하면 그 노드를 지우지
  않고 throw 한다. 그래서 폭탄 아이콘이 창 하단에 떠서 노트를 바꿔도 안 없어지고 앱을 재실행할
  때까지 남았다 — 화면에 열린 노트에 다이어그램이 없어도 그랬다. 잔해가 이전에 열었던 다른 노트에서
  온 것이기 때문이다. 이제 mermaid의 에러 렌더링을 끄고 임시 노드를 정리한다. 실패는 깨진 블록이
  있는 자리에 인라인으로 표시된다.

## [1.12.0] — 2026-08-21

### Fixed
- **속성 하나를 고치면 노트의 frontmatter가 통째로 날아갈 수 있었다** ([#184]). YAML 파싱이
  실패하면 앱이 "속성이 아예 없는 노트"로 읽고, 방금 고친 키만 남긴 블록을 새로 썼다 —
  나머지는 사라졌다. 이제는 쓰기를 거부하고 에디터에서 YAML을 먼저 고치라고 알린다.
  실측: 작성자 vault의 19,213개 노트 중 1개가 지금 정확히 그 상태다.
- **속성을 고칠 때마다 날짜가 다시 쓰였다** ([#184]). `created: 2026-08-13`이
  `2026-08-13T00:00:00.000Z`로 돌아왔다 — js-yaml 기본 스키마가 timestamp를 `Date` 객체로
  만들기 때문이다. 읽기·쓰기 모두 CORE 스키마를 쓰도록 바꿔 날짜가 문자열로 남는다.
  같은 결함이 UI에도 샜다: 속성 패널이 `Thu Aug 20 2026 09:00:00 GMT+0900`을 보여줬다.
- **frontmatter와 본문 사이의 빈 줄이 속성 편집 때마다 사라졌다** ([#184]) — 구분자 패턴이
  개행까지 삼켰다. 자동 링크 갱신도 같은 분리기를 써서 같은 결함을 갖고 있었다.

### Added
- **검색 계측 하네스가 품질뿐 아니라 비용도 게이트한다** ([#182]). `lapis-eval`이 R@1/R@10/MRR
  옆에 p50/p95/max 지연을 함께 내고, 긴 질의 프로브(16·32어절 — 품질 케이스로는 구성상
  만들어지지 않는다)를 더했으며, 지연 예산을 넘기면 종료 코드가 0이 아니다. 직전 변경이
  품질 지표를 전부 통과하면서 4배 느렸고, 그건 손측정으로 잡았다.
- **`lapis-bench`** ([#182]) — 인덱스 빌드 비용: 1,000노트당 밀리초, n/2→n 증가 배율(초선형
  회귀 감지), **노트당 JSON 바이트**. 크기가 주 게이트다 — 결정론적이라 15% 여유면 충분한
  반면, 바쁜 머신에서 오검출을 피할 만큼 느슨한 벽시계 예산은 토크나이저 회귀를 아예 못 잡는다.
- **frontmatter 파서 테스트 42건** ([#184], 그전엔 0건) + 헬퍼 호출을 통한 effect 의존성
  등록 테스트 1건 ([#185]).

### Changed
- **프리뷰 후처리 effect를 다시 썼다** ([#185]). 다섯 개의 `$effect`가 쓰지도 않는 변수에
  대입하는 방식으로 의존성을 선언하고 있었고(`const _html = parsed.html`), 이 관용구는 가드가
  앞으로 오면 조용히 깨진다. 이제 이름이 있는 `trackPreviewHtml()`을 부르고, 반복되던
  "널 체크 → `tick()` → 다시 널 체크 → 후처리" 절차는 헬퍼 하나로 모았다. 동작 변화는 없다 —
  위키링크 색·mermaid·테마 전환·`⌘F`를 손으로 확인했다.

## [1.11.0] — 2026-08-20

### Changed
- **풀텍스트 결합이 2단계에서 4단계로 늘었다.** 종전은 AND 다음 OR이었다 — 질의 단어 하나가
  정답 문서에 없으면 AND가 0건이 되고 통째로 OR로 떨어져 **평균 10,346건**(코퍼스의 53%)을
  긁어왔다. 절반쯤 기억하는 제목을 치는 건 예외가 아니라 기본 사용 패턴인데 그 경로가 가장
  나빴다. 중간에 두 단계를 넣었다 — `AND-1`(단어 하나를 빼고 AND)과 `OR-min`(OR 결과를 매칭
  term 수로 거름). 19,292 노트 · 360 케이스 실측에서 무관한 단어가 하나 섞인 질의의 매칭이
  **10,346건 → 220건(−98%)**, R@1은 **67.2% → 68.9%**. 깨끗한 질의는 완전히 그대로다 —
  새 단계는 AND가 0건일 때만 도달한다. `AND-1`은 O(n²)이라 **8어절 상한**을 뒀다 — 상한 없이는
  R@1이 1.1pt 높은 대신 **4배 느리다**(평균 118ms, 기존 29ms · 32어절 질의 860ms).
- MCP 응답 필드 `used[].combine`에 `AND-1`·`OR-min` 두 값이 추가됐다. `mcp/README.md` 참조.
- 설치 안내를 Releases 다운로드에서 소스 빌드로 교체. 바이너리 배포를 중단했다.
- **발행 문서의 기본 언어를 영어로 바꿨다.** `README.md`·`CHANGELOG.md`가 영어판이고
  한국어는 `README.ko.md`·`CHANGELOG.ko.md`다. 종전 `README.en.md`는 `README.md`로 옮겨졌다.

### Added
- **CI** — `.github/workflows/ci.yml`. PR과 `main` push에서 `svelte-check` · MCP 타입 체크 ·
  vitest · vite 빌드(ubuntu)와 `cargo fmt --check` · `cargo clippy`(경고를 오류로) ·
  `cargo check` · `cargo test`(macOS)를 돌린다.
- **`CHANGELOG.md`** — 이 문서. GitHub Releases를 쓰지 않으므로 릴리즈 노트를 대신한다.
- **DOM·반응성 테스트 프로젝트 신설**(`*.dom.test.ts`). 기존 node 프로젝트와 나란히 둔다.
  프리뷰 DOM 후처리와 Svelte effect 발화 시점을 **컴포넌트를 띄우지 않고** 잴 수 있다.
  카나리아를 함께 넣었다 — `resolve.conditions: ["browser"]`가 없으면 vitest가 SSR로 컴파일해
  `$effect`가 no-op이 되고 반응성 테스트가 전부 공허하게 통과한다. 카나리아가 그때 실패한다.
- **`⌘⇧F` 풀텍스트 검색이 구조 팔도 함께 낸다** — 걸리는 태그와 `doc_kind`/`topic` facet이 본문
  결과 아래에 붙는다. 종전엔 `⌘K`에만 있었다.
  짧은 질의를 도우려던 것인데 **실측 결과 그 효과는 없다**: 구조 팔의 어휘가 영문이다(고유 태그
  4,643개 중 한글 4개 · `topic` 299개 중 5개 · `doc_kind` 23개 중 0개). 점수가 나쁜 질의는
  한국어라 **둘은 만날 수 없다.** 실제로 돕는 건 어휘와 같은 언어로 친 질의다.
  짧은 한국어 질의는 여전히 미해결이고, 답은 여기가 아니다.
- **창 위치·크기가 재시작 너머로 유지된다.** 창마다 라벨 기준으로 자기 위치를 기억하므로,
  두 번째 창도 직전에 닫은 그 자리에 열린다. 그 창이 있던 모니터가 사라졌으면 화면 밖으로
  복원하지 않고 기본 위치로 떨어진다.

### Fixed
- `mcp/lapis-eval`이 표본 수 인자를 조용히 무시하던 것 — 래퍼가 `"$@"`를 안 넘겨 항상 기본값으로
  돌았다. 케이스 수가 다른 두 측정을 비교하고 나서야 드러났다.
- README의 릴리즈 배지가 죽어 있던 것 — 릴리즈를 전건 삭제해 `github/v/release`가 아무것도
  못 찾았다. 태그 기준 `github/v/tag`로 교체.

---

## [1.10.0] — 2026-08-19

UI 로컬라이제이션과 MCP 질의 토글. 저장소를 개인 계정으로 이전하면서 공개 저장소용 정리도 함께 했다.

### Added
- **UI 로컬라이제이션 (ko/en)** — Paraglide JS 2 기반, 원본 언어는 영어이고 한국어는 번역본이다.
  기본은 OS 언어 추종이며 설정에서 직접 고를 수도 있다. 메시지 309개 ([#171])
- **MCP 질의 토글** — 앱 설정에서 `lapis_query` 도구를 켜고 끈다. **기본은 차단**이고, 게이트는
  `tools/list`가 아니라 `tools/call`에 있어 재시작 없이 즉시 반영된다 ([#170])
- MIT LICENSE ([#166]), 영어 README와 언어 스위처 ([#168])

### Fixed
- 속성 자동완성 드롭다운이 컨텍스트 패널 바깥으로 나가지 못하고 잘리던 문제 ([#169])
- MCP 래퍼가 `PATH`에 의존해 Claude Desktop에서 서버가 뜨지 않던 문제 ([#163])
- 설정 부분 쓰기 — 일부 필드만 담아 저장하면 나머지 필드가 기본값으로 되돌아가던 문제.
  필드가 하나뿐이던 동안은 증상이 없었다 ([#170])

### Docs
- README 전면 재작성 + 저장소 URL 갱신 ([#165]), 개인 도구 면책 문구 ([#167])
- 검색 스택 기술 오류 정정 — README가 오랫동안 "tantivy + lindera"라고 적고 있었지만
  그 스택은 v1.3.0에서 제거됐다 ([#161], [#164])
- MCP 사용 가이드 추가 ([#162])

---

## [1.9.0] — 2026-08-13

지식 vault를 Claude Code에서 질의할 수 있게 열고, 그 과정에서 조용히 잘못 동작하던 캐시 결함들을 걷어냈다.

### Added
- **`lapis_query` MCP 서버** — 앱이 만든 인덱스 위에서 풀텍스트와 구조 질의(백링크·토픽·태그·doc_kind)를
  함께 낸다. 도구는 하나뿐이다 ([#156])
- 읽던 위치에서 편집 시작 — 읽기↔편집 전환 시 섹션 앵커를 이월한다 ([#154])

### Changed
- 풀텍스트 결합을 AND 우선 + OR 폴백으로 전환. 계측 결과 병목은 토크나이저가 아니라 결합 방식이었다 ([#159])

### Fixed
- 캐시 meta와 shard가 어긋나던 결함 6건 ([#155])
- 편집해도 디스크 캐시가 갱신되지 않던 문제 — 호출부 중복 게이트 ([#158])
- 개발 빌드와 릴리즈 빌드가 앱 데이터 디렉터리를 공유하던 것을 분리 ([#157])

---

## [1.8.0] — 2026-08-11

창 단위 멀티 vault와 읽기↔편집 단일 토글. 비활성 상태로 남아 있던 그래프 코드를 걷어냈다.

### Added
- **창마다 다른 vault** — watcher refcount + 창별 이벤트 라우팅
- ⌘T 새 탭 / ⌘P는 활성 탭 교체로 정리
- topbar 경로 라벨 클릭으로 절대 경로 복사

### Changed
- **Editor/Preview 분할을 제거하고 읽기↔편집 단일 토글로 전환**
- Editor 지연 로드 — 시작 payload 1089 KB → 543 KB
- 단축키 매칭을 `keymap.ts`로 분리 (테스트 27건), welcome 문서를 `welcomeDoc.ts`로 분리
- 비활성 그래프 기능 제거 (3,135줄)

### Fixed
- 새 창이 이전 vault를 그대로 열던 문제 — 창별 키를 지연 평가로 전환

---

## [1.7.0] — 2026-08-06

### Added
- 읽기 타이포그래피 교정 — 본문 폭 조절, 헤딩 위계, 문단 간격 ([#144])
- 디버그 빌드 표식 — 창 제목과 topbar 배지 ([#146])

### Fixed
- 페인 툴바 ⋯ 메뉴가 한 자씩 줄바꿈되던 문제 (v1.6.0 회귀) ([#145])

---

## [1.6.0] — 2026-08-05

UI 전면 개편. 채팅 앱(Discord)의 셸 레이아웃을 참조해 좌측 아이콘 레일 + 우측 컨텍스트 패널 구조로 바꿨다.

### Added
- 디자인 토큰 — 표면 3계층, radius 상향, 밀도 2단 ([#130])
- 좌측 아이콘 레일 상시화와 활성 섹션 표시 ([#132]), 우측 컨텍스트 패널 신설 ([#133])
- vault 헤더 드롭다운 + 하단 상태 줄 ([#139]), 레일 툴팁 ([#138])
- **안 본 사이 바뀐 노트 표시** — unread 은유 ([#140])
- 오버레이 등장/퇴장 모션 ([#137]), 탭 칩·카테고리 접기 모션 ([#141])

### Changed
- 하드보더 제거 + 표면 3계층 적용 ([#131]), 액센트 색 전환 ([#135])
- 신규 설치 기본 레이아웃을 Editor 접힘으로, topbar 슬림화 ([#134])
- 아이템 칩화 · 레일 pill 모프 · 카테고리 대문자 ([#136])

### Fixed
- 목차 항목 하단 잘림 + 섹션 배지 상한 9999+ ([#142])

---

## [1.5.0] — 2026-08-03

### Added
- Finder에서 보기 — 파일 트리·탭·Editor/Preview 전부에서 ([#127])
- 프리뷰 내용을 자립형 HTML로 내보내기 ([#128])
- 페인 툴바 ⋯ 오버플로 메뉴 ([#126])

---

## [1.4.0] — 2026-06-22

검색 품질과 응답성.

### Added
- **Quick Switcher 초성 검색** — 한국어 자음 매칭 ([#119])
- **풀텍스트 한국어 bigram 토크나이저** — 합성어·어미 변형 recall ([#120])
- 설정에 인덱스 강제 재구축 — 캐시 무시, 워커 초기화, 전체 재빌드 ([#123])

### Changed
- 팔레트 검색 디바운스 + 스니펫 지연 생성 ([#121])
- Quick Switcher 정규화 캐시 + 점진 필터링 ([#122])
- git 자동 커밋을 변경 경로만 `add` — 전체 워킹트리 스캔 회피 ([#118])

---

## [1.3.0] — 2026-06-18

### Removed
- **claude-mem 통합 기능 전체 제거** ([#117]). 이때 함께 쓰이던 **tantivy + lindera 형태소 검색 엔진도
  같이 빠졌다** — 이후 검색은 MiniSearch 단일 스택이다. README가 한동안 이 사실을 반영하지 못했고,
  v1.10.0에서야 정정됐다.

---

## [1.2.2] — 2026-06-18

### Changed
- 그래프 기능 일시 비활성화 — 3D 재설계 검토 ([#114])
- watcher 재인덱싱을 백그라운드로 — 실시간 변경 시 사이드바 blocking 제거 ([#113])

### Fixed
- mirror sync 표시가 영구 "진행중"으로 stuck 되던 문제 — 리스너 재등록 race ([#115])

---

## [1.2.1] — 2026-06-18

### Fixed
- **`strip_md_extension`의 UTF-8 문자 경계 panic** — 릴리즈 직후 즉시 크래시. 바이트 슬라이스 비교로 교체 ([#110])
- 인덱스 빌드 스피너 freeze, watcher가 검색 인덱스를 놓치던 문제 ([#111], [#112])

### Added
- 증분 인덱싱, `.mmd` watcher ([#112])

---

## [1.2.0] — 2026-06-15

vault를 git으로 버전 관리.

### Added
- vault git 버전관리 백엔드 — shell-out 명령 ([#104])
- 자동 커밋 + 버전관리 시작 배너 ([#105])
- git 이력 뷰어 — Neighborhood "History" 구획 ([#106])
- 설정에 Git 버전관리 진입점 — 배너를 "나중에"로 닫은 뒤 재접근 ([#107])

### Fixed
- git 명령이 IPC 스레드를 블로킹해 UI가 30초 freeze 되던 문제 — async + `spawn_blocking` ([#108])

---

## [1.1.0] — 2026-06-11

### Added
- betweenness 온디맨드 "다리 노트" 토글 ([#97]), 무방향 환산 + 가중 토글 ([#101])
- disparity filter 백본 모드 ([#98])
- 그래프 Global type(`doc_kind`) 필터 ([#100])
- MOC 자동제안 진단 패널 — MOC 후보·다리 노트·고아 노트 ([#102])
- 사이드바 펼친 섹션 드래그 리사이즈 ([#99])

---

## [1.0.0] — 2026-06-08

문서 단위 지식 그래프와 사이드바 재구성.

### Added
- frontmatter 타입 관계 인덱스 + Neighborhood 패널 ([#92])
- 필드 렌즈 그룹핑 — Files 탭 ([#93])
- 문서 단위 지식 그래프 — 데이터 모델과 Local/ego 모드 ([#94]), Global 모드와 인코딩 ([#95])
- 세로 아코디언 사이드바 네비 + 아이콘 레일 ([#96])

> 그래프 기능은 v1.2.2에서 비활성화되고 v1.8.0에서 코드까지 제거됐다. 현재 앱에는 없다.

---

## [0.12.1] — 2026-06-05

### Fixed
- 탭 우클릭 "다른 탭 닫기" 등이 동작하지 않던 버그 ([#90])

---

## [0.12.0] — 2026-06-04

### Added
- 노트 탭 영속화 — vault별 복원 ([#85])
- 탭 드래그 재정렬 + 우클릭 다른 탭 닫기 ([#86])
- 프리뷰 글꼴 크기(줌) 조절 ([#87])

### Fixed
- 앱 내 rename/delete/move 시 백링크 캐시 즉시 무효화 ([#88])

---

## [0.11.0] — 2026-06-04

노트 네비게이션 묶음.

### Added
- **위키링크 자동완성(`[[`)** — CodeMirror 자동완성 드롭다운 ([#79])
- 노트 뒤로/앞으로 가기 ([#80])와 히스토리 목록 드롭다운 ([#81])
- **노트 탭 (멀티 오픈)** ([#82])
- 즐겨찾기/핀 사이드바 탭 + 최근 노트 ([#83])

---

## [0.10.0] — 2026-06-02

### Added
- 문서 아웃라인(TOC) 패널 — 에디터·프리뷰 양방향 동기 ([#73])
- 노트 워드/글자수·읽기시간 topbar 표시 ([#72])
- 빈 frontmatter에서도 Properties를 추가할 수 있는 진입점 ([#77])

### Changed
- 간격 토큰화 — 정확일치 px를 `--sp-*`로 ([#74])
- 모달 셸 프리미티브 `ModalShell` + z-index 토큰 정규화 ([#75])
- 자동 링크 갱신의 코드영역 식별을 정규식에서 AST(markdown-it)로 ([#76])
- 아이콘 버튼을 `.btn--icon`으로 통합 ([#77])

---

## [0.9.1] — 2026-06-01

### Fixed
- Mermaid PNG 내보내기 — WKWebView canvas taint 회피 (blob → data URL) ([#71])

---

## [0.9.0] — 2026-06-01

### Added
- 프리뷰 코드블록 구문 하이라이팅 — highlight.js를 `--cm-*` 토큰에 연결 ([#68])

### Changed
- **디자인 시스템 전면 개편** — 토큰 도입 + 3-way 테마(라이트/다크/시스템) ([#64])
- 크기·형태 정규화 + 버튼 프리미티브 ([#67])

### Fixed
- 라이트 모드에서 Mermaid 다이어그램 가독성 — 테마 적응 렌더 ([#66])

---

## [0.8.0] — 2026-05-29

### Added
- Mermaid 다이어그램 PNG 내보내기 — hover 버튼에서 atomic 저장 ([#62])

---

## [0.7.0] — 2026-05-27

### Added
- 사이드바 접기/펼치기 — ⌘B, 헤더 버튼, 접힌 strip ([#60])

---

## [0.6.0] — 2026-05-21

큰 vault 대비 성능 묶음.

### Changed
- 검색 cold init 제거 + LRU 캐시 + release profile ([#49])
- vault cold-start 묶음 — `read_vault_bundle`(rayon) ([#50])
- MiniSearch 디스크 캐시 ([#51]), 캐시 gzip + `fullTextIndex` lazy load ([#52])
- 캐시 메타/JSON IPC 분리 + MiniSearch Web Worker ([#53])
- 파일 트리 가상 스크롤 ([#55])
- 검색 인덱스 sharded progressive load — 첫 shard 1.8초 뒤 부분 검색 가능 ([#56]),
  shard 수를 vault 크기로 동적 조정 ([#57])

### Added
- 현재 노트 절대 경로 복사 + 사이드바 트리 검색 필터 ([#54])

---

## [0.5.1] — 2026-05-19

### Added
- 백업 `max_keep`을 설정에서 노출 (1–100) ([#47])

### Removed
- 그래프 뷰 기능 완전 제거 — ADR-001 ([#45])

---

## [0.5.0] — 2026-05-18

### Added
- 링크 자동 갱신 dry-run 미리보기 + `.lapis` 스냅샷 백업 ([#42])
- 백업 prune(최대 20개) + write 실패 시 자동 롤백 ([#43])
- in-doc 검색 옵션 — regex / case / whole-word ([#39])
- vitest 도입 + linkRewrite 골든 테스트 ([#41])

---

## [0.4.0] — 2026-05-14

### Added
- F2 rename / ⌘⌫ 삭제, Properties 추가, 백링크 무효화 ([#34])
- Command Palette에 F2 보조 항목 + Mac 매직 키보드 안내 ([#35])
- `.mmd` 단일 파일 지원 ([#36])

---

## [0.3.0] — 2026-05-14

### Added
- claude-mem 세션 요약을 vault로 export, 메모리 FTS 검색과 관련 메모리 패널
- `lapis-mem.db` mirror + 실시간 sync 엔진
- tantivy + lindera 한국어 형태소 검색 엔진
- claude-mem 통합을 옵션화 (기본 OFF) ([#30])

> 이 문단의 기능은 **v1.3.0에서 전부 제거**됐다.

---

## [0.2.0] — 2026-05-12

첫 태그. Phase 0–5.0의 기반 기능이 모두 여기 들어 있다.

### Added
- Tauri 2 + SvelteKit + TypeScript 스캐폴딩, CodeMirror 6 + markdown-it + frontmatter PoC
- vault 열기, 파일 트리, 스크롤 동기화
- Wikilink + 백링크 패널 + 안전한 링크 navigation
- Quick Switcher(⌘P), 풀텍스트 검색(⌘⇧F), 태그 인덱스와 Files/Tags 탭
- 편집·저장(⌘S + autosave) + **atomic write**
- frontmatter 4키 스키마 인식, nested tags 계층 색인, `doc_kind`/`topic` facet 필터
- file watcher — 외부 변경 자동 감지 + 충돌 처리
- vault 조작(생성·삭제·rename·이동) + 자동 링크 갱신
- ⌘K 통합 명령 팔레트, 백링크 칩 펼침과 컨텍스트 스니펫
- frontmatter 인라인 편집, Mermaid 코드블록 인라인 렌더, 이미지 상대 경로와 발행물 갤러리
- 인-도큐먼트 검색 — Editor·Preview 각각 ⌘F

<!-- 링크 참조 -->

[Unreleased]: https://github.com/eren0315/lapis/compare/v1.15.0...main
[1.15.0]: https://github.com/eren0315/lapis/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/eren0315/lapis/compare/v1.13.0...v1.14.0
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

[#202]: https://github.com/eren0315/lapis/pull/202
[#201]: https://github.com/eren0315/lapis/pull/201
[#200]: https://github.com/eren0315/lapis/pull/200
[#199]: https://github.com/eren0315/lapis/pull/199
[#198]: https://github.com/eren0315/lapis/pull/198
[#196]: https://github.com/eren0315/lapis/pull/196
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
