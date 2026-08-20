---
title: 스니펫 추출
doc_kind: solution
topic: search-indexing
status: active
created: 2026-05-12
tags: [subject/search]
related: [full-text-search-design]
---

# 스니펫 추출

결과 행에 본문 일부를 함께 보여준다. 매치 위치 앞뒤를 잘라내는데,
문장 경계를 무시하면 읽을 수 없는 조각이 나온다.

현재는 매치 지점에서 앞뒤로 고정 길이를 잘라낸다. 강조 마크업은 넣지 않는다 —
평문으로 렌더하므로 매치어가 굵게 표시되지는 않는다.

관련: [[full-text-search-design]]
