---
title: 네이티브 호출 계약
doc_kind: adr
topic: desktop-app
status: active
created: 2026-06-17
tags: [tech/tauri, architecture/store-pattern]
related: [capability-permissions]
---

# 네이티브 호출 계약

네이티브 명령은 타입을 붙인 래퍼로만 부른다. 화면 코드가 문자열로 직접
부르면 이름이 바뀌었을 때 런타임에야 안다.

결과는 성공과 실패를 함께 담는 타입으로 돌린다. [[capability-permissions]] 참조.
