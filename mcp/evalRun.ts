/**
 * 검색 품질 기준선 러너 — `./lapis-eval [표본수]`.
 *
 * 현행 설정(AND 우선 + OR 폴백)을 **깨끗한 질의**와 **오염 질의**(정답에 없는 단어 1개)
 * 양쪽에서 잰다. 검색 설정을 건드릴 때 이걸 먼저 돌려 회귀를 본다.
 *
 * ⚠️ 이 하네스는 "기억하는 문서를 다시 찾기"만 잰다. "이 주제 문서 전부" 같은 탐색형은
 * 구조 팔(`topic`/`tag`)이 담당하고 이 수치와 무관하다.
 */
import { buildCases, loadLiveIndex, resolveVault, summarize, type CaseResult } from "./searchEval.ts";
import { unionRankDetailed } from "./entry.ts";

const vc = resolveVault();
const clean = buildCases(vc, Number(process.argv[2] ?? 150));
const DIST = ["고양이", "냉장고", "화요일", "젤리", "우산"];
const noisy = clean.map((c, i) => ({ ...c, query: `${c.query} ${DIST[i % DIST.length]}` }));
const index = loadLiveIndex(vc);

const w = (s: string) => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x1000 ? 2 : 1), 0);
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - w(s)));

console.log(`vault ${vc.infos.length} 노트 · 케이스 ${clean.length}건\n`);
console.log(pad("질의 집합", 26) + "R@1     R@10    MRR     결과수   단계 분포");
console.log("-".repeat(88));
for (const [label, cs] of [["깨끗한 질의", clean], ["오염 질의(무관 단어 1개)", noisy]] as const) {
  const stage: Record<string, number> = {};
  const results: CaseResult[] = cs.map((c) => {
    const { hits, combine } = unionRankDetailed(index, c.query, 0);
    stage[combine] = (stage[combine] ?? 0) + 1;
    const at = hits.findIndex((h) => h.path === c.target);
    return {
      ...c,
      rank: at >= 0 && at < 10 ? at + 1 : null,
      score: at >= 0 ? hits[at].score : null,
      topScore: hits[0]?.score ?? null,
      matched: hits.length,
    };
  });
  const r = summarize(label, results);
  console.log(
    pad(label, 26) +
      `${(r.recallAt1 * 100).toFixed(1).padStart(5)}%  ${(r.recallAt10 * 100).toFixed(1).padStart(5)}%  ` +
      `${r.mrr.toFixed(3)}  ${String(Math.round(r.meanMatched)).padStart(6)}   ` +
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
console.log("\n기준선 이력 — 같은 하네스, vault 규모만 다름:");
console.log("  2026-08-13 OR 단독        : R@1 66.4% · MRR 0.737 · 평균 매칭 10,329");
console.log("  2026-08-13 AND→OR         : R@1 71.1% · MRR 0.767 · 평균 매칭    229 (오염 질의 10,346)");
console.log("  2026-08-19 AND→AND-1→OR-min: 오염 질의 R@1 67.2%→70.0% · 평균 매칭 10,346→199");
