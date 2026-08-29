/**
 * 팔레트 명령의 **id 목록** — 구현과 떼어 둔다.
 *
 * ## 🔴 왜 따로 있나
 *
 * 명령 목록이 `commands.ts` 하나에만 있었다. 그 파일은 `svelte/store` · paraglide ·
 * 앱 스토어를 물기 때문에 **Node 에서 못 읽는다.** 그래서 CLI 와 MCP 는 사용 기록을
 * 집계할 때 "앱이 아는 명령"을 분모로 못 줬고, `unusedCommands` 가 늘 빈 배열이었다 —
 * 명령이 0건 쓰인 로그를 두고 **"안 쓴 명령이 없다"** 고 답했다.
 *
 * 여기엔 id 만 둔다. 라벨도 단축키도 실행도 `commands.ts` 몫이다.
 *
 * ## ⚠️ import 를 하나도 넣지 않는다
 *
 * 하나라도 생기는 순간 이 파일이 앱 트리를 끌고 오고, 헤드리스 소비자가 다시 못 읽게
 * 된다 — 애초에 이 파일을 만든 이유가 사라진다. 테스트가 그걸 지킨다.
 *
 * ## ⚠️ 두 벌이 되면 갈린다
 *
 * 목록을 뗀 대가로 "실제 명령"과 "id 목록"이 둘이 됐다. 두 방향으로 막는다:
 *
 * - **목록에 없는 id 를 만들면** → `Command["id"]` 가 `CommandId` 유니온이라 컴파일 오류
 * - **목록에만 있고 안 만들면** → `commandIds.test.ts` 가 소스에서 뽑아 비교한다
 */
export const COMMAND_IDS = [
  "audit-orphans",
  "audit-props",
  "audit-tags",
  "audit-unlinked",
  "broken-links",
  "copy-current-note-path",
  "delete-current-note",
  "new-note",
  "new-tab",
  "new-window",
  "open-vault",
  "reload-vault",
  "rename-current-note",
  "reopen-tab",
  "reset-layout",
  "table-view",
  "tag-rename",
  "toggle-context-panel",
  "toggle-main-pane",
  "toggle-sidebar",
  "vault-grep",
] as const;

/** 팔레트가 아는 명령 id. 여기 없는 값은 컴파일이 안 된다. */
export type CommandId = (typeof COMMAND_IDS)[number];
