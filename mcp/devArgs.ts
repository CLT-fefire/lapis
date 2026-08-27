/**
 * 손으로 돌리는 개발 하네스(`lapis-eval` · `lapis-bench`)의 인자 파싱.
 *
 * ## 왜 따로 있나
 *
 * 두 도구가 `Number(process.argv[2] ?? 기본값)` 한 줄로 인자를 읽고 있었다. 그래서
 * `./mcp/lapis-eval --vault <경로>`가 **케이스 0건**으로 아무것도 안 재고 마지막 줄에
 * ✅를 냈다 — `Number("--vault")`는 `NaN`이고, `slice(0, NaN)`은 빈 배열이다.
 * 예외도 경고도 없었다.
 *
 * 측정 도구는 **다른 판단의 근거**다. 토크나이저를 바꾸고 이걸 돌려 "R@1 그대로"를 봤다면
 * 실제로는 아무것도 비교하지 않은 것이고, `CACHE_VERSION` bump가 걸린 결정에서 그 결론은
 * 되돌리기가 비싸다.
 *
 * ## ⚠️ `cli/args.ts`를 재사용하지 않는 이유
 *
 * 그쪽은 명령·서브명령·`--json`·도움말 렌더까지 있는 **사용자용 표면**이고 계약이 문서로
 * 고정돼 있다. 이건 손으로 돌리는 개발 도구 둘이다. 붙이면 개발 도구가 사용자 표면의 계약을
 * 끌고 다니게 되고, 그 계약을 바꿀 때 개발 도구까지 따라 움직여야 한다.
 *
 * 대신 **거절하는 규율은 같게** 간다 — 모르는 옵션은 조용히 무시하지 않는다.
 */

export class DevArgsError extends Error {
  constructor(
    message: string,
    readonly usage: string,
  ) {
    super(message);
    this.name = "DevArgsError";
  }
}

export interface DevArgs {
  /** 위치 인자. 도구마다 뜻이 다르다(평가 케이스 수 · 벤치 문서 수). */
  sample: number;
  /** `--vault`. `undefined`면 `resolveVault()`의 자동 선택에 맡긴다. */
  vault: string | undefined;
  help: boolean;
}

export interface DevArgsSpec {
  defaultSample: number;
  /** 도움말과 오류 메시지에 쓰는 도구 이름. */
  name: string;
}

function usageOf(spec: DevArgsSpec): string {
  return [
    ``,
    `사용법: ${spec.name} [샘플수] [--vault <경로>]`,
    ``,
    `  샘플수          양의 정수. 기본 ${spec.defaultSample}`,
    `  --vault <경로>  대상 vault 루트. 없으면 캐시에서 자동 선택`,
    `  --help          이 도움말`,
    ``,
  ].join("\n");
}

/**
 * `process.argv.slice(2)`를 판다.
 *
 * ⚠️ **`--help`를 가장 먼저 본다.** 예전엔 `--help`가 위치 인자로 먹혀서 전체 하네스가
 * 0건으로 돌고 ✅를 냈다. 도움말을 물었는데 측정이 도는 것 자체가 잘못이다.
 */
export function parseDevArgs(argv: readonly string[], spec: DevArgsSpec): DevArgs {
  const usage = usageOf(spec);
  const fail = (msg: string): never => {
    throw new DevArgsError(`${spec.name}: ${msg}`, usage);
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    return { sample: spec.defaultSample, vault: undefined, help: true };
  }

  let sample: number | undefined;
  let vault: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") {
      const v = argv[i + 1];
      // 다음 것이 옵션이면 값이 아니다 — 조용히 `--help`를 경로로 삼지 않는다.
      if (v === undefined || v.startsWith("-")) fail("--vault 에 경로가 없다");
      vault = v;
      i++;
      continue;
    }
    if (a.startsWith("-")) fail(`모르는 옵션: ${a}`);
    if (sample !== undefined) fail(`위치 인자가 둘이다: ${sample} · ${a}`);
    // ⚠️ `Number()`만 쓰면 `""`가 0이 되고 `"12abc"`가 NaN이 된다. 둘 다 조용히 흘러가면
    //    안 되는 값이라 형태부터 본다.
    if (!/^\d+$/.test(a)) fail(`샘플 수는 양의 정수여야 한다: ${JSON.stringify(a)}`);
    const n = Number(a);
    if (n <= 0) fail(`샘플 수는 1 이상이어야 한다: ${a}`);
    sample = n;
  }

  return { sample: sample ?? spec.defaultSample, vault, help: false };
}

/**
 * 두 하네스의 공통 진입 처리 — 파싱하고, 도움말이면 내고 끝낸다.
 *
 * 오류는 **종료 코드 2**다. `lapis`의 사용법 오류와 같은 값이라, 스크립트가 두 도구를
 * 같은 방식으로 다룰 수 있다.
 */
export function readDevArgs(argv: readonly string[], spec: DevArgsSpec): DevArgs {
  let parsed: DevArgs;
  try {
    parsed = parseDevArgs(argv, spec);
  } catch (e) {
    if (e instanceof DevArgsError) {
      process.stderr.write(`${e.message}\n${e.usage}`);
      process.exit(2);
    }
    throw e;
  }
  if (parsed.help) {
    process.stdout.write(usageOf(spec));
    process.exit(0);
  }
  return parsed;
}
