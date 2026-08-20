---
title: 증분 색인
doc_kind: plan
topic: search-indexing
status: active
created: 2026-05-15
tags: [subject/search, issue/latency, architecture/index-rebuild]
related: [file-watcher-debounce]
---

# 증분 색인

저장 한 번에 인덱스를 통째로 다시 세우면 큰 vault에서 체감이 나쁘다.
변경된 문서만 걷어내고 다시 넣는 경로가 필요하다.

감시자가 알려주는 변경 목록을 모아 일정 시간 뒤 한 번에 처리한다.
[[file-watcher-debounce]]와 같은 창을 쓴다.
