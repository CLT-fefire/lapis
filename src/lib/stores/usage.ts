import { writable, get } from "svelte/store";
import { invoke } from "$lib/tauri/invoke";
import {
  serialize,
  monthOf,
  type CommandSurface,
  type UsageEvent,
} from "$lib/usageEvent";

/**
 * 사용 로그의 **배선 절반** — 버퍼와 flush.
 *
 * ## ⚠️ 절대 던지지 않는다
 *
 * 이건 관찰 장치다. 관찰이 관찰 대상을 죽이면 안 된다 — 로그를 못 써서 저장이 실패하거나
 * 명령이 안 도는 일은 **절대** 없어야 한다. 그래서 모든 경로가 `catch` 로 끝난다.
 *
 * ⚠️ 특히 `logError` 가 던지면 **오류 처리 중에 오류가 난다.** 원래 오류는 사라지고
 * 엉뚱한 것이 보고된다.
 *
 * ## ⚠️ 모아서 보낸다
 *
 * 이벤트마다 IPC 를 하면 `⌘P` 를 한 번 여는 데 왕복이 여러 번이다. 버퍼에 모았다가
 * 간격을 두고 한 번에 붙인다. 대신 **앱이 죽으면 버퍼가 날아간다** — 그건 감수한다.
 * 로그를 지키려고 매 이벤트를 동기 flush 하면 앱이 느려지고, 그건 관찰이 대상을 바꾸는 것이다.
 */

const FLUSH_INTERVAL_MS = 5_000;
/** 이만큼 쌓이면 간격을 안 기다린다. */
const FLUSH_AT = 64;
/** 버퍼 상한 — flush 가 계속 실패해도 메모리가 안 늘어나게. */
const BUFFER_MAX = 1_000;

const ENABLED_KEY = "lapis.usage-log";

/** 기록할 것인가. 기본 **켬** — 로컬 파일이고 어디로도 안 보낸다. */
export const usageEnabled = writable<boolean>(loadEnabled());

function loadEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

usageEnabled.subscribe((on) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    /* 무시 — 기록 설정을 못 저장한다고 앱이 죽으면 안 된다 */
  }
});

/** 상한에 닿아 버려진 줄 수. 0이 아니면 화면이 말해야 한다. */
export const usageDropped = writable<number>(0);

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushUsage();
  }, FLUSH_INTERVAL_MS);
}

function push(e: UsageEvent): void {
  if (!get(usageEnabled)) return;
  try {
    if (buffer.length >= BUFFER_MAX) {
      // ⚠️ 앞을 버린다 — 뒤(최근)가 더 값지다. 오래된 것이 값진 것은 **디스크에 닿은 뒤**의
      //    이야기이고, 버퍼는 아직 못 닿은 것이다.
      buffer.shift();
      usageDropped.update((n) => n + 1);
    }
    buffer.push(serialize(e));
    if (buffer.length >= FLUSH_AT) void flushUsage();
    else schedule();
  } catch {
    /* 관찰이 대상을 죽이지 않는다 */
  }
}

/** 버퍼를 디스크로. 실패하면 **버퍼를 되돌린다** — 잃지 않으려고. */
export async function flushUsage(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    const res = await invoke<{ written: number; dropped: number }>("usage_append", {
      month: monthOf(Date.now()),
      lines: batch,
    });
    if (res.dropped > 0) usageDropped.update((n) => n + res.dropped);
  } catch {
    // ⚠️ Tauri 밖(브라우저 프리뷰·테스트)에서는 여기로 온다. 되돌리되 상한을 지킨다 —
    //    안 그러면 프리뷰에서 버퍼가 무한히 자란다.
    buffer = [...batch.slice(-BUFFER_MAX), ...buffer].slice(-BUFFER_MAX);
  }
}

// ─── 기록 API ────────────────────────────────────────────────────────────────

/**
 * 명령이 실행됐다.
 *
 * ⚠️ **입구를 같이 남긴다.** "파일 열기를 400번 했다"는 쓸모가 적고, "400번 중 380번이
 * `⌘P`, 레일은 3번"은 레일을 고칠지 말지를 정해 준다.
 */
export function logCommand(id: string, via: CommandSurface): void {
  push({ k: "cmd", t: Date.now(), id, via });
}

/**
 * 오류가 났다.
 *
 * ⚠️ **`console.error` 를 대체하지 않고 겸한다.** 개발 중에는 콘솔이 여전히 제일 빠른
 * 경로다. 여기서 콘솔을 끊으면 dev 에서 원인을 못 본다.
 *
 * @param at 어디서 — 모듈 경로(`stores/vault`)
 * @param msg 무엇이 — 원래 `console.error` 의 첫 인자 그대로
 */
export function logError(at: string, msg: string, ...rest: unknown[]): void {
  try {
    console.error(`[${at}] ${msg}`, ...rest);
  } catch {
    /* 콘솔조차 없으면 넘어간다 */
  }
  push({ k: "err", t: Date.now(), at, msg, ...splitRest(rest) });
}

/** 경고 — 오류와 같은 자리에 담되 메시지 앞에 표시를 둔다. */
export function logWarn(at: string, msg: string, ...rest: unknown[]): void {
  try {
    console.warn(`[${at}] ${msg}`, ...rest);
  } catch {
    /* 무시 */
  }
  push({ k: "err", t: Date.now(), at, msg: `warn: ${msg}`, ...splitRest(rest) });
}

/**
 * 나머지 인자를 `path` 와 `detail` 로 가른다.
 *
 * ⚠️ 호출 형태가 **두 가지**다 — 원래 `console.error` 가 그랬다:
 *
 * ```
 * logError(at, "msg", e)              // 예외만
 * logError(at, "msg", path, e)        // 어느 노트에서 났는지까지
 * ```
 *
 * 규칙은 단순하다: **문자열은 경로, 나머지 첫 값은 예외.** 이보다 영리하게 굴면
 * (경로처럼 생겼는지 판정하는 등) 형태가 하나 늘 때마다 규칙이 흔들린다.
 */
function splitRest(rest: readonly unknown[]): { path?: string; detail?: string } {
  const path = rest.find((r): r is string => typeof r === "string");
  const err = rest.find((r) => typeof r !== "string");
  return {
    ...(path ? { path } : {}),
    ...(err === undefined ? {} : { detail: describeError(err) }),
  };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** 세션 시작 — 어느 버전·플랫폼에서 난 것인지 나중에 갈라 보려면 필요하다. */
export function logSessionStart(version: string, os: string): void {
  push({ k: "session", t: Date.now(), ev: "start", v: version, os });
}

/** 테스트용 — 버퍼를 비운다. */
export function resetUsageBuffer(): void {
  buffer = [];
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  usageDropped.set(0);
}

/** 테스트용 — 지금 버퍼에 있는 줄. */
export function peekUsageBuffer(): readonly string[] {
  return buffer;
}
