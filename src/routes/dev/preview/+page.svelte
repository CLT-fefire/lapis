<script lang="ts">
  import VaultHygieneModal from "$lib/VaultHygieneModal.svelte";
  import GrepModal from "$lib/GrepModal.svelte";
  import { buildIndex } from "$lib/linkIndex";
  import { computeReplacePreview } from "$lib/replacePlan";
  import { linkIndex } from "$lib/stores/vault";
  import { brokenLinksOpen } from "$lib/stores/brokenLinks";
  import {
    grepOpen,
    grepPattern,
    grepResult,
    grepReplacement,
    replacePreview,
    replaceEngineSkew,
  } from "$lib/stores/grep";
  import type { LinkInfo } from "$lib/tauri/notes";

  /**
   * 개발 전용 컴포넌트 갤러리.
   *
   * ## 왜 있나
   *
   * 위생 모달과 찾아 바꾸기 패널은 **손으로 열기가 번거롭다.** 실제 vault와 인덱스가
   * 있어야 채워지고, 팔레트에서 찾아 들어가야 하고, 치환 패널은 검색이 먼저 걸려야 뜬다.
   * 그래서 "화면이 어떻게 생겼나"만 보려 해도 매번 앱을 띄우고 상태를 만들어야 했다.
   *
   * DOM 테스트가 구조·숫자·순서는 잡지만 **색·간격·정렬은 못 본다**(happy-dom에 레이아웃
   * 엔진이 없다). 그건 사람 눈이 필요하고, 눈으로 보려면 화면이 있어야 한다. 여기가 그 화면이다.
   *
   * ## ⚠️ 프로덕션 빌드에서 무엇이 남고 무엇이 안 남나
   *
   * `import.meta.env.DEV`가 막는 것은 **렌더링이지 번들링이 아니다.** 실제로 빌드해서
   * 확인했다 — 픽스처 문자열이 산출물에 그대로 들어간다.
   *
   * 다만 SvelteKit이 라우트마다 청크를 쪼개므로 이건 **1 KB짜리 별도 파일**이고, 라우트
   * 매니페스트에 동적 import로만 걸린다. 데스크탑 셸은 여기로 이동하지 않으니 **한 번도
   * 받아가지 않는다.** 모듈 최상위의 `buildIndex`·`computeReplacePreview`도 청크가 로드될
   * 때만 도는 것이라 같이 안 돈다.
   *
   * 그래서 비용은 "안 쓰는 파일 하나"고, 그걸 없애려고 빌드 설정을 늘리지는 않았다.
   * **"죽은 코드가 된다"고 적어 두면 안 되는 이유**가 이것이다 — 안 그러면 다음 사람이
   * 여기에 무거운 것을 넣고 사라질 거라 믿는다.
   *
   * ⚠️ **Tauri 없이 돈다.** `npm run dev`(브라우저)로 열면 된다. 데이터는 전부 픽스처라
   * IPC를 안 탄다 — 다만 목록의 항목을 **누르면** `selectNote`가 IPC를 타서 실패한다.
   * 보는 용도지 조작하는 용도가 아니다.
   */

  const DEV = import.meta.env.DEV;

  type Surface = "hygiene" | "replace";
  let surface = $state<Surface>("hygiene");

  const mkInfo = (path: string, extra: Partial<LinkInfo> = {}): LinkInfo => {
    const segs = path.split("/").filter(Boolean);
    return {
      source_path: path,
      source_name: (segs[segs.length - 1] ?? path).replace(/\.md$/i, ""),
      title: null,
      aliases: [],
      tags: [],
      doc_kind: null,
      topic: null,
      related: [],
      targets: [],
      props: {},
      ...extra,
    };
  };

  /**
   * 세 탭이 **동시에** 채워지는 vault. 한 탭만 채우면 나머지 탭의 빈 상태를 실수로
   * "정상"으로 보게 된다.
   */
  const fixtureIndex = buildIndex([
    mkInfo("/v/HOME.md", {
      title: "허브",
      targets: ["알파", "없는문서", "베타"],
      tags: ["Tech/svelte", "a/note"],
    }),
    mkInfo("/v/알파.md", { tags: ["tech/svelte", "b/note"] }),
    mkInfo("/v/베타.md", { targets: ["또없는문서"] }),
    mkInfo("/v/외톨이.md", { tags: ["demo"] }),
    mkInfo("/v/x/중복이름.md"),
    mkInfo("/v/y/중복이름.md"),
  ]);

  /** 경고 셋이 **한꺼번에** 걸리는 치환 — 가장 빽빽한 상태를 본다. */
  const fixtureReplace = computeReplacePreview(
    new Map([
      ["/v/알파.md", "---\ntitle: 창\n---\n\n창을 열다. 창이 둘.\n"],
      ["/v/베타.md", "창 하나 더.\n"],
    ]),
    "창",
    "창문",
    {},
  );

  function apply() {
    if (!DEV) return;
    // 테마는 다크 하나다(v2.0.0). 예전엔 여기 선택기가 있었는데, 테마가 줄어든 뒤에도
    // 남아 있어서 `data-theme="light"`를 세우고 있었다 — 아무 일도 안 하는데 뭔가
    // 하는 것처럼 보이는 표면이었다.
    document.documentElement.setAttribute("data-theme", "dark");
    linkIndex.set(fixtureIndex);
    grepPattern.set("창");
    grepReplacement.set("창문");
    grepResult.set({
      hits: [
        { path: "/v/알파.md", line: 4, text: "창을 열다. 창이 둘.", col: 0, len: 1, clipped: false },
        { path: "/v/베타.md", line: 1, text: "창 하나 더.", col: 0, len: 1, clipped: false },
      ],
      files: 2,
      scanned: 6,
      truncated: false,
    });
    replacePreview.set(fixtureReplace);
    // 엔진 갈림 경고까지 보이게 — 이 줄이 실제로 뜨는 모습을 확인하기 어려워서 여기서 강제한다.
    replaceEngineSkew.set(1);
    brokenLinksOpen.set(surface === "hygiene");
    grepOpen.set(surface === "replace");
  }

  $effect(() => {
    // surface가 바뀔 때마다 다시 세운다.
    void surface;
    apply();
  });
</script>

{#if DEV}
  <div class="bar">
    <strong>컴포넌트 미리보기</strong>
    <span class="note">개발 전용 · 데이터는 픽스처다</span>
    <label>
      화면
      <select bind:value={surface}>
        <option value="hygiene">vault 위생</option>
        <option value="replace">찾아 바꾸기</option>
      </select>
    </label>
    <span class="note">테마: dark 고정</span>
  </div>

  <VaultHygieneModal />
  <GrepModal />
{:else}
  <!-- 프로덕션에서는 아무것도 없다. -->
{/if}

<style>
  .bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1;
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 8px 16px;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: 0.85rem;
  }
  .note {
    color: var(--text-secondary);
  }
  label {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-secondary);
  }
  select {
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    padding: 3px 6px;
  }
</style>
