---
title: 초성 파일명 검색
doc_kind: reference
topic: search-indexing
status: active
created: 2026-05-08
tags: [subject/search, issue/latency]
related: [filename-boost-tradeoff]
---

# 초성 파일명 검색

파일명 검색에 초성 질의를 넣었다. `ㅋㅅ`를 치면 `캐시`가 걸린다.
초성 형태를 파일마다 미리 계산해 두므로 키 입력마다 다시 만들지 않는다.

본문 인덱스에는 넣지 않았다. 초성은 충돌이 너무 많아 본문 규모에서는
노이즈가 이득을 넘는다.
