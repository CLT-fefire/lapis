import { writable, get } from "svelte/store";

/**
 * **사용자가 알아야 하는 실패**.
 *
 * ## ⚠️ 왜 필요했나
 *
 * v3.2.0 이 96곳의 `console.error` 를 `logError` 로 구조화했지만, 그건 **기록**이다.
 * 릴리스 빌드에는 devtools 가 없으므로 사용자는 여전히 아무것도 못 본다.
 *
 * 그중 **되돌릴 수 없는 쓰기의 실패**는 다르다. `stores/vault.ts` 가 이렇게 적고 있었다:
 *
 * > ⚠️ 이 경로에는 아직 **화면 오류 표면이 없다** … UI 노출은 별도 작업이다.
 *
 * 이름은 바뀌고 인용은 안 바뀐 상태를 사용자가 모르면, 다음에 그 링크를 눌렀을 때
 * "끊긴 링크"로 만나게 된다 — 원인에서 한참 떨어진 곳이다.
 *
 * ## ⚠️ 모든 오류를 여기 담지 않는다
 *
 * 96곳을 전부 띄우면 배너가 상시가 되고, 상시가 된 경고는 아무도 안 읽는다.
 * 여기 오는 것은 **사용자가 다음에 할 일이 달라지는 실패**뿐이다 — 쓰기·삭제·백업.
 */

export interface Alert {
  /** 한 줄 요약. 사용자가 읽는다. */
  message: string;
  /** 자세한 내용(경로·예외). 접혀 있다. */
  detail?: string;
  /** 같은 실패를 여러 번 담지 않으려는 키. */
  key: string;
  at: number;
}

/** ⚠️ 상한 — 실패가 연달아 나면 배너가 화면을 덮는다. */
export const ALERT_MAX = 5;

export const alerts = writable<Alert[]>([]);

/**
 * 알림을 올린다.
 *
 * ⚠️ **같은 키는 하나만 남긴다.** 같은 실패가 반복되면(자동 커밋이 계속 실패하는 등)
 * 같은 줄이 쌓이는데, 그건 정보가 아니라 소음이다. 대신 시각을 갱신한다.
 */
export function pushAlert(key: string, message: string, detail?: string): void {
  alerts.update((list) => {
    const rest = list.filter((a) => a.key !== key);
    return [{ key, message, detail, at: Date.now() }, ...rest].slice(0, ALERT_MAX);
  });
}

export function dismissAlert(key: string): void {
  alerts.update((list) => list.filter((a) => a.key !== key));
}

export function clearAlerts(): void {
  alerts.set([]);
}

/** 지금 알림이 있나 — 화면이 배너를 그릴지 정한다. */
export function hasAlerts(): boolean {
  return get(alerts).length > 0;
}
