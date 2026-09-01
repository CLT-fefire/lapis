import { describe, it, expect } from "vitest";
import { candidatePaths, locateApp, locateRemedy } from "./appLocate.ts";

const WIN_ENV = { LOCALAPPDATA: "C:\\u\\Local", ProgramFiles: "C:\\Program Files" };
const MAC_ENV = { HOME: "/Users/x" };

const none = () => false;
const only =
  (...hits: string[]) =>
  (p: string) =>
    hits.includes(p);

/**
 * ⚠️ 기대값을 손으로 적지 않고 `candidatePaths`에서 가져온다. 손으로 적으면 **호스트
 * 플랫폼의 구분자**가 섞여 리눅스 CI에서만 깨진다(실제로 깨졌다). 이 테스트가 보려는
 * 것은 "어떤 문자열이냐"가 아니라 "후보를 찾아내느냐 · 순서를 지키느냐"다.
 */
const WIN_INSTALLED = candidatePaths("win32", WIN_ENV)[0];

describe("앱 실행파일 찾기", () => {
  it("LAPIS_APP이 있으면 그것만 쓴다", () => {
    const r = locateApp("win32", { ...WIN_ENV, LAPIS_APP: "D:\\custom\\Lapis.exe" }, () => true);
    expect(r).toEqual({ ok: true, exe: "D:\\custom\\Lapis.exe", source: "env" });
  });

  /**
   * ⚠️ 지정한 게 없으면 **후보로 넘어가지 않는다.**
   *
   * 넘어가면 사용자가 고른 빌드가 아니라 우연히 먼저 걸린 빌드를 쓰게 되는데, dev 빌드와
   * 릴리즈 빌드는 **캐시 디렉터리가 다르다**(`paths.rs`의 `-dev`). 엉뚱한 쪽을 인덱싱하면
   * 앱에서는 아무 변화도 없고, 왜 그런지 알 방법도 없다.
   */
  it("LAPIS_APP이 틀렸으면 조용히 딴 걸 쓰지 않고 실패한다", () => {
    const r = locateApp("win32", { ...WIN_ENV, LAPIS_APP: "D:\\gone.exe" }, only(WIN_INSTALLED));
    expect(r).toEqual({ ok: false, tried: ["D:\\gone.exe"] });
  });

  it("Windows 기본 설치 위치를 찾는다", () => {
    const r = locateApp("win32", WIN_ENV, only(WIN_INSTALLED));
    expect(r).toEqual({ ok: true, exe: WIN_INSTALLED, source: "installed" });
    // 후보가 호스트가 아니라 **대상 플랫폼**의 규칙으로 조립돼야 한다.
    expect(WIN_INSTALLED).toBe("C:\\u\\Local\\Lapis\\Lapis.exe");
  });

  it("후보 순서를 지킨다 — 둘 다 있으면 앞의 것", () => {
    const [first, second] = candidatePaths("win32", WIN_ENV);
    const r = locateApp("win32", WIN_ENV, only(first, second));
    expect(r).toEqual({ ok: true, exe: first, source: "installed" });
  });

  it("macOS는 /Applications를 먼저 본다", () => {
    expect(candidatePaths("darwin", MAC_ENV)[0]).toBe("/Applications/Lapis.app/Contents/MacOS/Lapis");
  });

  it("환경변수가 비어도 죽지 않는다", () => {
    expect(candidatePaths("win32", {})).toEqual([]);
    expect(locateApp("win32", {}, none)).toEqual({ ok: false, tried: [] });
  });

  it("못 찾으면 어디를 봤는지 전부 알려준다", () => {
    const r = locateApp("win32", WIN_ENV, none);
    expect(r.ok).toBe(false);
    const msg = locateRemedy(r.ok ? [] : r.tried);
    // 어디를 봤는지 안 알려주면 고칠 방법이 없다.
    for (const c of candidatePaths("win32", WIN_ENV)) expect(msg).toContain(c);
    expect(msg).toContain("LAPIS_APP");
  });

  it("후보가 하나도 없는 플랫폼에서도 처방이 읽힌다", () => {
    expect(locateRemedy([])).toContain("후보 없음");
  });
});
