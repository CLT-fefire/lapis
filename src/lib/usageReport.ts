import type { UsageSummary } from "$lib/usageAnalyzer";

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

/** `1234` → `1.2초`, 작은 값은 ms 그대로. */
function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}초` : `${Math.round(v)}ms`;
}

/** 세션 길이 — 분 단위가 읽기 쉽다. */
function minutes(v: number): string {
  const m = v / 60000;
  return m >= 60 ? `${(m / 60).toFixed(1)}시간` : `${m.toFixed(0)}분`;
}

export function buildUsageReport(s: UsageSummary, opts: ReportOptions = {}): string {
  const top = opts.top ?? 20;
  const out: string[] = [];

  out.push(`# 사용 통계${opts.label ? ` — ${opts.label}` : ""}`);
  out.push("");
  out.push(
    "> 앱이 기동할 때 로그 옆에 자동으로 쓴다. **경로와 검색어가 그대로 들어 있다** — " +
      "이 컴퓨터를 안 벗어나므로 가리지 않는다. 공개된 곳에 붙여넣기 전에는 지울 것.",
  );
  out.push("");
  out.push("| | |");
  out.push("|---|---|");
  out.push(`| 기간 | ${day(s.from)} ~ ${day(s.to)} |`);
  out.push(`| 이벤트 | ${s.events.toLocaleString()} |`);
  out.push(`| 세션 | ${s.sessions} |`);
  if (s.avgSessionMs !== null) {
    out.push(`| 세션 평균 길이 | ${minutes(s.avgSessionMs)} |`);
  }
  out.push(`| 오류 · 경고 | ${s.errorCount} · ${s.warnCount} |`);
  if (s.unreadable > 0) {
    // ⚠️ 못 읽은 줄을 조용히 빼면 통계가 거짓말이 된다.
    //    🔴 **손상과 "모르는 종류"를 갈라 적는다.** 후자는 더 새 버전이 쓴 줄이라는
    //    뜻이지 손상이 아니다 — 합쳐 적으면 멀쩡한 로그를 손상이라고 말하게 된다.
    if (s.malformed > 0) out.push(`| ⚠️ 깨진 줄 | ${s.malformed} |`);
    if (s.unknownKind > 0) {
      out.push(`| 모르는 종류 | ${s.unknownKind} (더 새 버전이 쓴 줄 — 손상이 아니다) |`);
    }
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
    out.push("| 심각도 | 자리 | 무엇 | 횟수 | 마지막 |");
    out.push("|---|---|---|---:|---|");
    for (const e of s.errors.slice(0, top)) {
      // ⚠️ 심각도를 별도 열로 낸다. 예전엔 `msg` 앞의 `warn: ` 접두사가 그 일을 했다.
      const lvl = e.lvl === "warn" ? "경고" : "오류";
      out.push(`| ${lvl} | \`${e.at}\` | ${e.msg} | ${e.count} | ${day(e.lastAt)} |`);
    }
    if (s.errors.length > top) {
      out.push("");
      out.push(`외 ${s.errors.length - top}종.`);
    }
  }
  out.push("");

  // ─── 검색 ────────────────────────────────────────────────────────────────
  out.push("## 검색");
  out.push("");
  const qTotal = Object.values(s.queries.byKind).reduce((a, b) => a + b, 0);
  if (qTotal === 0) {
    out.push("아직 기록이 없다.");
  } else {
    out.push(`질의 ${qTotal}건 — ${viaLine(s.queries.byKind)}`);
    if (s.queries.missRate !== null) {
      // 🔴 결과가 있었는데 아무것도 안 열었으면 **못 찾은 것**이다.
      out.push("");
      out.push(`결과가 있었는데 아무것도 안 연 비율: **${(s.queries.missRate * 100).toFixed(0)}%**`);
    }
    if (s.queries.empty.length > 0) {
      out.push("");
      out.push("### 결과가 0건이던 질의");
      out.push("");
      out.push("> 반복되는 것이 곧 개선 지점이다 — 그 낱말이 vault 에 없는 것인지,");
      out.push("> 검색이 못 찾는 것인지를 가른다.");
      out.push("");
      out.push("| 질의 | 어디서 | 횟수 |");
      out.push("|---|---|---:|");
      for (const q of s.queries.empty.slice(0, top)) {
        // ⚠️ 질의문은 **질의 규칙으로** 가린다 — 경로 규칙으로는 안 가려진다.
        out.push(`| ${q.q} | ${q.kind} | ${q.count} |`);
      }
    }
  }
  out.push("");

  // ─── 열람 ────────────────────────────────────────────────────────────────
  out.push("## 자주 여는 노트");
  out.push("");
  if (s.opens.length === 0) {
    out.push("아직 기록이 없다.");
  } else {
    out.push(`어떻게 닿았나 — ${viaLine(s.openVia)}`);
    out.push("");
    out.push("| 노트 | 횟수 | 어느 입구로 |");
    out.push("|---|---:|---|");
    for (const o of s.opens.slice(0, top)) {
      out.push(`| ${o.path} | ${o.total} | ${viaLine(o.via)} |`);
    }
    if (s.opens.length > top) {
      out.push("");
      out.push(`외 ${s.opens.length - top}개.`);
    }
  }
  out.push("");

  // ─── 성능 ────────────────────────────────────────────────────────────────
  out.push("## 성능");
  out.push("");
  if (s.perf.length === 0) {
    out.push("아직 기록이 없다.");
  } else {
    // ⚠️ **최댓값을 같이 낸다.** 평균만 보면 드문 느림이 묻힌다.
    out.push("| 무엇 | 횟수 | 평균 | 최대 |");
    out.push("|---|---:|---:|---:|");
    for (const perf of s.perf) {
      out.push(
        `| \`${perf.op}\` | ${perf.count} | ${ms(perf.avgMs)} | ${ms(perf.maxMs)} |`,
      );
    }
  }
  out.push("");
  return out.join("\n");
}
