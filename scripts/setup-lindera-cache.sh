#!/usr/bin/env bash
# lindera-ko-dic build script가 사용할 mecab-ko-dic cache 셋업.
#
# `lindera-ko-dic` crate의 build.rs는 `embed-ko-dic` feature가 켜지면
# build 시점에 mecab-ko-dic-2.1.1-20180720.tar.gz(~50MB)를 https://lindera.dev에서
# 다운로드해 binary에 임베디드한다. 일부 환경(sandbox / CI agent / enterprise
# firewall)에서 build script의 outbound가 차단되면 `cargo build`가 통째로 실패.
#
# 이 스크립트는:
#   1) cache 디렉토리 박제 (`$LINDERA_DICTIONARIES_PATH/<lkd-version>/<file>`)
#   2) 사전 파일이 없거나 MD5 불일치면 curl로 다운로드
#   3) `.cargo/config.toml`에 `LINDERA_DICTIONARIES_PATH` env 박제 (사용자가
#      `~/.zshrc`에 export 안 해도 cargo가 cache를 인식하도록)
#
# 한 번 실행 후 캐시는 영속화. 향후 빌드는 즉시 cache hit.
#
# 사용:
#   npm run setup:lindera
#   또는
#   bash scripts/setup-lindera-cache.sh
#
# 참고: [solutions/build/lindera-ko-dic-cache-20260513.md]

set -euo pipefail

# lindera-ko-dic 버전 — Cargo.lock의 실제 값과 일치해야 함.
# 변경 시 `grep -A1 'name = "lindera-ko-dic"' src-tauri/Cargo.lock`로 확인.
LKD_VERSION="${LKD_VERSION:-2.3.4}"
DICT_FILE="mecab-ko-dic-2.1.1-20180720.tar.gz"
DICT_URL="https://lindera.dev/${DICT_FILE}"
DICT_MD5="b996764e91c96bc89dc32ea208514a96"

CACHE_ROOT="${LINDERA_DICTIONARIES_PATH:-$HOME/.cache/lindera}"
CACHE_DIR="${CACHE_ROOT}/${LKD_VERSION}"
CACHE_FILE="${CACHE_DIR}/${DICT_FILE}"

echo "[lapis] lindera-ko-dic cache → ${CACHE_FILE}"

mkdir -p "${CACHE_DIR}"

md5_of() {
  local file="$1"
  if command -v md5 >/dev/null 2>&1; then
    md5 -q "${file}"
  elif command -v md5sum >/dev/null 2>&1; then
    md5sum "${file}" | awk '{print $1}'
  else
    echo ""  # md5 도구 없으면 비교 스킵 (다운로드 자체로 신뢰)
  fi
}

needs_download=1
if [[ -f "${CACHE_FILE}" ]]; then
  actual=$(md5_of "${CACHE_FILE}")
  if [[ -z "${actual}" ]]; then
    echo "[lapis] md5 도구 없음 → cache 신뢰 (검증 스킵)"
    needs_download=0
  elif [[ "${actual}" == "${DICT_MD5}" ]]; then
    echo "[lapis] cache hit (md5 일치)"
    needs_download=0
  else
    echo "[lapis] cache 손상 (md5 ${actual} != ${DICT_MD5}) → 재다운로드"
    rm -f "${CACHE_FILE}"
  fi
fi

if [[ "${needs_download}" -eq 1 ]]; then
  echo "[lapis] ${DICT_URL} (~50MB) 다운로드..."
  curl -L --fail --silent --show-error -o "${CACHE_FILE}" "${DICT_URL}"
  actual=$(md5_of "${CACHE_FILE}")
  if [[ -n "${actual}" ]] && [[ "${actual}" != "${DICT_MD5}" ]]; then
    echo "[lapis] ERROR: 다운로드된 파일 md5 불일치 (${actual} != ${DICT_MD5})" >&2
    exit 1
  fi
  echo "[lapis] 다운로드 완료"
fi

# .cargo/config.toml에 env 박제. 이미 있으면 손대지 않음 (사용자가 수동 편집 가능성).
CARGO_CONFIG=".cargo/config.toml"
if [[ -f "${CARGO_CONFIG}" ]]; then
  echo "[lapis] ${CARGO_CONFIG} 이미 존재 → 건드리지 않음"
else
  mkdir -p "$(dirname "${CARGO_CONFIG}")"
  cat > "${CARGO_CONFIG}" <<EOF
# 자동 생성: scripts/setup-lindera-cache.sh
# lindera-ko-dic build script가 cache를 참조하도록 환경 변수 박제.
# 이 파일은 .gitignore — 사용자 절대 경로 의존이라 공유 불가.
[env]
LINDERA_DICTIONARIES_PATH = "${CACHE_ROOT}"
EOF
  echo "[lapis] ${CARGO_CONFIG} 생성"
fi

echo "[lapis] 셋업 완료. 이제 'npm run tauri dev' 또는 'cargo build' 가능."
