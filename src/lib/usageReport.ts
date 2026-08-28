import { redact, type UsageSummary } from "$lib/usageEvent";

/**
 * 사용 요약 → **마크다운 리포트**.
 *
 * ## ⚠️ 여기가 가림의 경계다
 *
 * 로그 원본은 자세하다 — 로컬 파일이고 나중에 기능 개선에 쓴다. 사고는 원본이 아니라
 * **이 문서를 어딘가에 붙여넣는 순간** 난다. 이 저장소는 공개이고, vault 경로는 구조를
 * 그대로 드러낸다.
 *
 * 그래서 **기본이 가림**이고, 원본을 내보내려면 `{ raw: true }` 를 **명시**해야 한다.
 * 반대로 두면(기본 원본, 옵션으로 가림) 급할 때 안전한 쪽을 놓친다.
 */

export interface ReportOptions {
  /** 원본 그대로. ⚠️ 경로·검색어가 문서에 남는다. */
  raw?: boolean;
  /** 몇 위까지. 기본 20. */
  top?: number;
  /** 문서 머리에 적을 기간 이름(`2026-08`). */
  label?: string;
}

function day(t: number | null): string {
  if (t === null) return "—";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 입구 분포를 한 줄로 — `keymap 380 · palette 12`. */
function viaLine(via: Record<string, number>): string {
  return Object.entries(via)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
}

export function buildUsageReport(s: UsageSummary, opts: ReportOptions = {}): string {
  const raw = opts.raw === true;
  const top = opts.top ?? 20;
  const hide = (t: string) => (raw ? t : redact(t));
  const out: string[] = [];

  out.push(`# 사용 통계${opts.label ? ` — ${opts.label}` : ""}`);
  out.push("");
  out.push(
    raw
      ? "> ⚠️ **원본 그대로다.** 경로와 검색어가 그대로 들어 있다 — 공개된 곳에 붙여넣지 말 것."
      : "> 경로는 마지막 조각만 남기고 가렸다. 원본이 필요하면 `raw` 로 다시 내보낸다.",
  );
  out.push("");
  out.push("| | |");
  out.push("|---|---|");
  out.push(`| 기간 | ${day(s.from)} ~ ${day(s.to)} |`);
  out.push(`| 이벤트 | ${s.events.toLocaleString()} |`);
  out.push(`| 세션 | ${s.sessions} |`);
  if (s.unreadable > 0) {
    // ⚠️ 못 읽은 줄을 조용히 빼면 통계가 거짓말이 된다.
    out.push(`| ⚠️ 못 읽은 줄 | ${s.unreadable} |`);
  }
  out.push("");

  out.push("## 많이 쓰는 명령");
  out.push("");
  if (s.commands.length === 0) {
    out.push("아직 기록이 없다.");
  } else {
    out.push("| 명령 | 횟수 | 어느 입구로 |");
    out.push("|---|---:|---|");
    for (const c of s.commands.slice(0, top)) {
      out.push(`| \`${c.id}\` | ${c.total} | ${viaLine(c.via)} |`);
    }
    if (s.commands.length > top) {
      out.push("");
      out.push(`외 ${s.commands.length - top}개.`);
    }
  }
  out.push("");

  out.push("## 한 번도 안 쓴 명령");
  out.push("");
  if (s.unusedCommands.length === 0) {
    out.push("없다 — 있는 명령을 전부 한 번은 썼다.");
  } else {
    out.push("> 지워도 되는지, 아니면 **닿을 길이 없는지**를 가르는 목록이다.");
    out.push("");
    for (const id of s.unusedCommands) out.push(`- \`${id}\``);
  }
  out.push("");

  out.push("## 오류");
  out.push("");
  if (s.errors.length === 0) {
    out.push("없다.");
  } else {
    out.push("| 자리 | 무엇 | 횟수 | 마지막 |");
    out.push("|---|---|---:|---|");
    for (const e of s.errors.slice(0, top)) {
      out.push(`| \`${e.at}\` | ${hide(e.msg)} | ${e.count} | ${day(e.lastAt)} |`);
    }
    if (s.errors.length > top) {
      out.push("");
      out.push(`외 ${s.errors.length - top}종.`);
    }
  }
  out.push("");
  return out.join("\n");
}
