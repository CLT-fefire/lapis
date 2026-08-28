#!/usr/bin/env node
/**
 * `lapis-mcp` — stdio JSON-RPC MCP 서버. 도구 하나.
 *
 * SDK 의존성이 없다. 필요한 메서드가 `initialize` · `tools/list` · `tools/call` 셋이라
 * 프로토콜을 직접 다루는 게 의존성을 하나 더 지는 것보다 싸다.
 */

import { lapisQuery, type QueryArgs } from "./query.ts";
import { LapisError, mcpDisabledError, readMcpGate } from "./cache.ts";

const TOOL = {
  name: "lapis_query",
  description:
    "Lapis 앱이 만든 knowledge vault 인덱스를 질의한다. 19,000+ 마크다운. 판단하지 않고 인자를 그대로 실행한다.\n" +
    "\n" +
    "**구조 팔** (싸다, 항상 상주): doc_kind · topic · tag(nested prefix) · backlinks_of\n" +
    "**풀텍스트 팔** (BM25, 한글 bigram): text — 처음 쓸 때 1.4초 로드\n" +
    "\n" +
    "· 둘을 같이 주면 구조가 필터, BM25가 순위. 구조만 주면 그 집합 전건(랭킹 없음).\n" +
    "· `backlinks_of`는 본문 링크 ∪ frontmatter related/amends/superseded_by 를 합집합으로 낸다. " +
    "노트 이름만 줘도 해소된다(경로·확장자 불필요).\n" +
    "· 값을 모르면 먼저 `list`로 확인하라 — topic/tag 정확일치가 '전부 찾아라'의 완결성을 낸다.\n" +
    "· 과거 세션 아카이브(`_memories`, vault의 94%)는 **기본 제외**. 필요하면 include_archive:true.\n" +
    "· `audit`으로 vault 위생 다섯 가지를 물을 수 있다 — 앱·CLI와 **같은 판정**이다.\n" +
    "· 인덱스 생산자는 Lapis 앱이다. vault가 캐시보다 새로우면 `stale`로 실패한다 — 앱을 켜면 2초 안에 갱신된다.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "풀텍스트 질의 (BM25). 한글은 bigram, 영문은 3글자+ prefix" },
      doc_kind: { type: "string", description: "정확일치. plan · solution · adr · brainstorm · reference · spec · state 등. ⚠️ frontmatter 선언 기준이라 폴더와 다를 수 있다" },
      topic: { type: "string", description: "정확일치. 값은 list:\"topics\"로 확인" },
      tag: { type: "string", description: "nested prefix. `tech`를 주면 `tech/*` 전부. 값은 list:\"tags\"로 확인" },
      backlinks_of: {
        type: "string",
        description: "이 문서를 참조하는 문서들. vault 상대 경로 · 절대 경로 · 노트 이름 아무거나",
      },
      list: {
        type: "string",
        description:
          "facet 값을 빈도순으로 열거한다. 구조 인자에 뭘 넣을지 모를 때 먼저 호출. " +
          "`topics` · `tags` · `doc_kinds` · `fields`(어떤 frontmatter 축이 있나), " +
          "또는 임의 필드 이름(`status` 등)을 주면 그 필드의 값을 센다",
      },
      audit: {
        type: "string",
        enum: ["broken", "orphans", "unlinked", "tags", "props", "tasks"],
        description:
          "vault 진단 하나. broken=끊긴 링크 · orphans=아무도 안 가리키는 노트 · " +
          "unlinked=이름을 말했는데 링크는 안 건 자리 · tags=태그 중복+모호한 이름 · " +
          "props=거를 수 있는 축(doc_kind·topic 등)의 값이 갈린 곳 · " +
          "tasks=본문의 미완 `- [ ]`(코드 블록 안은 안 센다). " +
          "⚠️ unlinked·tasks 는 본문을 전부 읽어 느리다. 고치라고 하지 않고 보여주기만 한다",
      },
      sources: {
        type: "array",
        items: { type: "string", enum: ["bm25", "structural"] },
        description: "팔 한정. 생략하면 둘 다",
      },
      props: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string" } },
        description: "임의 frontmatter 축으로 거른다 — `{\"status\": [\"완료\",\"반영됨\"]}`. 같은 필드 안은 OR, 필드 사이는 AND. 그 필드가 **없는** 노트는 빠진다. 어떤 필드·값이 있는지는 `list:\"fields\"` 와 `list:\"<필드>\"` 가 답한다",
      },
      under: {
        type: "array",
        items: { type: "string" },
        description: "**이 아래에서만** — vault 상대 경로 문자열 prefix 배열. 여럿이면 OR. `exclude`와 같은 규칙이고, 겹치면 `exclude`가 이긴다. 한 vault에 프로젝트가 여럿일 때 쓴다",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "vault 상대 경로 **문자열 prefix** 배열. 디렉터리 경계가 아니라 문자열이라 `lapis/plans/lapis-cli-` 처럼 중간에서 끊어도 된다",
      },
      include_archive: { type: "boolean", description: "true면 `_memories` 기본 제외를 해제" },
      limit: { type: "number", description: "기본 10, 상한 50" },
      min_rel: {
        type: "number",
        description:
          "BM25 상대 점수 하한 [0,1]. 결과 행의 `rel`(그 질의 안에서 top-1=1.0)과 비교한다. raw `score`는 질의마다 스케일이 달라(63 vs 1,494) 임계값으로 못 쓴다. `used[].combine`이 OR·OR-min이라 결과가 넓을 때 꼬리를 자르는 용도. 자른 건수는 `used[].dropped_by_min_rel`",
      },
      since: {
        type: "string",
        description:
          "이 시점 이후만. 기간(`7d` · `24h` · `2w`) 또는 날짜(`2026-08-01`, UTC 자정). 시간 값이 없는 노트는 빠지고 `used[].dropped_no_time`에 건수가 남는다",
      },
      sort: {
        type: "string",
        enum: ["recent", "path", "score"],
        description:
          "결과 순서. 생략하면 점수가 있으면 점수순, 없으면 경로순. `score`는 text 질의에만 쓸 수 있다(구조 질의에는 점수가 없다)",
      },
      by: {
        type: "string",
        enum: ["mtime", "date"],
        description:
          "시간축. 기본 `mtime`(파일 수정 시각) · `date`(frontmatter). ⚠️ git pull·checkout이 mtime을 덮어쓰므로, git으로 동기화하는 vault에서는 `date`가 사실에 가깝다",
      },
      vault: { type: "string", description: "vault 루트 절대 경로. 여러 vault를 캐시한 경우 지정" },
    },
  },
} as const;

/**
 * 지원하는 프로토콜 버전. 클라이언트가 요청한 게 이 안에 있으면 그걸 되울리고,
 * 없으면 우리 최신을 돌려줘 클라이언트가 호환을 판단하게 한다(MCP 규약).
 * ⚠️ 예전엔 요청을 보지 않고 상수를 돌려줘서, 나중에 프로토콜이 바뀌면 원인이 서버
 * 하드코딩이라는 걸 알아채기 어려웠다.
 */
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(line: string): void {
  let req: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line);
  } catch {
    return; // 파싱 불가한 줄은 무시 — id가 없어 응답할 대상도 없다
  }
  const { id, method, params } = req;
  const reply = (result: unknown) => {
    if (id !== undefined) send({ jsonrpc: "2.0", id, result });
  };

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      const agreed =
        typeof asked === "string" && SUPPORTED_PROTOCOLS.includes(asked as never)
          ? asked
          : SUPPORTED_PROTOCOLS[0];
      return reply({
        protocolVersion: agreed,
        capabilities: { tools: {} },
        serverInfo: { name: "lapis-mcp", version: "1.0.0" },
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "tools/list":
      return reply({ tools: [TOOL] });
    case "tools/call": {
      if (params?.name !== TOOL.name) {
        if (id !== undefined) {
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool: ${params?.name}` } });
        }
        return;
      }
      try {
        // ⚠️ 게이트는 **호출마다** 본다. `tools/list`에서 도구를 숨기면 클라이언트가
        // 목록을 연결 시점에 캐시해 앱에서 토글해도 재시작 전엔 안 먹는다. 여기서
        // 판정하면 즉시 반영되고, 비용은 작은 JSON 파일 하나 읽기다.
        const gate = readMcpGate();
        if (!gate.enabled) throw mcpDisabledError(gate);
        const out = lapisQuery((params.arguments ?? {}) as QueryArgs);
        return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        // 실패는 **소리내어** 낸다 — kind + remedy. isError로 표시해 성공과 섞이지 않게.
        const payload =
          e instanceof LapisError
            ? e.toJSON()
            : { error: { kind: "internal", message: String((e as Error)?.message ?? e) } };
        return reply({ content: [{ type: "text", text: JSON.stringify(payload) }], isError: true });
      }
    }
    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } });
      }
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handle(line);
  }
});
