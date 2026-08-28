/**
 * 노트 경로 표시명 — 마지막 2개 segment를 " / "로 결합.
 * 예: "/vault/journal/daily.md" → "journal / daily.md"
 * topbar·히스토리 드롭다운 등에서 공유.
 */
export function noteDisplayName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-2).join(" / ");
}

/**
 * 앱이 노트로 다루는 확장자. `vault.rs` 의 `ensure_supported_extension` 과 같아야 한다.
 *
 * ⚠️ **`.mmd` 가 빠지면 조용히 틀린다.** `stores/vault.ts` 의 `renamePath` 가 이 함수로
 * 옛/새 stem 을 뽑아 링크 갱신에 넘기는데, `.mmd` 가 안 벗겨지면 `"diagram.mmd"` 로
 * 찾게 된다. 본문 위키링크는 `[[diagram]]` 이라 **매칭 0건 → 모달도 안 뜨고 조용히
 * 종료**한다. 이름은 바뀌고 링크는 옛 이름을 가리킨 채 남는다. 에러가 없다.
 *
 * ⚠️ 느슨하게(`/\.m?md$/`) 쓰지 않는다 — `.amd` 같은 것까지 벗긴다.
 */
const NOTE_EXT = /\.(md|mmd)$/i;

/**
 * 파일 stem — 지원 확장자를 뺀 파일명. 탭 라벨 · 링크 갱신 등에 쓴다.
 * 예: `/vault/journal/daily.md` → `daily`, `/vault/flow.mmd` → `flow`
 *
 * ⚠️ 확장자를 벗기는 곳은 **여기 하나**다. `noteStem.test.ts` 가 `.md` 만 보는 정규식이
 * 다시 생기는 것을 막는다 — 예전엔 규칙이 세 가지로 갈려 있었다.
 */
export function noteStem(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  return last.replace(NOTE_EXT, "");
}
