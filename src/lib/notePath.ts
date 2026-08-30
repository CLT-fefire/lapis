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
 * 앱이 노트로 다루는 확장자. `vault.rs` 의 `ensure_supported_extension` ·
 * `already_has_supported_ext` 와 **같은 답**이어야 한다.
 *
 * ⚠️ **`.mmd` 가 빠지면 조용히 틀린다.** `stores/vault.ts` 의 `renamePath` 가 stem 을
 * 뽑아 링크 갱신에 넘기는데, `.mmd` 가 안 벗겨지면 `"diagram.mmd"` 로 찾게 된다.
 * 본문 위키링크는 `[[diagram]]` 이라 **매칭 0건 → 모달도 안 뜨고 조용히 종료**한다.
 * 이름은 바뀌고 링크는 옛 이름을 가리킨 채 남는다. 에러가 없다.
 *
 * ⚠️ 느슨하게(`/\.m?md$/`) 쓰지 않는다 — `.amd` 같은 것까지 벗긴다.
 *
 * 🔴 **`markdown` 은 여기 없다.** Rust 인덱서가 안 받는다. 예전엔 네 곳이
 * `/\.(md|mmd|markdown)$/i` 로 벗기고 있었다 — 생산자가 만들지도 않는 것을 소비자가
 * 벗기는 비대칭이었다.
 */
export const NOTE_EXTENSIONS = ["md", "mmd"] as const;

/**
 * 🔴 **확장자 규칙이 사는 유일한 자리.** 밖에서 다시 쓰지 않는다 —
 * `scripts/arch-gate.mjs` 의 `note-ext-single-owner` 가 막는다.
 *
 * ⚠️ 주석으로만 "여기 하나"라고 적어 뒀던 때가 있었는데, 그 사이에 네 곳이 자기
 * 정규식을 갖게 됐고 그중 셋이 틀렸다. **주석은 규칙을 못 지킨다.**
 */
const NOTE_EXT = new RegExp(`\\.(${NOTE_EXTENSIONS.join("|")})$`, "i");

/** 이 이름이 노트 파일인가. 경로가 섞여 있어도 마지막 조각으로 본다. */
export function hasNoteExt(name: string): boolean {
  return NOTE_EXT.test(lastSegment(name));
}

/**
 * 붙어 있는 확장자를 **원문 그대로** 돌려준다. 노트가 아니면 `null`.
 *
 * ⚠️ 대소문자를 보존한다 — 링크를 되쓸 때 원문을 바꾸면 안 된다.
 */
export function noteExtOf(name: string): string | null {
  const m = NOTE_EXT.exec(lastSegment(name));
  return m ? m[1] : null;
}

/**
 * 이름에 확장자를 붙인다. **이미 지원 확장자가 있으면 그대로 둔다.**
 *
 * 🔴 예전엔 `raw.endsWith(".md") ? raw : raw + ".md"` 였다 —
 * `lapis new diagram.mmd` 가 **`diagram.mmd.md`** 를 만들었다.
 */
export function withNoteExt(name: string): string {
  return hasNoteExt(name) ? name : `${name}.${NOTE_EXTENSIONS[0]}`;
}

/**
 * 파일명에서 확장자만 뗀다. **경로는 안 자른다** — 부르는 쪽이 이미 basename 인 경우가 있다.
 * 경로째 넘겨 stem 만 원하면 `noteStem` 을 쓴다.
 */
export function stripNoteExt(name: string): string {
  return name.replace(NOTE_EXT, "");
}

/**
 * 파일 stem — 지원 확장자를 뺀 파일명. 탭 라벨 · 링크 갱신 등에 쓴다.
 * 예: `/vault/journal/daily.md` → `daily`, `/vault/flow.mmd` → `flow`
 */
export function noteStem(path: string): string {
  return stripNoteExt(lastSegment(path));
}

function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
