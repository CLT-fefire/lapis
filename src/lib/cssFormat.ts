/**
 * ⚠️ **동적 import 다.** 정적으로 넣었다가 빌드해 보니 prettier가 852 KB 청크에 들어가
 * **진입점에서 즉시 로드**됐다 — 설정을 한 번도 안 여는 사람도 그걸 다 받는다.
 *
 * 여기서 미루면 "정돈"을 처음 누를 때만 받는다. 그 한 번은 조금 느리지만, 앱 기동은
 * 매번이다.
 *
 * 측정 없이 정적 import로 뒀으면 몰랐을 것이다 — 계획서에 "번들 크기를 재서 기록한다"고
 * 적어 둔 이유가 이것이다.
 */
async function loadPrettier() {
  const [prettier, postcss] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/postcss"),
  ]);
  return { format: prettier.format, postcss: postcss.default };
}

/**
 * 사용자 정의 CSS 포매팅.
 *
 * ## 왜 prettier 인가
 *
 * 들여쓰기만 맞추는 자체 포매터로는 **뭉개진 CSS**를 못 편다(`a{color:red}` 한 줄).
 * 사용자가 어디선가 복사해 붙이는 것이 실제 사용 경로라, 그게 안 되면 포매터가 있는 의미가
 * 거의 없다.
 *
 * ⚠️ **런타임 의존성이다** — 번들에 들어간다. 개발용이 아니라 앱이 실행 중에 부른다.
 * `prettier/standalone`과 postcss 플러그인만 쓴다(전체 prettier가 아니다).
 *
 * ## ⚠️ 포매팅은 문법 검사가 아니다
 *
 * prettier는 파싱에 실패하면 던진다. 그걸 **오류 표시로 쓴다** — 별도 린터를 두지 않는다.
 * 다만 "파싱은 되는데 뜻이 없는" CSS(`colr: red`)는 못 잡는다. 그건 브라우저도 조용히
 * 무시하는 것이고, 사용자 CSS에서는 그게 맞는 동작이다.
 */

export class CssFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CssFormatError";
  }
}

/**
 * CSS를 정돈한다. 파싱 실패면 `CssFormatError`.
 *
 * ⚠️ **빈 입력은 빈 문자열을 낸다.** prettier에 빈 문자열을 넘기면 개행 하나를 돌려주는데,
 * 그러면 "저장 안 했는데 내용이 바뀐" 상태가 되어 편집기가 dirty로 보인다.
 */
export async function formatCss(src: string): Promise<string> {
  if (src.trim() === "") return "";
  try {
    const { format, postcss } = await loadPrettier();
    const out = await format(src, {
      parser: "css",
      plugins: [postcss],
      // 앱 안 좁은 편집기라 기본 80보다 짧게 — 가로 스크롤이 생기면 읽기가 나빠진다.
      printWidth: 72,
    });
    // prettier는 끝에 개행을 붙인다. 저장 값과 편집 값이 달라지지 않게 다듬는다.
    return out.replace(/\n+$/, "");
  } catch (e) {
    throw new CssFormatError(e instanceof Error ? e.message : String(e));
  }
}
