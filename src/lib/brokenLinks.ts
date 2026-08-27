import { targetName, resolverKey, type LinkIndex } from "$lib/linkIndex";

/**
 * 끊긴 링크 감사 — **본문 위키링크/마크다운 링크 중 어느 노트로도 해소되지 않는 것**.
 *
 * ## 왜 필요한가
 *
 * 프리뷰는 미해소 링크에 `unresolved` 클래스를 붙이지만(`+page.svelte`), 그건 **그 노트를
 * 열었을 때만** 보인다. 19,000 노트에서 눈으로 훑어 찾을 수 있는 게 아니다.
 *
 * README가 밝히듯 **vault를 쓰는 게 Lapis가 아니라 바깥 도구들**이다. 앱 안에서의 rename은
 * 링크를 따라가 고치지만(`linkRewrite`), 밖에서 파일이 지워지거나 이름이 바뀌면 링크가
 * 조용히 끊긴다. 그 경로에는 아무 신호가 없었다.
 *
 * ## ⚠️ frontmatter cross-ref는 대상이 아니다
 *
 * `relations.ts`의 `NON_RELATION_FIELDS`는 **allowlist가 아니라 denylist**다. 거기 없는
 * 임의 필드는 "값이 노트로 resolve되면 관계"라는 규칙으로 처리된다 — 즉 **해소 실패가 곧
 * '관계가 아님'** 이라는 뜻이고, 그게 설계된 의미론이다.
 *
 * 그래서 frontmatter를 감사하면 `status: welcome` · `priority: high` 같은 평범한 스칼라가
 * 전부 "끊긴 링크"로 잡힌다. 본문 링크는 `[[...]]`·`[](...)`라는 **문법이 곧 링크 선언**이라
 * 그런 모호함이 없다. 그래서 여기만 본다.
 *
 * ## ⚠️ 인덱스 빌드 경로에 넣지 않는다
 *
 * 요청 시에만 계산한다. `buildIndexChunked`가 존재하는 이유가 큰 vault에서 동기 빌드가
 * main thread를 수백 ms 점유하기 때문인데, 기동 경로에 순회를 하나 더 얹으면 그 노력을
 * 갉아먹는다. 감사는 사용자가 명시적으로 여는 화면이다.
 */

/** 끊긴 링크 하나를 가리키는 노트. */
export interface BrokenSource {
  path: string;
  /** 표시용 이름 — `title`이 있으면 그것, 없으면 파일 stem. */
  name: string;
}

/** 해소되지 않은 대상 하나와, 그것을 가리키는 노트들. */
export interface BrokenTarget {
  /** 해소 실패한 target 이름(alias 분리 후, 원본 대소문자 유지). */
  target: string;
  sources: BrokenSource[];
}

/**
 * 끊긴 링크를 **대상별로 묶어** 반환한다.
 *
 * 묶는 이유 — 고칠 단위가 "링크 1개"가 아니라 "없는 노트 1개"다. 12곳에서 가리키는
 * 대상 하나를 만들면 12개가 한 번에 해소된다. 그래서 **참조 수 내림차순**으로 낸다:
 * 위에서부터 고치는 게 곧 효율 순이다.
 *
 * 한 노트가 같은 대상을 여러 번 가리켜도 그 노트는 **한 번만** 센다 — 본문에 링크를
 * 세 번 쓴 노트가 세 곳에서 참조된 것처럼 보이면 우선순위가 왜곡된다.
 */
export function findBrokenLinks(index: LinkIndex): BrokenTarget[] {
  /** 키는 소문자 target — resolver와 같은 정규형이라야 판정이 일치한다. */
  const groups = new Map<string, BrokenTarget>();

  for (const info of index.byPath.values()) {
    const seenInNote = new Set<string>();
    for (const raw of info.targets) {
      const name = targetName(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenInNote.has(key)) continue;
      seenInNote.add(key);
      // ⚠️ `resolver.has`를 직접 묻지 않는다 — 헤딩 앵커 폴백이 거기 없어서,
      //    `[[노트#헤딩]]`이 노트가 있는데도 끊긴 것으로 잡혔다.
      if (resolverKey(name, index) !== null) continue;

      let g = groups.get(key);
      if (!g) {
        g = { target: name, sources: [] };
        groups.set(key, g);
      }
      g.sources.push({
        path: info.source_path,
        name: info.title ?? info.source_name,
      });
    }
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.sources.sort(
      (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
    );
  }
  // 참조 수 내림차순 → 같으면 이름순(결과 순서가 실행마다 흔들리지 않게).
  out.sort(
    (a, b) =>
      b.sources.length - a.sources.length || a.target.localeCompare(b.target),
  );
  return out;
}

/** 끊긴 링크 **총 개수**(대상 수가 아니라 링크 수). 요약 표시용. */
export function countBrokenLinks(targets: readonly BrokenTarget[]): number {
  return targets.reduce((n, t) => n + t.sources.length, 0);
}
