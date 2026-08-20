---
title: 큰 vault에서의 체감
doc_kind: reference
topic: vault-storage
status: active
created: 2026-06-13
tags: [subject/vault, issue/latency]
related: [disk-cache-shards, incremental-index-update]
---

# 큰 vault에서의 체감

만 건대 vault에서 첫 색인은 수 초가 걸린다. 이때 파일 트리가 멈추면
앱이 죽은 것처럼 보인다.

트리 표시와 인덱스 구축을 분리한다. 인덱스가 준비되기 전에도 노트를 열 수 있다.
두 번째 실행부터는 [[disk-cache-shards]]로 대부분을 건너뛴다.
