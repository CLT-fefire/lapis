---
title: 개발 빌드와 설치 빌드 분리
doc_kind: solution
topic: vault-storage
status: active
created: 2026-06-15
tags: [subject/vault, issue/stale-cache, tech/tauri]
related: [disk-cache-shards]
---

# 개발 빌드와 설치 빌드 분리

## 증상

개발 빌드와 설치한 앱이 같은 데이터 디렉터리를 써서 서로의 캐시를 덮었다.
번갈아 켤 때마다 인덱스를 다시 세웠다.

## 처방

빌드별로 데이터 디렉터리를 나눈다. 캐시가 섞이지 않는다.
