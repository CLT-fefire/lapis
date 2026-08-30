/**
 * 노트 본문을 읽어 모은다 — **못 읽은 것을 센다.**
 *
 * ## 🔴 왜 세나
 *
 * 미완 작업을 세려면 본문이 필요한데, 캐시에 있는 노트가 디스크에서 사라졌거나 권한이
 * 막히면 읽기가 실패한다. 예전엔 두 소비자(`lapis_stats` · `lapis tasks audit`)가
 * 그걸 **조용히 건너뛰었다.** 그러면 "미완 12건"이 나오는데 그게 전부인지 아닌지를
 * 아무도 모른다 — **분모가 조용히 줄어든 것**이다.
 *
 * ⚠️ 같은 자리 바로 아래에 *"맨숫자만 내면 어디에 몰렸는지가 안 보인다"* 는 주석이
 * 있었다. 몰린 자리를 보여주려고 `concentration` 을 더해 놓고, 정작 그 분모가 틀릴 수
 * 있다는 것은 안 봤다.
 *
 * 🔴 6차의 `unusedCommands` 와 **같은 모양**이다 — 모르면 모른다고 해야 한다.
 * 여기서는 못 읽은 수를 같이 내는 것이 그 답이다(고아 노트에서 "나가는 링크 수를 같이
 * 보고한다"고 정한 것과 같은 판단 — 설정을 새로 만들지 않고 **숫자를 하나 더** 준다).
 */

export interface NoteBody {
  path: string;
  body: string;
}

export interface ReadBodiesResult {
  bodies: NoteBody[];
  /** 읽기가 실패해 빠진 노트 수. **0 이 아니면 모든 집계가 그만큼 덜 센 것이다.** */
  unreadable: number;
}

/**
 * @param paths 읽을 노트 경로
 * @param read  읽기 — 실패하면 던져야 한다. 호출부가 fs 든 무엇이든 물릴 수 있게 뗐다.
 */
export function readBodies(
  paths: Iterable<string>,
  read: (path: string) => string,
): ReadBodiesResult {
  const bodies: NoteBody[] = [];
  let unreadable = 0;
  for (const path of paths) {
    try {
      bodies.push({ path, body: read(path) });
    } catch {
      // ⚠️ 여기서 로그를 남기지 않는다 — vault 가 크면 수천 줄이 된다.
      //    대신 **수를 돌려주고**, 부르는 쪽이 결과에 실어 보낸다.
      unreadable++;
    }
  }
  return { bodies, unreadable };
}
