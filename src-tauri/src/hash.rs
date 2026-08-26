//! 디스크에 남거나 프로세스를 건너 비교되는 해시의 **공용 원시 함수**.
//!
//! ## 왜 std 해시를 쓰지 않나
//!
//! `DefaultHasher`는 std가 **값 안정성을 명시적으로 보장하지 않는다**. 컴파일러 판이
//! 바뀌면 값이 달라질 수 있고, 그 값이 디스크에 남거나 다른 프로세스와 비교되는
//! 순간부터 그건 **조용한 고장**이 된다:
//!
//! - `vault.rs::fingerprint_of` — JS가 재현할 수 없어 MCP가 stale을 mtime으로 추정했다
//!   (캐시 v8에서 닫음).
//! - `search_cache.rs::vault_key` — 캐시 **파일 이름**이라, 값이 바뀌면 파일을 못 찾아
//!   전체 재빌드가 되고 옛 파일은 고아로 남는다.
//!
//! 그래서 두 곳 다 여기 있는 명세된 함수를 쓴다.
//!
//! ## 위협 모델
//!
//! **우연한 변경 탐지**다. 적대적 충돌 저항이 아니고, 그렇게 쓰이지도 않는다.

/// FNV-1a 32비트 오프셋 기저.
pub const FNV32_OFFSET: u32 = 0x811c_9dc5;

/// FNV-1a 32비트 한 줄기.
///
/// `Math.imul` 하나로 JS에서 그대로 재현된다 — 그게 이 알고리즘을 고른 이유다
/// (64비트 FNV는 JS에 64비트 정수가 없어 `BigInt`나 손으로 짠 림브 산술이 필요하다).
pub fn fnv1a32(seed: u32, bytes: &[u8]) -> u32 {
    let mut h = seed;
    for b in bytes {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FNV-1a 32의 공개 테스트 벡터. 구현이 표준에서 벗어나면 여기서 걸린다.
    #[test]
    fn 표준_벡터() {
        assert_eq!(fnv1a32(FNV32_OFFSET, b""), FNV32_OFFSET);
        assert_eq!(fnv1a32(FNV32_OFFSET, b"a"), 0xe40c_292c);
        assert_eq!(fnv1a32(FNV32_OFFSET, b"foobar"), 0xbf9c_f968);
    }

    #[test]
    fn 이어붙이기와_한번에_먹이기가_같다() {
        let once = fnv1a32(FNV32_OFFSET, b"abcdef");
        let split = fnv1a32(fnv1a32(FNV32_OFFSET, b"abc"), b"def");
        assert_eq!(once, split);
    }
}
