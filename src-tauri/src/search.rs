//! Phase Search — tantivy + lindera 검색 엔진.
//!
//! FTS5의 prefix wildcard + bm25 채점 본질 한계를 회피하고, 한국어 형태소 분석
//! ("한국어 토큰화 없음" 알려진 한계)도 동시에 해소.
//!
//! 본 파일(단위 #2+#3) 책임:
//! - tantivy schema 정의 (`SearchSchema`)
//! - 인덱스 디렉토리 위치 + open/create (`open_or_create_index`)
//! - lindera 한국어 토크나이저 등록 (`lapis_ko`)
//!
//! mirror sync 통합(#4) / 쿼리 API(#5) / progress UI(#7)는 후속 단위에서.

use lindera::dictionary::{load_embedded_dictionary, DictionaryKind};
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use lindera_tantivy::tokenizer::LinderaTokenizer;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::path::PathBuf;
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::{BooleanQuery, BoostQuery, Occur, PhrasePrefixQuery, Query, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, INDEXED,
    STORED, STRING,
};
use tantivy::snippet::SnippetGenerator;
use tantivy::{doc, Index, IndexWriter, TantivyDocument, Term};
use tauri::{AppHandle, Emitter, Manager};

/// reindex 중 frontend로 발행하는 progress event 이름.
pub const REINDEX_PROGRESS_EVENT: &str = "search-reindex-progress";

#[derive(Debug, Serialize, Clone)]
pub struct ReindexProgress {
    pub current: usize,
    pub total: usize,
    pub added: usize,
}

/// 토크나이저 이름. body/title 필드에 등록. 한국어 형태소 + 영문 lowercase.
pub const KO_TOKENIZER: &str = "lapis_ko";

/// tantivy 인덱스 schema 핸들 — 빌드 후 Field들을 보관해 쿼리/인덱싱 양쪽에서 재사용.
#[derive(Clone)]
pub struct SearchSchema {
    pub schema: Schema,
    pub memory_id: Field,
    pub kind: Field,
    pub source_id: Field,
    pub project: Field,
    pub session_id: Field,
    pub title: Field,
    pub body: Field,
    pub obs_type: Field,
    pub content_hash: Field,
    pub created_at: Field,
    pub created_at_epoch: Field,
}

impl SearchSchema {
    /// schema v1 빌드 — 본 PR에서 처음 도입.
    /// 향후 변경 시 `clear_index` 후 재빌드 (tantivy는 비파괴 마이그레이션 어려움).
    pub fn build() -> Self {
        let mut b = Schema::builder();

        // body/title — lindera 한국어 토크나이저 + 빈도+위치 색인 (snippet 위해 STORED 필요)
        let text_opts = TextOptions::default()
            .set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer(KO_TOKENIZER)
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            )
            .set_stored();

        let memory_id = b.add_u64_field("memory_id", INDEXED | STORED | FAST);
        let kind = b.add_text_field("kind", STRING | STORED | FAST);
        let source_id = b.add_u64_field("source_id", STORED | FAST);
        let project = b.add_text_field("project", STRING | STORED | FAST);
        let session_id = b.add_text_field("session_id", STRING | STORED);
        let title = b.add_text_field("title", text_opts.clone());
        let body = b.add_text_field("body", text_opts);
        let obs_type = b.add_text_field("obs_type", STRING | STORED | FAST);
        let content_hash = b.add_text_field("content_hash", STRING | STORED);
        let created_at = b.add_text_field("created_at", STORED);
        let created_at_epoch = b.add_u64_field("created_at_epoch", STORED | FAST);

        SearchSchema {
            schema: b.build(),
            memory_id,
            kind,
            source_id,
            project,
            session_id,
            title,
            body,
            obs_type,
            content_hash,
            created_at,
            created_at_epoch,
        }
    }
}

/// 인덱스 디렉토리 — `~/Library/Application Support/com.lapis.dev/search-index/`.
pub fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 조회 실패: {e}"))?;
    let p = dir.join("search-index");
    std::fs::create_dir_all(&p).map_err(|e| format!("search-index 디렉토리 생성: {e}"))?;
    Ok(p)
}

/// 인덱스 열거나 신규 생성. lindera 토크나이저 등록까지 한 번에.
pub fn open_or_create_index(app: &AppHandle) -> Result<(Index, SearchSchema), String> {
    let path = index_path(app)?;
    let dir = MmapDirectory::open(&path)
        .map_err(|e| format!("MmapDirectory open({}): {e}", path.display()))?;
    let schema_def = SearchSchema::build();
    let index = Index::open_or_create(dir, schema_def.schema.clone())
        .map_err(|e| format!("Index::open_or_create: {e}"))?;
    register_tokenizers(&index)?;
    Ok((index, schema_def))
}

/// lindera 한국어 (ko-dic) + 기본 lowercase 토크나이저 등록.
/// `embed-ko-dic` feature로 사전이 binary에 임베디드되어 외부 다운로드 불필요.
fn register_tokenizers(index: &Index) -> Result<(), String> {
    let mode = Mode::Normal;
    let dictionary = load_embedded_dictionary(DictionaryKind::KoDic)
        .map_err(|e| format!("lindera ko-dic 로드: {e}"))?;
    let segmenter = Segmenter::new(mode, dictionary, None);
    let tokenizer = LinderaTokenizer::from_segmenter(segmenter);
    index.tokenizers().register(KO_TOKENIZER, tokenizer);
    Ok(())
}

// ─── reindex (단위 #4) ──────────────────────────────────────────────────────

/// reindex 결과 — 사용자/UI 표시용.
#[derive(Debug, Default)]
pub struct ReindexReport {
    pub added: usize,
    pub deleted: usize,
    pub duration_ms: u128,
}

/// mirror sync 후 변경/삭제된 row를 tantivy 인덱스에 반영.
///
/// - `changed`: mirror에서 변경/신규된 `(kind, source_id)` 리스트 — mirror DB에서 본문 재조회 후 add
/// - `deleted_mirror_ids`: 이미 mirror에서 사라진 row의 `mirror.id` (u64) — tantivy에서 delete_term
///
/// `delete_term + add_document` 패턴으로 멱등 보장 (변경 row가 이미 있어도 정상).
pub fn reindex(
    app: &AppHandle,
    changed: &[(String, i64)],
    deleted_mirror_ids: &[i64],
) -> Result<ReindexReport, String> {
    if changed.is_empty() && deleted_mirror_ids.is_empty() {
        return Ok(ReindexReport::default());
    }

    let start = std::time::Instant::now();
    let mut report = ReindexReport::default();

    let (index, schema_def) = open_or_create_index(app)?;
    // tantivy 0.25는 writer가 Document generic이라 타입 명시 필요.
    let mut writer: IndexWriter<TantivyDocument> = index
        .writer(50_000_000) // 50MB heap
        .map_err(|e| format!("tantivy writer: {e}"))?;

    // 1) deleted — tantivy 측 doc 제거. mirror DB는 이미 삭제됨.
    for mid in deleted_mirror_ids {
        let term = Term::from_field_u64(schema_def.memory_id, *mid as u64);
        writer.delete_term(term);
        report.deleted += 1;
    }

    // 2) changed — mirror DB에서 본문 다시 조회 후 delete + add. 매 50건마다 progress emit.
    if !changed.is_empty() {
        let conn = crate::mirror::open_rw(app)?;
        let total = changed.len();
        let mut last_emit = 0usize;
        for (i, (kind, sid)) in changed.iter().enumerate() {
            let row = match fetch_memory_row(&conn, kind, *sid)? {
                Some(r) => r,
                None => continue, // 사이에 삭제됐을 가능성
            };
            let term = Term::from_field_u64(schema_def.memory_id, row.memory_id as u64);
            writer.delete_term(term);

            let obs_type = row.obs_type.unwrap_or_default();
            writer
                .add_document(doc!(
                    schema_def.memory_id => row.memory_id as u64,
                    schema_def.kind => row.kind.as_str(),
                    schema_def.source_id => row.source_id as u64,
                    schema_def.project => row.project.as_str(),
                    schema_def.session_id => row.session_id.as_str(),
                    schema_def.title => row.title.as_str(),
                    schema_def.body => row.body.as_str(),
                    schema_def.obs_type => obs_type.as_str(),
                    schema_def.content_hash => row.content_hash.as_str(),
                    schema_def.created_at => row.created_at.as_str(),
                    schema_def.created_at_epoch => row.created_at_epoch as u64,
                ))
                .map_err(|e| format!("add_document: {e}"))?;
            report.added += 1;

            // 50 row마다 emit + 마지막 row에 emit (사용자 progress 표시)
            if (i + 1) - last_emit >= 50 || i + 1 == total {
                let _ = app.emit(
                    REINDEX_PROGRESS_EVENT,
                    ReindexProgress {
                        current: i + 1,
                        total,
                        added: report.added,
                    },
                );
                last_emit = i + 1;
            }
        }
    }

    writer.commit().map_err(|e| format!("writer commit: {e}"))?;
    report.duration_ms = start.elapsed().as_millis();
    Ok(report)
}

/// mirror DB의 `memories` 한 row를 tantivy doc 생성용으로 박제.
struct MemoryRow {
    memory_id: i64,
    kind: String,
    source_id: i64,
    project: String,
    session_id: String,
    title: String,
    body: String,
    obs_type: Option<String>,
    content_hash: String,
    created_at: String,
    created_at_epoch: i64,
}

fn fetch_memory_row(
    conn: &rusqlite::Connection,
    kind: &str,
    source_id: i64,
) -> Result<Option<MemoryRow>, String> {
    conn.query_row(
        "SELECT id, kind, source_id, project, session_id, title, body, obs_type, content_hash, created_at, created_at_epoch \
         FROM memories WHERE kind = ? AND source_id = ?",
        params![kind, source_id],
        |r| {
            Ok(MemoryRow {
                memory_id: r.get(0)?,
                kind: r.get(1)?,
                source_id: r.get(2)?,
                project: r.get(3)?,
                session_id: r.get(4)?,
                title: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                body: r.get(6)?,
                obs_type: r.get(7)?,
                content_hash: r.get(8)?,
                created_at: r.get(9)?,
                created_at_epoch: r.get(10)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("memory row fetch (kind={kind}, source_id={source_id}): {e}"))
}

/// 인덱스가 비어 있으면 mirror의 모든 row를 reindex. mirror가 비어 있으면 NOOP.
/// 시점: 앱 setup hook 또는 첫 vault open IIFE 다음. 백그라운드 thread에서 실행 권장.
pub fn ensure_index_built(app: &AppHandle) -> Result<ReindexReport, String> {
    let (index, _schema_def) = open_or_create_index(app)?;
    let reader = index
        .reader()
        .map_err(|e| format!("index reader: {e}"))?;
    let num_docs = reader.searcher().num_docs();
    if num_docs > 0 {
        return Ok(ReindexReport::default()); // 이미 빌드됨
    }
    // mirror에서 모든 row 가져옴
    let conn = crate::mirror::open_rw(app)?;
    let mut stmt = conn
        .prepare("SELECT kind, source_id FROM memories ORDER BY id")
        .map_err(|e| format!("ensure_index_built prepare: {e}"))?;
    let all_rows: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| format!("ensure_index_built query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("ensure_index_built collect: {e}"))?;
    if all_rows.is_empty() {
        return Ok(ReindexReport::default()); // mirror도 비어 있음
    }
    reindex(app, &all_rows, &[])
}

/// 인덱스 통째 비우기 — schema 변경 시 또는 corrupt 회복용. 호출자가 직후 reindex 수행 가정.
#[allow(dead_code)]
pub fn clear_index(app: &AppHandle) -> Result<(), String> {
    let (index, _) = open_or_create_index(app)?;
    let mut writer: IndexWriter<TantivyDocument> =
        index.writer(50_000_000).map_err(|e| format!("writer: {e}"))?;
    writer
        .delete_all_documents()
        .map_err(|e| format!("delete_all_documents: {e}"))?;
    writer.commit().map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

// ─── Tauri command — search_query (단위 #5) ─────────────────────────────────

/// 사용자 입력을 안전 토큰 리스트로 변환 — special char 제거 + lowercase(영문만, 한글 영향 X).
///
/// Phase Search 진단: prefix `*` syntax는 lindera 토크나이저가 별 token으로 분리하여
/// PhraseQuery 깨짐. 따라서 본 함수는 토큰만 반환하고, 호출자가 직접 `PhrasePrefixQuery`로
/// 마지막 token prefix 매치를 구성한다.
fn sanitize_query_tokens(q: &str) -> Vec<String> {
    q.split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// 사용자 검색 쿼리를 tantivy 인덱스에 실행.
///
/// 5.1.d 학습 적용: spawn_blocking으로 worker thread 격리. main IPC handler 안 막힘.
///
/// `MirrorSearchHit`와 시그니처 호환 — UI는 변경 없이 동일 데이터 받음.
/// channel="tantivy" → UI는 score 정렬 방향 분기 (높을수록 좋음).
#[tauri::command]
pub async fn search_query(
    app: AppHandle,
    query: String,
    filter: Vec<String>,
    limit: u32,
    include_summaries: bool,
    include_observations: bool,
) -> Result<Vec<crate::mirror::MirrorSearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_query_inner(&app, query, filter, limit, include_summaries, include_observations)
    })
    .await
    .map_err(|e| format!("search_query join 실패: {e}"))?
}

fn search_query_inner(
    app: &AppHandle,
    query: String,
    filter: Vec<String>,
    limit: u32,
    include_summaries: bool,
    include_observations: bool,
) -> Result<Vec<crate::mirror::MirrorSearchHit>, String> {
    let tokens = sanitize_query_tokens(&query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    if !include_summaries && !include_observations {
        return Ok(Vec::new());
    }

    let (index, schema_def) = open_or_create_index(app)?;
    let reader = index
        .reader()
        .map_err(|e| format!("index reader: {e}"))?;
    let searcher = reader.searcher();

    // 사용자 query를 (title prefix OR body prefix) 토큰별 → AND 결합.
    // title boost 2x. PhrasePrefixQuery는 1-term인 경우 단순 prefix term query로 동작.
    let mut token_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    for token in &tokens {
        let title_q: Box<dyn Query> = Box::new(BoostQuery::new(
            Box::new(PhrasePrefixQuery::new(vec![Term::from_field_text(
                schema_def.title,
                token,
            )])),
            2.0,
        ));
        let body_q: Box<dyn Query> = Box::new(PhrasePrefixQuery::new(vec![
            Term::from_field_text(schema_def.body, token),
        ]));
        token_clauses.push((
            Occur::Must,
            Box::new(BooleanQuery::new(vec![
                (Occur::Should, title_q),
                (Occur::Should, body_q),
            ])),
        ));
    }
    let user_query: Box<dyn Query> = if token_clauses.len() == 1 {
        token_clauses.into_iter().next().unwrap().1
    } else {
        Box::new(BooleanQuery::new(token_clauses))
    };

    // kind / project 필터를 BooleanQuery로 합성.
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, user_query.box_clone())];

    // kind 필터 (둘 중 하나만이면 단일 term, 둘 다 true면 추가 안 함 — 자연스럽게 모든 kind 매치)
    if !(include_summaries && include_observations) {
        let kind_str = if include_summaries { "summary" } else { "observation" };
        clauses.push((
            Occur::Must,
            Box::new(TermQuery::new(
                Term::from_field_text(schema_def.kind, kind_str),
                IndexRecordOption::Basic,
            )),
        ));
    }

    // project 필터 — ["*"] 또는 빈 배열이면 전체. 그 외 정확 매칭.
    if !filter.is_empty() && !filter.iter().any(|f| f == "*") {
        let mut proj_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for p in &filter {
            proj_clauses.push((
                Occur::Should,
                Box::new(TermQuery::new(
                    Term::from_field_text(schema_def.project, p),
                    IndexRecordOption::Basic,
                )),
            ));
        }
        clauses.push((Occur::Must, Box::new(BooleanQuery::new(proj_clauses))));
    }

    let combined: Box<dyn Query> = if clauses.len() == 1 {
        clauses.into_iter().next().unwrap().1
    } else {
        Box::new(BooleanQuery::new(clauses))
    };

    let top = searcher
        .search(combined.as_ref(), &TopDocs::with_limit(limit.clamp(1, 200) as usize))
        .map_err(|e| format!("search: {e}"))?;

    let snippet_gen = SnippetGenerator::create(&searcher, user_query.as_ref(), schema_def.body)
        .map_err(|e| format!("SnippetGenerator: {e}"))?;

    let mut hits = Vec::with_capacity(top.len());
    for (score, doc_addr) in top {
        let doc: TantivyDocument = match searcher.doc(doc_addr) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[search] doc fetch failed: {e}");
                continue;
            }
        };

        let snippet = snippet_gen.snippet_from_doc(&doc);
        let snippet_html = snippet.to_html();

        let memory_id = doc
            .get_first(schema_def.memory_id)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as i64;
        let kind = doc
            .get_first(schema_def.kind)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let source_id = doc
            .get_first(schema_def.source_id)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as i64;
        let project = doc
            .get_first(schema_def.project)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let session_id = doc
            .get_first(schema_def.session_id)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title_full = doc
            .get_first(schema_def.title)
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let title_hint = if title_full.trim().is_empty() {
            "(no title)".to_string()
        } else {
            title_full.chars().take(120).collect()
        };
        let obs_type = doc
            .get_first(schema_def.obs_type)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let created_at = doc
            .get_first(schema_def.created_at)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let created_at_epoch = doc
            .get_first(schema_def.created_at_epoch)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as i64;

        hits.push(crate::mirror::MirrorSearchHit {
            id: memory_id,
            kind,
            source_id,
            project,
            session_id,
            title_hint,
            snippet_html,
            score: score as f64, // tantivy: 높을수록 좋음. UI는 channel로 분기 정렬
            channel: "tantivy".to_string(),
            obs_type,
            created_at,
            created_at_epoch,
        });
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// schema 빌드가 결정론적이고 필드 수가 일관 — 향후 schema 변경 회귀 방지.
    #[test]
    fn schema_build_deterministic() {
        let a = SearchSchema::build();
        let b = SearchSchema::build();
        assert_eq!(a.schema.fields().count(), b.schema.fields().count());
        assert_eq!(a.schema.fields().count(), 11);
    }

    /// in-memory 인덱스 + lindera 토크나이저 등록 후 한국어 문장 인덱싱+검색 round-trip.
    /// 토크나이저 미등록이면 panic("tokenizer ... not registered"). 등록 정상이면 PASS.
    #[test]
    fn lindera_korean_roundtrip() {
        use tantivy::collector::TopDocs;
        use tantivy::doc;
        use tantivy::query::QueryParser;

        let schema_def = SearchSchema::build();
        let index = Index::create_in_ram(schema_def.schema.clone());
        register_tokenizers(&index).expect("ko 토크나이저 등록");

        let mut writer = index.writer(50_000_000).expect("writer");
        writer
            .add_document(doc!(
                schema_def.memory_id => 1u64,
                schema_def.kind => "summary",
                schema_def.source_id => 1u64,
                schema_def.project => "Lapis",
                schema_def.session_id => "s1",
                schema_def.title => "원자성 쓰기 패턴",
                schema_def.body => "Lapis는 temp file → POSIX rename으로 원자성 쓰기를 보장한다.",
                schema_def.obs_type => "",
                schema_def.content_hash => "h1",
                schema_def.created_at => "2026-05-13",
                schema_def.created_at_epoch => 1u64,
            ))
            .expect("add_document");
        writer.commit().expect("commit");

        let reader = index.reader().expect("reader");
        let searcher = reader.searcher();
        let qp = QueryParser::for_index(&index, vec![schema_def.title, schema_def.body]);
        let query = qp.parse_query("원자성").expect("parse_query");
        let top = searcher
            .search(&query, &TopDocs::with_limit(5))
            .expect("search");
        assert_eq!(top.len(), 1, "한국어 형태소 매치 결과 1건");
    }
}
