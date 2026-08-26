import { findCommand, optionsFor, type CommandSpec, type OptionSpec } from "./spec.ts";

/**
 * argv 파싱과 검증 — **순수 함수**다. IO도 process도 만지지 않는다.
 *
 * 라이브러리를 물지 않는 이유는 README 설계 원칙("최소 의존")이기도 하지만, 더 실질적인
 * 이유는 **모르는 옵션을 어떻게 다룰지**가 이 도구에서 중요하기 때문이다. 대부분의 파서는
 * 기본적으로 조용히 통과시킨다. 여기서는 소리내어 죽어야 한다(아래).
 */

export class UsageError extends Error {}

export interface ParsedCommand {
  command: CommandSpec;
  positional: string[];
  options: Record<string, string | string[] | number | boolean>;
  help: boolean;
}

/** `--key=value` · `--key value` · `--flag` · 반복 키 · `--` 종결자. */
function tokenize(argv: readonly string[]): { flat: string[]; rest: string[] } {
  const i = argv.indexOf("--");
  return i === -1
    ? { flat: [...argv], rest: [] }
    : { flat: argv.slice(0, i), rest: argv.slice(i + 1) };
}

function specOf(opts: OptionSpec[], name: string): OptionSpec | undefined {
  return opts.find((o) => o.name === name);
}

function parseNumber(name: string, raw: string): number {
  const n = Number(raw);
  // ⚠️ `Number("")`는 0이다. 빈 문자열을 0으로 받으면 `--limit`이 조용히 1로 클램프된다.
  if (raw.trim() === "" || !Number.isFinite(n)) {
    throw new UsageError(`--${name}: 숫자가 아니다 (받은 값: ${JSON.stringify(raw)})`);
  }
  return n;
}

/**
 * argv를 명령 하나로 해소한다.
 *
 * ⚠️ **모르는 옵션은 조용히 무시하지 않는다.** `--limt 5`를 무시하면 기본값으로 돈 결과를
 * 요청한 결과로 오인한다. 결과가 그럴듯해서 더 나쁘다 — 틀렸다는 신호가 없다.
 */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  const { flat, rest } = tokenize(argv);

  const first = flat[0];
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    throw new UsageError("");
  }
  if (first.startsWith("-")) {
    throw new UsageError(`명령이 없다 (받은 것: ${first})`);
  }

  const command = findCommand(first);
  if (!command) {
    throw new UsageError(`모르는 명령: ${first}`);
  }
  const opts = optionsFor(command);

  const positional: string[] = [...rest];
  const options: Record<string, string | string[] | number | boolean> = {};
  let help = false;

  for (let i = 1; i < flat.length; i++) {
    const tok = flat[i];

    if (tok === "-h") {
      help = true;
      continue;
    }
    if (!tok.startsWith("--")) {
      positional.push(tok);
      continue;
    }

    const eq = tok.indexOf("=");
    const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
    const inlineValue = eq === -1 ? null : tok.slice(eq + 1);

    const spec = specOf(opts, name);
    if (!spec) {
      throw new UsageError(`모르는 옵션: --${name}`);
    }
    if (name === "help") {
      help = true;
      continue;
    }

    if (spec.kind === "boolean") {
      if (inlineValue !== null) {
        throw new UsageError(`--${name}: 값을 받지 않는 플래그다`);
      }
      options[name] = true;
      continue;
    }

    const value = inlineValue ?? flat[++i];
    // ⚠️ `--tag --json`처럼 값이 빠지면 다음 옵션을 값으로 삼키게 된다. 그러면 `--json`이
    // 사라진 채로 돌고, 사용자는 왜 사람용 출력이 나오는지 모른다.
    if (value === undefined || (inlineValue === null && value.startsWith("--"))) {
      throw new UsageError(`--${name}: 값이 필요하다`);
    }

    if (spec.kind === "number") {
      options[name] = parseNumber(name, value);
    } else if (spec.kind === "string[]") {
      const prev = options[name];
      options[name] = Array.isArray(prev) ? [...prev, value] : [value];
    } else {
      options[name] = value;
    }
  }

  if (!help) {
    const required = command.positional.filter((p) => p.required);
    if (positional.length < required.length) {
      const missing = required[positional.length];
      throw new UsageError(`${command.name}: <${missing.name}>가 필요하다`);
    }
  }

  return { command, positional, options, help };
}
