/**
 * 인덱스 빌드 비용 벤치 — `./lapis-bench [노트수]`.
 *
 * ## 왜 별도 하네스인가
 *
 * `lapis-eval`은 **이미 만들어진** 캐시를 읽어 질의를 잰다. 그런데 앱이 실제로 오래 멈추는
 * 구간은 캐시가 없을 때의 **빌드**(토큰화 + `addAll` + 직렬화)다. 그 비용에는 회귀 감지
 * 장치가 하나도 없었다 — 토크나이저를 건드리면 검색 품질은 `lapis-eval`이 잡지만 빌드가
 * 2배 느려지는 건 아무도 모른다(19,000 노트에서 그건 체감 구간이다).
 *
 * ## 무엇을 재는가 — 그리고 재지 않는가
 *
 * | 구간 | 앱에서 누가 하나 | 여기서 | 게이트 |
 * |---|---|---|---|
 * | 파일 읽기 | Rust `read_vault_bundle` | node `readFileSync` | ❌ 참고만 (다른 코드다) |
 * | 토큰화 + `addAll` | worker (`fullTextWorker.ts`) | **같은 `FULLTEXT_OPTIONS`** | ✅ |
 * | 직렬화(`toJSON`) | worker → 캐시 저장 | 같은 경로 | ❌ 참고만 |
 *
 * ⚠️ **샤딩은 재지 않는다.** `searchIndex.ts`는 `./fullTextWorker?worker`(Vite 전용 import)
 * 때문에 node로 번들되지 않는다. 게이트가 지키려는 비용(토큰화 + add)은 문서를 몇 개
 * 인덱스로 나눠 담든 총량이 같으므로, `fnv32`를 여기 베껴 두 번째 진실을 만들지 않는다.
 *
 * ## 선형성도 함께 본다
 *
 * `ms/1000노트`만 보면 **초선형 회귀를 놓친다** — 고정 표본에서는 O(n²)도 그냥 "느린 상수"로
 * 보인다. 그래서 n/2와 n을 둘 다 돌려 **증가 배율**을 낸다(선형이면 2.00).
 */
import MiniSearch from "minisearch";
import { readFileSync } from "node:fs";
import { resolveVault } from "./cache.ts";
import { deterministicShuffle } from "./searchEval.ts";
import { FULLTEXT_OPTIONS, type FullTextDoc } from "./entry.ts";

/**
 * 예산. **세 지표가 서로 다른 것을 잡는다** — 실측 근거는 카나리아로 확인했다.
 *
 * 카나리아: `koBigramTokenize`에 3-gram을 함께 내보내게 고쳐(= 토크나이저 회귀를 흉내)
 * 벤치를 돌렸다. 표본 3000 · 19,313 노트 vault.
 *
 * | 항목 | 출하 설정 | 카나리아(3-gram) | 예산 | 카나리아를 잡나 |
 * |---|---:|---:|---:|:--|
 * | JSON 바이트/노트 | 2,406 B | **2,928 B** (+22%) | 2,750 | ✅ **이게 잡는다** |
 * | 빌드 ms/1000노트 | 275ms | 361ms (+31%) | 700 | ❌ 못 잡는다 |
 * | 증가 배율 (n/2 → n) | 1.98x | 2.36x | 2.60 | ❌ 못 잡는다 |
 *
 * ⚠️ **처음엔 벽시계만 재고 2.5배 여유를 뒀는데, 카나리아가 그대로 통과했다.** 토크나이저에
 * n-gram을 하나 더 얹어도 벽시계는 1.3배밖에 안 움직인다 — 2.5배 예산은 "재앙"만 잡는다.
 * 여유를 줄이면 머신 부하에 오검출이 난다(그 둘을 구분할 방법이 없다).
 *
 * → **인덱스 크기를 주 게이트로 쓴다.** 같은 입력에 대해 **결정론적**이라(부하와 무관) 여유를
 * 15%로 좁힐 수 있고, 토크나이저·필드·저장필드 변경이 전부 여기 남는다. 캐시 용량과 로드
 * 시간에 직결되므로 지키려던 값 그 자체이기도 하다.
 *
 * 벽시계 두 지표는 **버리지 않고 백스톱으로 남긴다** — 크기가 그대로인데 느려지는 회귀
 * (알고리즘 교체, O(n²) 도입)는 크기 게이트가 못 본다.
 *
 * ⚠️ **바이트/노트는 vault 내용에 따라 서서히 움직인다**(평균 노트 길이). 여유 15%를 넘게
 * 드리프트하면 실패가 신호가 아니라 잡음이다 → 그때는 값을 다시 재서 갱신할 것. CI가 아니라
 * 손으로 돌리는 하네스라 오검출 비용이 "다시 재기" 한 번이다.
 */
const BUDGET = { jsonBytesPerNote: 2750, buildMsPer1k: 700, growth: 2.6 };

const sample = Math.max(200, Number(process.argv[2] ?? 3000));
const vc = resolveVault();
// ⚠️ 품질 하네스의 `shuffledPool`을 쓰지 않는다 — 그건 아카이브를 걸러내는데, 이 vault에서
// 아카이브가 **94%**다. 빌드 비용은 앱이 실제로 인덱싱하는 **전량** 기준이어야 한다.
const picked = deterministicShuffle(vc.infos, 12345).slice(0, sample);

const tRead = performance.now();
const docs: FullTextDoc[] = [];
for (const info of picked) {
  try {
    docs.push({ id: info.source_path, name: info.source_name, body: readFileSync(info.source_path, "utf8") });
  } catch {
    // 캐시에는 있는데 디스크에서 사라진 노트. 벤치 표본에서 빠지는 것 외에 의미 없다.
  }
}
const readMs = performance.now() - tRead;
const bytes = docs.reduce((a, d) => a + d.body.length, 0);

if (docs.length < 200) {
  console.error(`표본이 ${docs.length}건뿐이다 — 벤치가 의미 없다. 캐시가 최신인지 확인할 것.`);
  process.exit(2);
}

/** 한 번의 빌드 = 앱 worker의 `addToShard`(reset) 경로와 같은 호출. */
function build(subset: FullTextDoc[]): { addMs: number; jsonMs: number; jsonBytes: number; heapMb: number } {
  const heap0 = process.memoryUsage().heapUsed;
  const idx = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
  const t0 = performance.now();
  idx.addAll(subset);
  const addMs = performance.now() - t0;
  const heapMb = (process.memoryUsage().heapUsed - heap0) / 1024 / 1024;
  const t1 = performance.now();
  const json = JSON.stringify(idx.toJSON());
  const jsonMs = performance.now() - t1;
  return { addMs, jsonMs, jsonBytes: json.length, heapMb };
}

const half = docs.slice(0, Math.floor(docs.length / 2));
console.log(
  `vault ${vc.infos.length} 노트 · 표본 ${docs.length}건 ` +
    `(${(bytes / 1024 / 1024).toFixed(1)} MB · 읽기 ${Math.round(readMs)}ms — 참고)\n`,
);
console.log("표본      노트    addAll      toJSON     JSON 크기   힙 증가   ms/1000노트   B/노트");
console.log("-".repeat(88));

const rows = [half, docs].map((subset) => {
  const r = build(subset);
  const per1k = (r.addMs / subset.length) * 1000;
  console.log(
    `${String(subset === half ? "n/2" : "n").padEnd(9)} ${String(subset.length).padStart(5)}  ` +
      `${`${Math.round(r.addMs)}ms`.padStart(8)}  ${`${Math.round(r.jsonMs)}ms`.padStart(8)}  ` +
      `${`${(r.jsonBytes / 1024 / 1024).toFixed(1)} MB`.padStart(9)}  ` +
      `${`${r.heapMb.toFixed(0)} MB`.padStart(7)}  ${`${Math.round(per1k)}ms`.padStart(9)}  ` +
      `${String(Math.round(r.jsonBytes / subset.length)).padStart(7)}`,
  );
  return { n: subset.length, ...r, per1k, bytesPerNote: r.jsonBytes / subset.length };
});

const growth = rows[1].addMs / Math.max(0.001, rows[0].addMs);
console.log(`\n증가 배율 (n/2 → n): ${growth.toFixed(2)}x  (선형 2.00 · O(n²) 4.00)`);

// 전체 vault 환산 — 앱이 캐시 미스에서 실제로 멈추는 시간의 자릿수.
const fullSec = ((rows[1].per1k / 1000) * vc.infos.length) / 1000;
console.log(`전체 ${vc.infos.length} 노트 환산: 약 ${fullSec.toFixed(1)}초 (addAll만, 읽기·직렬화 제외)`);

console.log("\n예산:");
const checks = [
  // 주 게이트 — 결정론적. 토크나이저·필드 변경이 여기 남는다.
  { label: "JSON 바이트/노트", got: rows[1].bytesPerNote, budget: BUDGET.jsonBytesPerNote },
  // 백스톱 — 크기는 그대로인데 느려지는 회귀용. 여유가 커서 재앙만 잡는다(위 표 참조).
  { label: "빌드 ms/1000노트", got: rows[1].per1k, budget: BUDGET.buildMsPer1k },
  { label: "증가 배율", got: growth, budget: BUDGET.growth },
];
let failed = 0;
for (const c of checks) {
  const ok = c.got <= c.budget;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✅" : "❌"} ${c.label.padEnd(18)} ${c.got.toFixed(2)} ${ok ? "≤" : ">"} ${c.budget}`,
  );
}
if (failed > 0) {
  console.log(`\n❌ 예산 위반 ${failed}건 — 인덱스 빌드 비용이 늘었다. cold-start와 캐시 용량이 그만큼 커진다.`);
  process.exit(1);
}
console.log("\n✅ 빌드 예산 통과.");
