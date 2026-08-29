import { UsageAnalyzer } from "$lib/usageAnalyzer";
import { buildUsageReport } from "$lib/usageReport";
import { usageMonths, usageRead, usageWriteReport } from "$lib/tauri/usage";
import { logWarn } from "$lib/stores/usage";

/**
 * 분석 문서를 **앱이 알아서 써 둔다.**
 *
 * ## ⚠️ 왜 버튼이 아닌가
 *
 * 예전엔 설정에 "저장…" 버튼과 형식 선택과 가림 체크박스가 있었다. 그건 로그를 **관리하는
 * 일**을 사용자에게 떠넘긴 것이다 — 통계를 보고 싶은 사람에게 형식을 고르게 할 이유가 없다.
 *
 * 이제 로그와 같은 자리에 문서가 같이 쌓인다. 필요할 때 폴더에서 꺼내 가면 된다.
 *
 * ## ⚠️ 기동 때 쓴다 — 닫을 때가 아니라
 *
 * 닫을 때 쓰면 창이 그동안 안 닫힌다. 로그가 크면(월 상한 16 MB × 달 수) 읽고 집계하는
 * 시간이 그대로 체감된다 — 앱이 멈춘 것으로 보인다.
 *
 * 기동 때는 어차피 인덱스를 만드느라 바쁘고, 그 문서는 **지난 세션까지의 이야기**다.
 * 꺼내 볼 때 필요한 것이 정확히 그것이다.
 *
 * ## ⚠️ 가리지 않는다
 *
 * 앱 데이터 폴더에만 있고 어디로도 안 나간다. 가림은 **밖으로 내보낼 때** 쓰는 것이고,
 * 지금은 내보내는 경로가 없다 — 사용자가 직접 복사해 간다.
 */

/** 문서 이름. 로그(`YYYY-MM.log`)와 같은 폴더에 선다. */
export const REPORT_NAME = "analysis.md";

/**
 * 지금까지의 기록으로 문서를 만들어 쓴다.
 *
 * ⚠️ **실패해도 던지지 않는다.** 이건 관찰 장치다 — 문서를 못 썼다고 앱이 안 뜨거나
 * 기동이 느려지면 관찰이 대상을 죽인 것이다.
 *
 * @param knownCommands 안 쓴 명령을 세려면 **분모**가 필요하다.
 */
export async function writeUsageAnalysis(knownCommands: readonly string[]): Promise<boolean> {
  try {
    const { months } = await usageMonths();
    if (months.length === 0) return false;

    // 🔴 **달을 하나씩 흘려보낸다.** 전부 모으면 16 MB × 달 수가 한꺼번에 메모리에 뜬다.
    const analyzer = new UsageAnalyzer({ knownCommands });
    for (const mo of months) analyzer.feedAll(await usageRead(mo));

    const label = months.length === 1 ? months[0] : `${months.at(-1)} ~ ${months[0]}`;
    await usageWriteReport(buildUsageReport(analyzer.result(), { label }));
    return true;
  } catch (e) {
    logWarn("usageAutoReport", "분석 문서 쓰기 실패", e);
    return false;
  }
}
