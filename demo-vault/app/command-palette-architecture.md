---
title: 명령 팔레트 구조
doc_kind: adr
topic: desktop-app
status: active
created: 2026-06-26
tags: [subject/editor, subject/search]
related: [keyboard-shortcut-matching, full-text-search-design]
---

# 명령 팔레트 구조

팔레트 하나가 여러 모드를 처리한다. 파일명 검색, 본문 검색, 명령 실행이
같은 컴포넌트다. 결과를 그룹으로 나눠 렌더한다.

그룹은 파일명, 본문, 태그, 속성, 명령이다. 모드에 따라 어떤 그룹을 낼지 고른다.
[[full-text-search-design]] 참조.
