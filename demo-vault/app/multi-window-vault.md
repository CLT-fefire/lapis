---
title: 창마다 다른 vault
doc_kind: plan
topic: desktop-app
status: active
created: 2026-06-19
tags: [subject/vault, tech/tauri]
related: [tab-state-persistence]
---

# 창마다 다른 vault

창을 새로 열면 다른 vault를 담을 수 있다. 개인 노트와 프로젝트 문서를
나란히 두고 볼 때 쓴다.

창마다 인덱스를 따로 세우므로 메모리가 곱해진다. 캐시는 공유한다.
