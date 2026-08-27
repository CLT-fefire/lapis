/**
 * CLI 표면의 **단일 출처** — 명령·옵션·설명이 여기 한 곳에만 있다.
 *
 * `--help` 출력, 인자 검증, 그리고 "이 명령에 핸들러가 있나" 테스트가 **모두 이 배열을
 * 읽는다.** 도움말을 손으로 따로 쓰면 곧 실제로 받는 옵션과 어긋나고, 그 어긋남은
 * 에러가 아니라 **잘못된 안내**로 나타나 아무도 신고하지 않는다.
 *
 * 사람이 읽을 설명(`desc`)은 짧게 둔다. 긴 근거는 `cli/README.md`에 있고, 터미널에서
 * 스크롤을 요구하는 도움말은 읽히지 않는다.
 */

export type OptionKind = "string" | "number" | "boolean" | "string[]";

export interface OptionSpec {
  name: string;
  kind: OptionKind;
  desc: string;
}

export interface PositionalSpec {
  name: string;
  required: boolean;
  desc: string;
}

export interface CommandSpec {
  name: string;
  desc: string;
  positional: PositionalSpec[];
  options: OptionSpec[];
}

/** 모든 명령이 받는 옵션. */
export const GLOBAL_OPTIONS: OptionSpec[] = [
  { name: "vault", kind: "string", desc: "vault 루트 절대 경로. 캐시에 여러 vault가 있을 때" },
  { name: "json", kind: "boolean", desc: "기계가 읽을 형태로. 스크립트·AI는 이걸 쓴다" },
  { name: "help", kind: "boolean", desc: "이 명령의 사용법" },
];

/**
 * 쓰기 명령의 낡은 인덱스 탈출구 — `tag rename` · `replace`가 공유한다.
 *
 * ⚠️ **읽기 명령에는 안 붙인다.** 읽기는 애초에 막지 않으므로(보고만 한다) 여기 옵션이
 * 있으면 아무 일도 안 하는 표면이 하나 는다.
 */
const ALLOW_STALE: OptionSpec = {
  name: "allow-stale",
  kind: "boolean",
  desc: "인덱스가 낡아도 쓴다. 새 노트가 빠질 수 있다",
};

const LIMIT: OptionSpec = {
  name: "limit",
  kind: "number",
  desc: "결과 수. 기본 10, 상한 50",
};

/**
 * 시간축 옵션 — `search` · `backlinks` · `links`가 공유한다.
 *
 * ⚠️ `GLOBAL_OPTIONS`에 올리지 않는다. `status` · `index` · `open`의 도움말에 무의미한
 * 옵션이 뜨고, 도움말이 길어지면 읽히지 않는다. `LIMIT`이 이미 같은 패턴이다.
 */
const TIME_OPTS: OptionSpec[] = [
  {
    name: "since",
    kind: "string",
    desc: "이 시점 이후만. 7d · 24h · 2w · 2026-08-01 (links는 --orphans에만)",
  },
  {
    name: "sort",
    kind: "string",
    desc: "recent | path | score. score는 질의가 있을 때만 (links는 --orphans에만)",
  },
  {
    name: "by",
    kind: "string",
    desc: "시간축. mtime(기본) | date(frontmatter). git이 mtime을 덮어쓴다",
  },
];

export const COMMANDS: CommandSpec[] = [
  {
    name: "search",
    desc: "풀텍스트(BM25) + 구조 필터. MCP의 lapis_query와 같은 랭킹",
    positional: [{ name: "질의", required: false, desc: "풀텍스트 질의. 생략하면 구조 필터만" }],
    options: [
      LIMIT,
      { name: "tag", kind: "string", desc: "nested prefix — tech를 주면 tech/* 전부" },
      { name: "doc-kind", kind: "string", desc: "정확 일치. frontmatter 선언 기준" },
      { name: "topic", kind: "string", desc: "정확 일치" },
      { name: "min-rel", kind: "number", desc: "상대 점수 하한 0~1. 결과가 넓을 때 꼬리를 자른다" },
      { name: "exclude", kind: "string[]", desc: "vault 상대 문자열 prefix. 여러 번 줄 수 있다" },
      { name: "include-archive", kind: "boolean", desc: "_memories 기본 제외를 해제" },
      ...TIME_OPTS,
    ],
  },
  {
    name: "backlinks",
    desc: "이 문서를 참조하는 문서들. 본문 링크 ∪ frontmatter cross-ref",
    positional: [{ name: "노트", required: true, desc: "경로 · 노트 이름 아무거나" }],
    options: [
      LIMIT,
      { name: "include-archive", kind: "boolean", desc: "_memories 제외 해제" },
      ...TIME_OPTS,
    ],
  },
  {
    name: "list",
    desc: "facet 값을 빈도순 열거",
    positional: [{ name: "facet", required: true, desc: "tags | topics | doc-kinds" }],
    options: [LIMIT],
  },
  {
    name: "links",
    desc: "링크 감사. --broken · --orphans · --unlinked 중 하나를 고른다",
    positional: [],
    options: [
      {
        name: "broken",
        kind: "boolean",
        desc: "어느 노트로도 해소되지 않는 본문 링크. 대상별로 묶어 참조 수 순",
      },
      {
        name: "orphans",
        kind: "boolean",
        desc: "들어오는 링크가 없는 노트. 끊긴 링크의 거울상이다",
      },
      {
        name: "unlinked",
        kind: "boolean",
        desc: "다른 노트 이름을 말했는데 링크는 없는 곳. 본문을 읽으므로 느리다",
      },
      ...TIME_OPTS,
    ],
  },
  {
    name: "tag",
    desc: "태그 이름 바꾸기·병합. 하위 태그도 따라 움직인다",
    positional: [
      { name: "동작", required: true, desc: "rename | audit" },
      { name: "이전", required: false, desc: "rename 전용 — 바꿀 태그" },
      { name: "새이름", required: false, desc: "rename 전용 — 새 태그" },
    ],
    options: [
      {
        name: "apply",
        kind: "boolean",
        // ⚠️ 기본이 dry-run인 게 요점이다. 되돌릴 수 없는 쓰기를 인자 하나 빠뜨렸다고
        // 실행하면 안 된다. 앱 쪽도 미리보기 → 확인 순서를 강제한다.
        desc: "실제로 쓴다. 없으면 미리보기만 (기본)",
      },
      ALLOW_STALE,
    ],
  },
  {
    name: "props",
    desc: "frontmatter 값 위생 — 거를 수 있는 축이 갈렸는지",
    positional: [{ name: "동작", required: true, desc: "audit" }],
    options: [],
  },
  {
    name: "css",
    desc: "사용자 정의 CSS를 끈다 — 앱이 안 뜰 때의 탈출구",
    positional: [],
    options: [
      {
        name: "off",
        kind: "boolean",
        desc: "적용을 끈다. CSS 내용은 지우지 않는다",
      },
    ],
  },
  {
    name: "doctor",
    desc: "vault 건강 검진 — 감사 넷 + 인덱스 낡음을 한 번에. 본문을 읽으므로 느리다",
    positional: [],
    options: [],
  },
  {
    name: "status",
    desc: "어느 vault를 어느 캐시로 읽는지, 낡았는지",
    positional: [],
    options: [],
  },
  {
    name: "open",
    desc: "실행 중인 앱에서 이 노트를 연다. 앱이 꺼져 있으면 켠다",
    positional: [{ name: "노트", required: true, desc: "경로 · 노트 이름 아무거나" }],
    options: [],
  },
  {
    name: "replace",
    desc: "vault 전체 찾아 바꾸기. **기본은 dry-run**, --apply가 있어야 쓴다",
    positional: [
      { name: "패턴", required: true, desc: "찾을 것. 기본은 리터럴, --regex로 정규식" },
      { name: "치환", required: true, desc: "바꿀 것. --regex면 $1 캡처 참조가 듣는다" },
    ],
    options: [
      {
        name: "apply",
        kind: "boolean",
        // ⚠️ `tag rename`과 같은 규율이다. 되돌릴 수 없는 쓰기를 인자 하나 빠뜨렸다고
        // 실행하면 안 된다.
        desc: "실제로 쓴다. 없으면 미리보기만 (기본)",
      },
      { name: "regex", kind: "boolean", desc: "패턴을 정규식으로. . 은 줄바꿈을 안 넘는다" },
      { name: "ignore-case", kind: "boolean", desc: "대소문자 무시" },
      { name: "whole-word", kind: "boolean", desc: "단어 경계로 감싼다" },
      { name: "path", kind: "string", desc: "vault 상대 경로 접두로 대상을 좁힌다" },
      ALLOW_STALE,
    ],
  },
  {
    name: "index",
    desc: "앱 없이 인덱스를 다시 만든다. 앱을 켜면 그대로 읽는다",
    positional: [],
    options: [
      {
        name: "dry-run",
        kind: "boolean",
        desc: "만들어만 보고 캐시에 쓰지 않는다. 규모·시간 가늠용",
      },
      {
        name: "allow-version-skew",
        kind: "boolean",
        desc: "앱의 캐시 버전이 달라도 진행. 만든 캐시는 이 CLI와 MCP가 못 읽는다",
      },
    ],
  },
];

export const FACETS = ["tags", "topics", "doc-kinds"] as const;

/**
 * `tag` 명령이 받는 동작.
 *
 * ⚠️ `rename`만 `이전`·`새이름`을 요구한다. 그래서 위치 인자는 spec에서 **선택**으로 두고
 * 동작별 검사는 핸들러가 한다 — 파서는 "동작이 무엇이냐"를 모른다.
 */
export const TAG_ACTIONS = ["rename", "audit"] as const;

/** `props` 명령이 받는 동작. 지금은 하나뿐이지만 `tag`와 같은 모양을 지킨다. */
export const PROPS_ACTIONS = ["audit"] as const;

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** 이 명령이 받는 옵션 전부(전역 포함). 검증과 도움말이 같은 목록을 본다. */
export function optionsFor(cmd: CommandSpec): OptionSpec[] {
  return [...cmd.options, ...GLOBAL_OPTIONS];
}
