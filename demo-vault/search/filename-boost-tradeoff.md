---
title: 파일명 가중치의 대가
doc_kind: adr
topic: search-indexing
status: active
created: 2026-05-09
tags: [subject/search, issue/recall]
related: [note-naming-convention]
---

# 파일명 가중치의 대가

파일명 필드에 가중치를 준다. 사람이 붙인 이름이 본문보다 신호가 세다.

다만 대가가 있다 — 파일명에 한글을 쓰면 bigram 노이즈가 가중치만큼
증폭된다. 실측에서 오답 1위의 11%가 한글 파일명이었고 코퍼스 비율은 1.5%였다.
그래서 파일명은 영문 kebab-case로 강제한다. [[note-naming-convention]] 참조.
