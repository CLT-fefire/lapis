---
title: 이름 바꾸면 참조를 고친다
doc_kind: plan
topic: vault-storage
status: active
created: 2026-06-10
tags: [subject/vault, issue/atomic-write]
related: [backup-before-rewrite, link-resolver-ambiguity]
---

# 이름 바꾸면 참조를 고친다

파일 이름을 바꾸면 그 파일을 가리키는 링크가 전부 깨진다. 역참조 인덱스를
이미 갖고 있으니 따라가 고칠 수 있다.

다만 여러 파일을 한꺼번에 고치는 작업이라 되돌리기가 어렵다.
미리보기와 백업을 앞에 둔다 — [[backup-before-rewrite]] 참조.
