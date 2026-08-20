---
title: 경로 탈출 차단
doc_kind: adr
topic: vault-storage
status: active
created: 2026-06-06
tags: [subject/vault, issue/path-traversal]
related: [extension-whitelist, canonicalize-symlink]
---

# 경로 탈출 차단

vault 밖 경로를 읽거나 쓰지 못하게 막는다. 상위 디렉터리 표기와 심볼릭 링크로
밖으로 나갈 수 있으므로 정규화한 뒤 뿌리로 시작하는지 확인한다.

확장자도 제한한다. [[extension-whitelist]] · [[canonicalize-symlink]] 참조.
