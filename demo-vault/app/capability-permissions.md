---
title: 권한 누락은 조용히 실패한다
doc_kind: solution
topic: desktop-app
status: active
created: 2026-06-18
tags: [tech/tauri, issue/regression]
related: [tauri-ipc-contract]
---

# 권한 누락은 조용히 실패한다

새 기능을 붙였는데 아무 일도 일어나지 않았다. 에러도 없었다.
권한 목록에 항목을 추가하지 않아서였다.

기능을 붙일 때 권한 파일을 함께 고친다. 콘솔 메시지를 확인하는 습관이 유일한 방어다.
