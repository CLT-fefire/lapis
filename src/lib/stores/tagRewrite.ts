import { writable, get } from "svelte/store";
import { computeTagRewritePreview, type TagRewritePreview } from "$lib/tagRewrite";
import { readNote } from "$lib/tauri/notes";
import { linkIndex, vaultPath, backupAndWrite, reloadNotes } from "$lib/stores/vault";
import { describeFailure } from "$lib/safeWrite";
import { tagIndex } from "$lib/stores/tags";
import { logWarn } from "$lib/stores/usage";

/**
 * 태그 이름 바꾸기의 **상태 절반**. 판정·치환은 전부 `$lib/tagRewrite`(순수)에 있다.
 *
 * ## 왜 두 단계인가 — 미리보기 후 적용
 *
 * 미리보기 계산은 **모든 노트를 읽는다**(19,000 파일). 타이핑마다 돌릴 수 없다.
 * 그래서 명시적으로 [미리보기] → 결과 확인 → [적용] 순서다. 링크 rename이 confirm
 * 모달을 띄우는 것과 같은 이유고, **되돌릴 수 없는 쓰기 앞에는 항상 dry-run이 선다.**
 */

export const tagRenameOpen = writable<boolean>(false);
export const tagRenameOld = writable<string>("");
export const tagRenameNew = writable<string>("");
export const tagRenamePreview = writable<TagRewritePreview | null>(null);
export const tagRenameBusy = writable<boolean>(false);
export const tagRenameError = writable<string | null>(null);

export function openTagRename(initialTag = ""): void {
  tagRenameOld.set(initialTag);
  tagRenameNew.set("");
  tagRenamePreview.set(null);
  tagRenameError.set(null);
  tagRenameOpen.set(true);
}

export function closeTagRename(): void {
  tagRenameOpen.set(false);
}

/**
 * vault에 실제로 쓰이고 있는 태그들 — 병합 판정과 입력 자동완성에 쓴다.
 *
 * `counts`의 키는 소문자다. 사용자가 보고 입력하는 건 **표시용 원본 케이스**라
 * `display`의 값을 쓴다.
 */
export function knownTags(): string[] {
  const ti = get(tagIndex);
  if (!ti) return [];
  return [...ti.display.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * dry-run. 모든 노트를 읽어 영향 범위를 계산한다.
 *
 * ⚠️ 결과를 계산해두고 **`newContent`까지 담아둔다.** 적용 단계가 파일을 다시 읽으면,
 * 미리보기를 보여준 내용과 실제로 쓰는 내용이 갈릴 수 있다(그 사이 외부 도구가 vault를
 * 건드리는 게 이 앱의 기본 전제다).
 */
export async function computeTagRenamePreview(): Promise<void> {
  const idx = get(linkIndex);
  const oldTag = get(tagRenameOld).trim();
  const newTag = get(tagRenameNew).trim();
  if (!idx || !oldTag || !newTag) return;

  tagRenameBusy.set(true);
  tagRenameError.set(null);
  try {
    const notes = new Map<string, string>();
    await Promise.all(
      [...idx.byPath.keys()].map(async (p) => {
        try {
          notes.set(p, await readNote(p));
        } catch (e) {
          // 한 파일을 못 읽었다고 전체를 세우지 않는다. 그 노트만 대상에서 빠진다.
          logWarn("stores/tagRewrite", `[tag-rename] readNote 실패 ${p}:`, e);
        }
      }),
    );
    tagRenamePreview.set(computeTagRewritePreview(notes, oldTag, newTag, knownTags()));
  } catch (e) {
    tagRenameError.set(e instanceof Error ? e.message : String(e));
    tagRenamePreview.set(null);
  } finally {
    tagRenameBusy.set(false);
  }
}

/**
 * 적용 — 링크 rename과 **같은 트랜잭션**(백업 → 순차 write → 실패 시 롤백 → prune)을 탄다.
 *
 * 쓰기 뒤에 인덱스를 다시 만든다. 안 하면 사이드바 태그 트리가 옛 이름을 계속 보여준다.
 */
export async function applyTagRename(): Promise<void> {
  const vault = get(vaultPath);
  const preview = get(tagRenamePreview);
  if (!vault || !preview || preview.items.length === 0) return;

  tagRenameBusy.set(true);
  tagRenameError.set(null);
  try {
    const outcome = await backupAndWrite(vault, preview);
    if (!outcome.ok) {
      // ⚠️ **실패하면 모달을 닫지 않는다.** 예전엔 결과를 안 보고 닫아서, 백업이
      // 실패해 아무것도 안 썼는데도 사용자에게는 성공으로 보였다. 되돌릴 수 없는
      // 쓰기에서 그건 가장 나쁜 실패다 — 됐다고 믿게 만든다.
      tagRenameError.set(describeFailure(outcome));
      return;
    }
    closeTagRename();
    // 쓰기 뒤에 인덱스를 다시 만든다. 안 하면 사이드바 태그 트리가 옛 이름을 보여준다.
    await reloadNotes();
  } catch (e) {
    tagRenameError.set(e instanceof Error ? e.message : String(e));
  } finally {
    tagRenameBusy.set(false);
  }
}
