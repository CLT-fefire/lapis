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
 * 파일 stem — 확장자(.md) 제외 파일명. 탭 라벨 등에 사용.
 * 예: "/vault/journal/daily.md" → "daily"
 */
export function noteStem(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  return last.replace(/\.md$/i, "");
}
