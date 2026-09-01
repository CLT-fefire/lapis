/**
 * 검색 품질·지연 기준선 러너 — `./lapis-eval [표본수]`.
 *
 * 현행 설정(AND → AND-1 → OR-min → OR)을 **깨끗한 질의**와 **오염 질의**(정답에 없는 단어
 * 1개) 양쪽에서 잰다. 검색 설정을 건드릴 때 이걸 먼저 돌려 회귀를 본다.
 *
 * ⚠️ **품질만 재던 하네스였다.** 2026-08-19에 `AND-1`을 넣을 때 R@1·R@10·MRR·결과수를
 * 전부 통과한 변형이 평균 29→118ms(32어절 860ms)였고, 게이트에 지연이 없어 **손측정으로
 * 발견**했다. 손측정은 다음 사람에게 남지 않는다 → 지연을 같은 표에 넣고 예산으로 막는다.
 *
 * ⚠️ 이 하네스는 "기억하는 문서를 다시 찾기"만 잰다. "이 주제 문서 전부" 같은 탐색형은
 * 구조 팔(`topic`/`tag`)이 담당하고 이 수치와 무관하다.
 *
 * 종료 코드: 예산 위반이 하나라도 있으면 **1**. 품질 지표는 판정하지 않는다(표본·vault에
 * 따라 흔들리고, 판단이 필요한 값이라 사람이 본다). 지연은 판정한다 — 4배는 판단할 여지가 없다.
 */
import {
  buildCases,
  buildLongQueries,
  latencyOf,
  loadLiveIndex,
  resolveVault,
  summarize,
  type CaseResult,
} from "./searchEval.ts";
import { readDevArgs } from "./devArgs.ts";
import { unionRankDetailed } from "../core/entry.ts";

/**
 * 지연 예산(ms). 이 머신(M-series · 19,313 노트 · 8샤드) 실측의 **2.5~3배**로 잡았다.
 *
 * | 항목 | 출하 설정 실측 | 카나리아(`AND1_MAX_WORDS = 999`) | 예산 |
 * |---|---:|---:|---:|
 * | 인덱스 로드 | 883ms | — | 2500 |
 * | 오염 질의 p95 | 91ms | **370ms** | 300 |
 * | 16어절 max | 167~222ms | **1,080ms** | 700 |
 * | 32어절 max | 241~280ms | **3,714ms** | 700 |
 *
 * (프로브 실측이 범위인 이유: 프로브 건수는 표본과 무관하게 30건인데, `./lapis-eval 150`은
 * 앞선 846건을 돌고 오므로 같은 질의가 더 느리게 나온다. 넓은 쪽을 기준으로 예산을 잡았다.)
 *
 * **2.5~3배인 이유**: 잡으려는 회귀가 4~15배다. 그보다 촘촘하면 다른 프로세스가 도는
 * 머신에서 오검출이 나고, "부하 때문"과 "코드 때문"이 섞이면 게이트를 아무도 안 믿는다.
 *
 * ⚠️ **카나리아로 죽여서 확인한 값이다.** 상한을 999로 올려 실제로 3건이 빨갛게 뜨는 것을
 * 보고 되돌렸다. 그 과정에서 프로브 설계 결함도 하나 나왔다(원문 그대로는 `AND`가 걸려
 * 사다리를 안 내려간다 → 프로브도 오염시킨다). 새 검증 장치는 죽여 보기 전엔 통과가
 * 통과라는 증거가 아니다.
 *
 * ⚠️ **vault 규모가 크게 달라지면 다시 재야 한다** — 절대값이라 노트 수에 따라간다.
 * 표 위 출력에 노트 수와 샤드 수가 함께 찍히는 이유다.
 */
const BUDGET = {
  noisyP95Ms: 300,
  probeMaxMs: 700,
  /** 캐시에서 8샤드를 `MiniSearch.loadJSON`하는 비용 = 앱 cold-start의 검색 준비 구간. */
  indexLoadMs: 2500,
};

/** 긴 질의 프로브 — 어절 수별로 몇 건씩. 32어절이 O(n²) 병리를 재현하던 지점이다. */
const PROBE_WORDS = [16, 32] as const;
const PROBE_COUNT = 30;

const args = readDevArgs(process.argv.slice(2), { defaultSample: 150, name: "lapis-eval" });
const vc = resolveVault(args.vault);
const clean = buildCases(vc, args.sample);

/**
 * ⚠️ **잰 것이 없으면 통과라고 말하지 않는다.**
 *
 * 예전엔 `Number(process.argv[2])`가 `NaN`이면 `slice(0, NaN)`이 빈 배열이 되어 **케이스
 * 0건**으로 돌았고, 품질 칸이 전부 `NaN%`인 채 마지막 줄에 ✅를 내며 0으로 끝났다.
 * `./mcp/lapis-eval --vault <경로>` 한 번으로 그 상태가 된다.
 *
 * 측정 도구는 다른 판단의 근거다. 여기서 통과라고 말하면 **아무것도 비교하지 않은 결론**이
 * 근거로 쓰인다.
 *
 * ⚠️ 0보다 큰 임계값은 두지 않는다. "50건 미만이면 실패" 같은 규칙은 작은 vault에서 도구를
 * 못 쓰게 만들고, 그러면 사람이 임계값을 낮추다 결국 지운다. 가려야 하는 것은 **"적다"와
 * "없다"** 뿐이고, 적을 때의 판단 근거는 첫 줄의 케이스 수다.
 */
if (clean.length === 0) {
  process.stderr.write(
    `lapis-eval: 평가 케이스를 하나도 못 만들었다 (vault ${vc.infos.length} 노트).\n` +
      `  → 케이스는 frontmatter title(2어절 이상)과 산문 줄이 있는 노트에서만 나온다.\n` +
      `  → 샘플 수와 --vault 를 확인하라.\n`,
  );
  process.exit(2);
}
const DIST = ["고양이", "냉장고", "화요일", "젤리", "우산"];
const noisy = clean.map((c, i) => ({ ...c, query: `${c.query} ${DIST[i % DIST.length]}` }));

const tLoad = performance.now();
const index = loadLiveIndex(vc);
const loadMs = performance.now() - tLoad;

const w = (s: string) => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x1000 ? 2 : 1), 0);
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - w(s)));
const ms = (v: number) => `${Math.round(v)}ms`.padStart(6);

console.log(
  `vault ${vc.infos.length} 노트 · 케이스 ${clean.length}건 · ` +
    `인덱스 ${index.length}샤드 로드 ${Math.round(loadMs)}ms\n`,
);
console.log(pad("질의 집합", 26) + "R@1     R@10    MRR     결과수   p50     p95     max     단계 분포");
console.log("-".repeat(112));

/** 예산 판정 대상. 표를 그리는 동안 모아 두고 마지막에 한 번에 낸다. */
const checks: { label: string; got: number; budget: number }[] = [
  { label: "인덱스 로드", got: loadMs, budget: BUDGET.indexLoadMs },
];

for (const [label, cs] of [["깨끗한 질의", clean], ["오염 질의(무관 단어 1개)", noisy]] as const) {
  const stage: Record<string, number> = {};
  const results: CaseResult[] = cs.map((c) => {
    const t0 = performance.now();
    const { hits, combine } = unionRankDetailed(index, c.query, 0);
    const dt = performance.now() - t0;
    stage[combine] = (stage[combine] ?? 0) + 1;
    const at = hits.findIndex((h) => h.path === c.target);
    return {
      ...c,
      rank: at >= 0 && at < 10 ? at + 1 : null,
      score: at >= 0 ? hits[at].score : null,
      topScore: hits[0]?.score ?? null,
      matched: hits.length,
      ms: dt,
    };
  });
  const r = summarize(label, results);
  if (label !== "깨끗한 질의") {
    // 오염 질의만 판정한다 — 깨끗한 질의는 `AND` 100%라 사다리 비용이 드러나지 않는다.
    checks.push({ label: "오염 질의 p95", got: r.latency.p95Ms, budget: BUDGET.noisyP95Ms });
  }
  console.log(
    pad(label, 26) +
      `${(r.recallAt1 * 100).toFixed(1).padStart(5)}%  ${(r.recallAt10 * 100).toFixed(1).padStart(5)}%  ` +
      `${r.mrr.toFixed(3)}  ${String(Math.round(r.meanMatched)).padStart(6)}  ` +
      `${ms(r.latency.p50Ms)}  ${ms(r.latency.p95Ms)}  ${ms(r.latency.maxMs)}  ` +
      // 단계 분포가 "왜 이만큼 나왔나"를 설명한다. OR 비중이 크면 결과수가 터진다.
      (["AND", "AND-1", "OR-min", "OR"] as const)
        .filter((k) => stage[k])
        .map((k) => `${k} ${((stage[k] / cs.length) * 100).toFixed(0)}%`)
        .join(" · "),
  );
  if (label === "깨끗한 질의") {
    console.log("\n  질의 종류별 (깨끗한 질의):");
    for (const [k, v] of Object.entries(r.byKind)) {
      console.log(`    ${pad(k, 14)} n=${String(v.n).padStart(3)}  R@1 ${(v.recallAt1 * 100).toFixed(1).padStart(5)}%  MRR ${v.mrr.toFixed(3)}`);
    }
    console.log();
  }
}

// 긴 질의 — 품질 케이스(title 2~8어절 · body 앞 8어절)로는 **구성상 생기지 않는** 구간.
//
// ⚠️ **프로브도 오염시킨다.** 처음엔 원문을 그대로 질의로 썼는데 그러면 `AND`가 항상 걸려
// 사다리를 **한 단도 안 내려간다** — 카나리아(`AND1_MAX_WORDS = 999`)를 켜도 32어절이
// 108ms로 그대로였다. 비싼 단계는 AND가 0건일 때만 도달하므로, 정답에 없는 단어를 하나
// 붙여야 재려는 경로에 들어간다. (붙인 만큼 실제 어절 수는 +1이다.)
console.log("\n지연 프로브 (긴 질의 + 무관 단어 1개 — 정답 판정 없이 비용만):");
for (const words of PROBE_WORDS) {
  const probes = buildLongQueries(vc, PROBE_COUNT, words);
  if (probes.length === 0) {
    console.log(`  ${words}어절  — 표본 없음(vault에 그만큼 긴 산문 줄이 없다)`);
    continue;
  }
  const lat = latencyOf(
    probes.map((p, i) => {
      const q = `${p.query} ${DIST[i % DIST.length]}`;
      const t0 = performance.now();
      unionRankDetailed(index, q, 0);
      return performance.now() - t0;
    }),
  );
  console.log(
    `  ${String(words).padStart(2)}어절  n=${String(probes.length).padStart(3)}  ` +
      `p50 ${ms(lat.p50Ms)}  p95 ${ms(lat.p95Ms)}  max ${ms(lat.maxMs)}`,
  );
  checks.push({ label: `${words}어절 max`, got: lat.maxMs, budget: BUDGET.probeMaxMs });
}

console.log("\n기준선 이력 — 같은 하네스, vault 규모만 다름:");
console.log("  2026-08-13 OR 단독        : R@1 66.4% · MRR 0.737 · 평균 매칭 10,329");
console.log("  2026-08-13 AND→OR         : R@1 71.1% · MRR 0.767 · 평균 매칭    229 (오염 질의 10,346)");
console.log("  2026-08-19 AND→AND-1→OR-min: 오염 질의 R@1 67.2%→70.0% · 평균 매칭 10,346→199");
console.log("  2026-08-19 상한 8어절     : 오염 질의 평균 36ms · p95 118ms · 32어절 85ms (상한 없으면 118/356/860)");

console.log("\n지연 예산:");
let failed = 0;
for (const c of checks) {
  const ok = c.got <= c.budget;
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${pad(c.label, 16)} ${ms(c.got)} ${ok ? "≤" : ">"} ${c.budget}ms`);
}
if (failed > 0) {
  console.log(`\n❌ 예산 위반 ${failed}건 — 품질 지표가 통과해도 이 변경은 내보내지 않는다.`);
  process.exit(1);
}
console.log("\n✅ 지연 예산 통과. (품질 지표는 판정하지 않는다 — 위 표를 사람이 읽는다.)");
