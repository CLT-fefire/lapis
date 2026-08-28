/**
 * 새 노트 템플릿.
 *
 * ## ⚠️ 왜 지금인가
 *
 * `NewNoteModal.svelte` 가 "Phase 4.2에서 템플릿으로 확장 예정"이라고 적어 두고 있었다.
 * 실측이 그 값어치를 말한다 — 이 vault 는 프론트매터 규약이 **100%** 다
 * (`title`·`doc_kind`·`topic`·`tags` 전부 112/112). 매번 손으로 적고 있었다는 뜻이다.
 *
 * ## ⚠️ 자리는 vault 안이다
 *
 * 템플릿을 앱 설정에 담으면 **vault 를 옮길 때 안 따라간다.** 노트는 파일시스템에 그대로
 * 있는 것이 이 앱의 전제이고, 템플릿도 그 전제를 따른다 — `.lapis/templates/*.md`.
 *
 * ## ⚠️ 치환은 **날짜와 제목뿐**이다
 *
 * 표현식·조건·반복을 넣으면 그건 템플릿 엔진이고, 엔진은 **조용히 틀린다**(오타 난
 * 변수가 빈 문자열로 나간다). 아는 이름만 바꾸고 **모르는 것은 그대로 둔다** —
 * 그래야 오타가 눈에 보인다.
 */

/** 아는 자리 표시자. 이 목록에 없는 `{{...}}` 는 **안 건드린다**. */
export const PLACEHOLDERS = ["title", "date", "time", "datetime"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface TemplateVars {
  title: string;
  /** 기준 시각. 테스트가 고정값을 줄 수 있게 인자로 받는다. */
  now: Date;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

export function valueOf(name: Placeholder, vars: TemplateVars): string {
  const d = vars.now;
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  switch (name) {
    case "title":
      return vars.title;
    case "date":
      return date;
    case "time":
      return time;
    case "datetime":
      return `${date} ${time}`;
  }
}

/**
 * `{{title}}` 같은 자리를 채운다.
 *
 * ⚠️ **모르는 이름은 그대로 남긴다.** 빈 문자열로 바꾸면 오타(`{{titel}}`)가 조용히
 * 사라져 사용자는 템플릿이 먹은 줄 안다. 남아 있으면 눈에 보인다.
 *
 * ⚠️ 공백을 허용한다(`{{ title }}`) — 손으로 쓰는 것이라 들어간다.
 */
export function applyTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, name: string) => {
    const key = name.toLowerCase();
    return (PLACEHOLDERS as readonly string[]).includes(key)
      ? valueOf(key as Placeholder, vars)
      : whole;
  });
}

/** vault 안 템플릿 디렉터리. */
export const TEMPLATE_DIR = ".lapis/templates";

/** 파일 경로 → 사용자에게 보일 이름. */
export function templateName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(md|mmd)$/i, "");
}

/**
 * 템플릿이 없을 때의 기본 본문 — 예전 동작 그대로.
 *
 * ⚠️ 템플릿을 안 만든 사용자의 동작이 바뀌면 안 된다. 이 기능은 **더하는 것**이지
 * 기존 흐름을 갈아치우는 것이 아니다.
 */
export function defaultBody(title: string): string {
  return `# ${title}\n\n`;
}
