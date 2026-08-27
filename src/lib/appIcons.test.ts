import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * 앱 아이콘 컨테이너(`icon.icns` · `icon.ico`)가 **곁의 PNG와 같은 그림인지** 본다.
 *
 * ## 왜 이 가드가 있나
 *
 * 아이콘을 새로 만들었을 때 `.exe` 안에는 **옛 아이콘이 남아 있었다.** 디스크의 파일은
 * 정확히 새것이라 파일을 열어 확인하면 통과했다 — 어긋난 것은 파일이 아니라 **컨테이너
 * 안의 사본**이었다.
 *
 * 아이콘 자산은 원본 하나에서 여러 벌 파생된다(PNG 여러 크기 · `.icns` · `.ico`).
 * **일부만 다시 만들면 아무 에러 없이 반쪽이 된다.** 빌드는 초록이고, 화면에서만 틀린다.
 * 그래서 파생물이 원본과 **바이트로 같은지** 못 박는다.
 *
 * ## ⚠️ 이 가드가 못 잡는 것
 *
 * **`.exe`/`.app`에 실제로 박히는 단계는 못 본다.** 그건 빌드 산출물이고 저장소에 없다.
 * Cargo가 빌드 스크립트를 다시 안 돌리면 파일이 다 맞아도 바이너리 안은 옛것이다 —
 * 그건 릴리스 때 손으로 확인한다(`README.md`의 아이콘 교체 절).
 *
 * 여기서 잡는 것은 **저장소 안에서 확인 가능한 절반**: 컨테이너와 PNG가 갈리는 것.
 */

const icons = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../src-tauri/icons/${name}`, import.meta.url)));

const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG IHDR에서 크기를 읽는다. */
function pngSize(b: Buffer): { w: number; h: number } {
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * ICNS 컨테이너를 편다. 8바이트 헤더 뒤로 `[4바이트 타입][4바이트 길이][데이터]`가 이어진다.
 * 길이는 **헤더 8바이트를 포함**한다.
 */
function readIcns(buf: Buffer) {
  expect(buf.subarray(0, 4).toString("latin1"), "icns 매직").toBe("icns");
  // 선언 길이가 실제와 다르면 잘렸거나 덧붙은 것이다.
  expect(buf.readUInt32BE(4), "icns 선언 길이").toBe(buf.length);

  const out: Array<{ type: string; data: Buffer }> = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const type = buf.subarray(off, off + 4).toString("latin1");
    const len = buf.readUInt32BE(off + 4);
    if (len < 8 || off + len > buf.length) break;
    out.push({ type, data: buf.subarray(off + 8, off + len) });
    off += len;
  }
  return out;
}

/** ICO 디렉터리를 편다. 6바이트 헤더 + 16바이트 엔트리 n개. */
function readIco(buf: Buffer) {
  expect(buf.readUInt16LE(0), "ico reserved").toBe(0);
  expect(buf.readUInt16LE(2), "ico type(1=icon)").toBe(1);
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const e = 6 + i * 16;
    const size = buf.readUInt32LE(e + 8);
    const off = buf.readUInt32LE(e + 12);
    return {
      // 0은 256을 뜻한다 — 한 바이트에 안 들어가서.
      w: buf[e] || 256,
      h: buf[e + 1] || 256,
      data: buf.subarray(off, off + size),
    };
  });
}

/** 원본 PNG들 — 이 파일들이 기준이다. */
const SOURCES = ["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png"] as const;

describe("아이콘 원본 PNG", () => {
  it.each(SOURCES)("%s 가 읽히는 PNG다", (name) => {
    const b = icons(name);
    expect(b.subarray(0, 8).equals(PNG_MAGIC), "PNG 매직").toBe(true);
    expect(pngSize(b).w).toBeGreaterThan(0);
  });

  it("파일 이름과 실제 크기가 맞는다", () => {
    expect(pngSize(icons("32x32.png"))).toEqual({ w: 32, h: 32 });
    expect(pngSize(icons("64x64.png"))).toEqual({ w: 64, h: 64 });
    expect(pngSize(icons("128x128.png"))).toEqual({ w: 128, h: 128 });
    // @2x는 128 슬롯의 2배 = 256이다. 128로 만들어 두면 Retina에서 뿌옇게 나온다.
    expect(pngSize(icons("128x128@2x.png"))).toEqual({ w: 256, h: 256 });
  });
});

describe("icon.icns — macOS", () => {
  const parsed = readIcns(icons("icon.icns"));
  const pngs = parsed.filter((e) => e.data.subarray(0, 8).equals(PNG_MAGIC));

  /**
   * ⚠️ **카나리아.** 파서가 깨지면 `pngs`가 비고 아래 대조는 **빈 목록을 돌며 통과한다.**
   */
  it("PNG 슬롯을 실제로 뽑았다", () => {
    expect(pngs.length).toBeGreaterThanOrEqual(6);
  });

  /** macOS가 실제로 쓰는 슬롯들. 하나라도 빠지면 그 크기에서 다른 것이 늘어나 뿌옇다. */
  it("필요한 슬롯이 다 있다", () => {
    const types = parsed.map((e) => e.type);
    for (const t of ["ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]) {
      expect(types, `${t} 슬롯`).toContain(t);
    }
  });

  it("슬롯이 선언한 크기와 그림의 실제 크기가 맞는다", () => {
    const EXPECT: Record<string, number> = {
      ic07: 128,
      ic08: 256,
      ic09: 512,
      ic10: 1024,
      ic11: 32,
      ic12: 64,
      ic13: 256,
      ic14: 512,
    };
    for (const { type, data } of pngs) {
      const want = EXPECT[type];
      if (!want) continue;
      expect(pngSize(data), `${type}`).toEqual({ w: want, h: want });
    }
  });

  /**
   * **핵심.** icns 안의 그림이 곁의 PNG와 바이트로 같아야 한다. 하나만 다시 만들면
   * 여기서 갈린다 — 그게 아이콘 교체가 조용히 반쪽 나는 방식이다.
   */
  it("슬롯이 원본 PNG와 바이트로 같다", () => {
    const bySize = new Map(pngs.map((e) => [pngSize(e.data).w, md5(e.data)]));
    expect(bySize.get(32), "32px").toBe(md5(icons("32x32.png")));
    expect(bySize.get(64), "64px").toBe(md5(icons("64x64.png")));
    expect(bySize.get(128), "128px").toBe(md5(icons("128x128.png")));
    expect(bySize.get(256), "256px").toBe(md5(icons("128x128@2x.png")));
    expect(bySize.get(512), "512px").toBe(md5(icons("icon.png")));
  });
});

describe("icon.ico — Windows", () => {
  const entries = readIco(icons("icon.ico"));

  it("엔트리를 실제로 뽑았다", () => {
    expect(entries.length).toBeGreaterThanOrEqual(4);
  });

  /** 작업줄·시작 메뉴·탐색기가 각각 다른 크기를 집는다. 없는 크기는 늘려 쓴다. */
  it("흔히 쓰는 크기를 담고 있다", () => {
    const sizes = new Set(entries.map((e) => e.w));
    for (const s of [16, 32, 48, 256]) expect(sizes, `${s}px`).toContain(s);
  });

  it("디렉터리가 선언한 크기와 그림의 실제 크기가 맞는다", () => {
    for (const e of entries) {
      if (!e.data.subarray(0, 8).equals(PNG_MAGIC)) continue; // BMP 엔트리는 건너뛴다
      expect(pngSize(e.data), `${e.w}px 엔트리`).toEqual({ w: e.w, h: e.h });
    }
  });
});

describe("SVG 원본", () => {
  /** 라이트/다크 둘 다 있어야 한다. 하나만 두면 다른 테마에서 안 보이는 색이 된다. */
  it.each(["lapis-light.svg", "lapis-dark.svg"])("%s 가 SVG다", (name) => {
    const s = icons(name).toString("utf-8");
    expect(s).toMatch(/<svg[\s>]/);
    expect(s).toMatch(/<\/svg>\s*$/);
  });

  /** 둘이 같은 파일이면 테마 대응이 안 된 것이다 — 이름만 둘인 상태. */
  it("라이트와 다크가 실제로 다르다", () => {
    expect(md5(icons("lapis-light.svg"))).not.toBe(md5(icons("lapis-dark.svg")));
  });
});
