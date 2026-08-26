#!/bin/sh
# bundle-run.sh — TS 진입점을 호출 시점에 번들해서 Node로 실행한다.
#
#   사용: scripts/bundle-run.sh <이름> <진입점 절대경로> [인자...]
#
# `mcp/lapis-mcp` · `mcp/lapis-bench` · `mcp/lapis-eval` · `cli/lapis`가 전부 이걸 쓴다.
# 예전엔 래퍼마다 같은 로직을 복제하고 있었다(38줄 × 3). 네 번째를 더하는 대신 하나로
# 합쳤다 — 아래 주석의 함정들은 하나씩 실측으로 알아낸 것이라, 사본이 늘면 그중 하나만
# 고쳐지고 나머지는 조용히 옛 버그를 유지한다.
#
# ## 왜 사전 빌드가 아니라 호출 시점 번들인가
#
# 커밋된 산출물이나 별도 빌드 단계를 두면 **소스와 어긋나도 아무 신호가 없다.** 캐시
# skew(`CACHE_VERSION` v7)로 이미 겪은 계열의 결함이다. 번들이 작아 ~30ms면 끝나고,
# stdio 서버는 상주하므로 질의당 비용도 아니다.
set -e

NAME=$1
ENTRY=$2
[ -n "$NAME" ] && [ -n "$ENTRY" ] || {
  echo "bundle-run.sh: 사용법 — bundle-run.sh <이름> <진입점> [인자...]" >&2
  exit 2
}
shift 2

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$HERE")

# ⚠️ **PATH에 의존하지 않는다.** MCP 클라이언트는 서버를 **최소 환경**으로 띄운다 —
# Claude Desktop은 `/usr/bin:/bin:/usr/sbin:/sbin` 정도만 준다. 그러면 homebrew에 있는
# node(`/opt/homebrew/bin/node`)가 안 잡혀 `exec: node: not found`로 **조용히 죽는다**
# (클라이언트엔 "서버가 안 뜬다"로만 보인다). 실측으로 재현했다.
# 후보를 순서대로 훑고, 없으면 **소리내어** 실패한다.
find_node() {
  for c in "$LAPIS_NODE" "$(command -v node 2>/dev/null)" \
           /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}
NODE=$(find_node) || {
  echo "$NAME: node를 찾을 수 없다. LAPIS_NODE 환경변수로 절대 경로를 주거나 node를 설치하라." >&2
  exit 127
}

# ⚠️ 출력 경로를 uid 고정으로 두면(`…-$(id -u).mjs`) 세션 두 개가 동시에 기동할 때 같은
# 파일에 esbuild가 겹쳐 쓴다. esbuild는 임시 파일 후 rename이 아니라 **직접 쓰므로**,
# 한쪽이 쓰는 중인 파일을 다른 쪽이 실행해 구문 오류로 죽거나 절반만 로드된다.
# 실패가 프로세스 사망이라 호출부엔 "안 뜬다"로만 보인다. → 호출별 고유 임시 파일.
#
# ⚠️ 정리는 두 갈래다. `exec`이 셸을 **대체**하므로 성공 경로에서는 EXIT trap이 돌지 않는다
# (trap은 esbuild가 실패해 `set -e`로 빠지는 경로에서만 유효하다). 그래서 정상 종료해도
# 파일 하나가 남는다 → 기동할 때 하루 지난 잔재를 먼저 쓸어낸다.
#
# ⚠️ `mktemp`를 쓰지 않는다. BSD(macOS) mktemp는 템플릿의 `X`가 **끝에 있어야** 치환하는데
# `.mjs` 확장자가 필요해서 `…XXXXXXXX.mjs`로 쓰면 **글자 그대로** 그 이름의 파일을 만든다.
# 그러면 고유해지지 않아 레이스가 그대로 남는다(실측: 동시 4개 기동이 전부 빈 응답).
# 셸 pid는 살아 있는 프로세스 사이에서 고유하고, 그게 정확히 막으려는 레이스의 범위다.
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'lapis-*.mjs' -mtime +1 -delete 2>/dev/null || true
OUT="${TMPDIR:-/tmp}/lapis-$NAME-$$.mjs"
trap 'rm -f "$OUT"' HUP INT TERM

# esbuild도 같은 이유로 리포 내 절대 경로를 쓴다(PATH 무관).
ESBUILD="$REPO/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || {
  echo "$NAME: esbuild가 없다 — $REPO 에서 'npm install' 을 먼저 실행하라." >&2
  exit 127
}

# `$lib` 별칭과 확장자 없는 상대 import 때문에 Node가 앱 트리를 직접 못 읽는다.
# `--alias:$lib=src/lib` 하나로 둘 다 풀린다.
"$ESBUILD" "$ENTRY" \
  --bundle --format=esm --platform=node --log-level=warning \
  --alias:'$lib'="$REPO/src/lib" \
  --outfile="$OUT" --allow-overwrite >&2

# 번들은 TMPDIR에 있어 리포 위치를 모른다. `--version`처럼 package.json이 필요한 곳이
# 있어 여기서 넘긴다.
LAPIS_REPO="$REPO"
export LAPIS_REPO

exec "$NODE" --no-warnings "$OUT" "$@"
