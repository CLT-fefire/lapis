---
title: 단축키 매칭
doc_kind: adr
topic: desktop-app
status: active
created: 2026-06-21
tags: [subject/editor]
related: [command-palette-architecture]
---

# 단축키 매칭

단축키 해석과 실제 동작을 분리한다. 매칭 함수는 어떤 명령인지만 돌려주고
부르는 쪽이 실행한다. 그래야 매칭을 테스트할 수 있다.

같은 키에 두 동작을 묶을 때는 보조 키 조합을 명시적으로 갈라 적는다.
