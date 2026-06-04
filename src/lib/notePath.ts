/**
 * 노트 경로 표시명 — 마지막 2개 segment를 " / "로 결합.
 * 예: "/vault/journal/daily.md" → "journal / daily.md"
 * topbar·히스토리 드롭다운 등에서 공유.
 */
export function noteDisplayName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-2).join(" / ");
}
