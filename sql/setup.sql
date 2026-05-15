-- ═══════════════════════════════════════
-- Knowledge App — Neon PostgreSQL Setup
-- Run BEFORE drizzle-kit push: extensions
-- Run AFTER  drizzle-kit push: everything else
-- ═══════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ═══════════════════════════════════════
-- Full-Text Search: tsvector columns + GIN
-- ═══════════════════════════════════════

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS lessons_fts_idx ON lessons USING gin (fts);

ALTER TABLE lesson_sections
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS lesson_sections_fts_idx ON lesson_sections USING gin (fts);

ALTER TABLE concepts
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS concepts_fts_idx ON concepts USING gin (fts);

-- Trigram index for fuzzy concept search
CREATE INDEX IF NOT EXISTS concepts_name_trgm_idx ON concepts USING gin (name gin_trgm_ops);

-- HNSW vector indexes for similarity search
CREATE INDEX IF NOT EXISTS lesson_embeddings_hnsw_idx ON lesson_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS section_embeddings_hnsw_idx ON section_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS concept_embeddings_hnsw_idx ON concept_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- ═══════════════════════════════════════
-- Materialized Views
-- ═══════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_lesson_engagement AS
SELECT
  l.id AS lesson_id,
  l.slug,
  l.title,
  count(DISTINCT ae.user_id) AS unique_readers,
  count(ae.id) AS total_views,
  avg(ae.duration_ms)::int AS avg_duration_ms,
  count(ae.id) FILTER (WHERE ae.event_name = 'read_complete') AS completions,
  count(DISTINCT ae.user_id) FILTER (WHERE ae.event_name = 'read_complete')::float /
    greatest(count(DISTINCT ae.user_id), 1) AS completion_rate,
  max(ae.created_at) AS last_activity
FROM lessons l
LEFT JOIN analytics_events ae ON ae.lesson_id = l.id
GROUP BY l.id, l.slug, l.title;

CREATE UNIQUE INDEX IF NOT EXISTS mv_lesson_engagement_lesson_idx ON mv_lesson_engagement(lesson_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_activity AS
SELECT
  date_trunc('day', ae.created_at)::date AS activity_date,
  ae.event_name,
  count(*) AS event_count,
  count(DISTINCT ae.user_id) AS unique_users,
  count(DISTINCT ae.lesson_id) AS lessons_touched
FROM analytics_events ae
WHERE ae.created_at > now() - interval '90 days'
GROUP BY date_trunc('day', ae.created_at)::date, ae.event_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_activity_date_event_idx
  ON mv_daily_activity(activity_date, event_name);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_category_engagement AS
SELECT
  cat.id AS category_id,
  cat.name AS category_name,
  count(DISTINCT ae.user_id) AS unique_readers,
  count(ae.id) AS total_events,
  avg(ae.duration_ms)::int AS avg_duration_ms
FROM categories cat
JOIN lessons l ON l.category_id = cat.id
LEFT JOIN analytics_events ae ON ae.lesson_id = l.id
GROUP BY cat.id, cat.name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_category_engagement_cat_idx ON mv_category_engagement(category_id);

-- ═══════════════════════════════════════
-- RPCs: Knowledge Graph
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION get_prerequisites(
  target_concept_id uuid,
  max_depth int DEFAULT 10
)
RETURNS TABLE (
  concept_id uuid,
  concept_name text,
  depth int,
  path uuid[]
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH RECURSIVE prereqs AS (
    SELECT
      ce.source_id AS concept_id,
      c.name AS concept_name,
      1 AS depth,
      ARRAY[ce.target_id, ce.source_id] AS path
    FROM concept_edges ce
    JOIN concepts c ON c.id = ce.source_id
    WHERE ce.target_id = target_concept_id
      AND ce.edge_type = 'prerequisite'

    UNION ALL

    SELECT
      ce.source_id,
      c.name,
      p.depth + 1,
      p.path || ce.source_id
    FROM concept_edges ce
    JOIN concepts c ON c.id = ce.source_id
    JOIN prereqs p ON p.concept_id = ce.target_id
    WHERE ce.edge_type = 'prerequisite'
      AND p.depth < max_depth
      AND ce.source_id <> ALL(p.path)
  )
  SELECT DISTINCT ON (prereqs.concept_id)
    prereqs.concept_id,
    prereqs.concept_name,
    prereqs.depth,
    prereqs.path
  FROM prereqs
  ORDER BY prereqs.concept_id, prereqs.depth;
$$;

CREATE OR REPLACE FUNCTION get_dependents(
  source_concept_id uuid,
  max_depth int DEFAULT 10
)
RETURNS TABLE (
  concept_id uuid,
  concept_name text,
  depth int,
  path uuid[]
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH RECURSIVE deps AS (
    SELECT
      ce.target_id AS concept_id,
      c.name AS concept_name,
      1 AS depth,
      ARRAY[ce.source_id, ce.target_id] AS path
    FROM concept_edges ce
    JOIN concepts c ON c.id = ce.target_id
    WHERE ce.source_id = source_concept_id
      AND ce.edge_type = 'prerequisite'

    UNION ALL

    SELECT
      ce.target_id,
      c.name,
      d.depth + 1,
      d.path || ce.target_id
    FROM concept_edges ce
    JOIN concepts c ON c.id = ce.target_id
    JOIN deps d ON d.concept_id = ce.source_id
    WHERE ce.edge_type = 'prerequisite'
      AND d.depth < max_depth
      AND ce.target_id <> ALL(d.path)
  )
  SELECT DISTINCT ON (deps.concept_id)
    deps.concept_id,
    deps.concept_name,
    deps.depth,
    deps.path
  FROM deps
  ORDER BY deps.concept_id, deps.depth;
$$;

CREATE OR REPLACE FUNCTION get_concept_neighborhood(
  center_concept_id uuid,
  max_hops int DEFAULT 2
)
RETURNS TABLE (
  concept_id uuid,
  concept_name text,
  concept_type concept_type,
  hop int
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH RECURSIVE neighborhood AS (
    SELECT center_concept_id AS concept_id, 0 AS hop, ARRAY[center_concept_id] AS visited
    UNION ALL
    SELECT
      CASE WHEN ce.source_id = n.concept_id THEN ce.target_id ELSE ce.source_id END,
      n.hop + 1,
      n.visited || CASE WHEN ce.source_id = n.concept_id THEN ce.target_id ELSE ce.source_id END
    FROM concept_edges ce
    JOIN neighborhood n ON (ce.source_id = n.concept_id OR ce.target_id = n.concept_id)
    WHERE n.hop < max_hops
      AND CASE WHEN ce.source_id = n.concept_id THEN ce.target_id ELSE ce.source_id END <> ALL(n.visited)
  )
  SELECT DISTINCT
    c.id AS concept_id,
    c.name AS concept_name,
    c.concept_type,
    min(nh.hop) AS hop
  FROM neighborhood nh
  JOIN concepts c ON c.id = nh.concept_id
  GROUP BY c.id, c.name, c.concept_type
  ORDER BY min(nh.hop), c.name;
$$;

-- ═══════════════════════════════════════
-- RPCs: Knowledge Tracing
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION get_user_knowledge_map(target_user_id uuid)
RETURNS TABLE (
  concept_id uuid,
  concept_name text,
  concept_type concept_type,
  p_mastery float,
  mastery_level mastery_level,
  total_interactions int,
  prereq_mastery_avg float
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.id AS concept_id,
    c.name AS concept_name,
    c.concept_type,
    coalesce(ks.p_mastery, 0) AS p_mastery,
    coalesce(ks.mastery_level, 'novice') AS mastery_level,
    coalesce(ks.total_interactions, 0) AS total_interactions,
    coalesce(avg(prereq_ks.p_mastery), 0) AS prereq_mastery_avg
  FROM concepts c
  LEFT JOIN knowledge_states ks
    ON ks.concept_id = c.id AND ks.user_id = target_user_id
  LEFT JOIN concept_edges ce
    ON ce.target_id = c.id AND ce.edge_type = 'prerequisite'
  LEFT JOIN knowledge_states prereq_ks
    ON prereq_ks.concept_id = ce.source_id AND prereq_ks.user_id = target_user_id
  GROUP BY c.id, c.name, c.concept_type, ks.p_mastery, ks.mastery_level, ks.total_interactions
  ORDER BY c.name;
$$;

CREATE OR REPLACE FUNCTION get_interaction_sequence(
  target_user_id uuid,
  seq_length int DEFAULT 50
)
RETURNS TABLE (
  concept_id uuid,
  concept_name text,
  interaction_type interaction_type,
  is_correct boolean,
  response_time_ms int,
  created_at timestamptz
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    ie.concept_id,
    c.name AS concept_name,
    ie.interaction_type,
    ie.is_correct,
    ie.response_time_ms,
    ie.created_at
  FROM interaction_events ie
  LEFT JOIN concepts c ON c.id = ie.concept_id
  WHERE ie.user_id = target_user_id
    AND ie.concept_id IS NOT NULL
  ORDER BY ie.created_at DESC
  LIMIT seq_length;
$$;

-- ═══════════════════════════════════════
-- RPCs: Recommender (vector similarity)
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION find_similar_lessons(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  exclude_lesson_id uuid DEFAULT NULL
)
RETURNS TABLE (
  lesson_id uuid,
  slug text,
  title text,
  category_name text,
  similarity float
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    le.lesson_id,
    l.slug,
    l.title,
    cat.name AS category_name,
    1 - (le.embedding <=> query_embedding) AS similarity
  FROM lesson_embeddings le
  JOIN lessons l ON l.id = le.lesson_id
  JOIN categories cat ON cat.id = l.category_id
  WHERE 1 - (le.embedding <=> query_embedding) > match_threshold
    AND (exclude_lesson_id IS NULL OR le.lesson_id <> exclude_lesson_id)
  ORDER BY le.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION find_similar_sections(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  section_id uuid,
  lesson_id uuid,
  lesson_slug text,
  lesson_title text,
  heading text,
  similarity float,
  content_excerpt text
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    se.section_id,
    se.lesson_id,
    l.slug AS lesson_slug,
    l.title AS lesson_title,
    ls.heading,
    1 - (se.embedding <=> query_embedding) AS similarity,
    left(coalesce(ls.content, ''), 200) AS content_excerpt
  FROM section_embeddings se
  JOIN lesson_sections ls ON ls.id = se.section_id
  JOIN lessons l ON l.id = se.lesson_id
  WHERE 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION recommend_lessons_collaborative(
  target_user_id uuid,
  rec_count int DEFAULT 10
)
RETURNS TABLE (
  lesson_id uuid,
  slug text,
  title text,
  score float
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH my_lessons AS (
    SELECT lesson_id, read_progress, coalesce(rating, 3) AS rating
    FROM user_lesson_interactions
    WHERE user_id = target_user_id
      AND (read_progress > 0.3 OR rating >= 3 OR bookmarked)
  ),
  similar_users AS (
    SELECT
      uli.user_id,
      count(*)::float / greatest(
        (SELECT count(*) FROM my_lessons) +
        (SELECT count(*) FROM user_lesson_interactions uli2
         WHERE uli2.user_id = uli.user_id AND (uli2.read_progress > 0.3 OR uli2.rating >= 3 OR uli2.bookmarked))
        - count(*),
        1
      ) AS similarity
    FROM user_lesson_interactions uli
    JOIN my_lessons ml ON ml.lesson_id = uli.lesson_id
    WHERE uli.user_id <> target_user_id
      AND (uli.read_progress > 0.3 OR uli.rating >= 3 OR uli.bookmarked)
    GROUP BY uli.user_id
    HAVING count(*) >= 2
    ORDER BY similarity DESC
    LIMIT 20
  )
  SELECT
    l.id AS lesson_id,
    l.slug,
    l.title,
    sum(su.similarity * coalesce(uli.rating, 3))::float AS score
  FROM similar_users su
  JOIN user_lesson_interactions uli ON uli.user_id = su.user_id
  JOIN lessons l ON l.id = uli.lesson_id
  WHERE uli.lesson_id NOT IN (SELECT lesson_id FROM my_lessons)
    AND (uli.read_progress > 0.3 OR uli.rating >= 3 OR uli.bookmarked)
  GROUP BY l.id, l.slug, l.title
  ORDER BY score DESC
  LIMIT rec_count;
$$;

-- ═══════════════════════════════════════
-- RPCs: Search
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION search_content(
  query_text text,
  result_limit int DEFAULT 20
)
RETURNS TABLE (
  result_type text,
  result_id uuid,
  title text,
  snippet text,
  rank float,
  lesson_slug text,
  lesson_title text
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  (
    SELECT
      'lesson'::text AS result_type,
      l.id AS result_id,
      l.title,
      ts_headline('english', l.content, websearch_to_tsquery('english', query_text),
        'MaxWords=40, MinWords=20, StartSel=**, StopSel=**') AS snippet,
      ts_rank(l.fts, websearch_to_tsquery('english', query_text))::float AS rank,
      l.slug AS lesson_slug,
      l.title AS lesson_title
    FROM lessons l
    WHERE l.fts @@ websearch_to_tsquery('english', query_text)
    ORDER BY rank DESC
    LIMIT result_limit
  )
  UNION ALL
  (
    SELECT
      'section'::text,
      ls.id,
      ls.heading,
      ts_headline('english', ls.content, websearch_to_tsquery('english', query_text),
        'MaxWords=40, MinWords=20, StartSel=**, StopSel=**'),
      ts_rank(ls.fts, websearch_to_tsquery('english', query_text))::float,
      l.slug,
      l.title
    FROM lesson_sections ls
    JOIN lessons l ON l.id = ls.lesson_id
    WHERE ls.fts @@ websearch_to_tsquery('english', query_text)
    ORDER BY ts_rank(ls.fts, websearch_to_tsquery('english', query_text)) DESC
    LIMIT result_limit
  )
  UNION ALL
  (
    SELECT
      'concept'::text,
      co.id,
      co.name,
      coalesce(co.description, ''),
      ts_rank(co.fts, websearch_to_tsquery('english', query_text))::float,
      NULL,
      NULL
    FROM concepts co
    WHERE co.fts @@ websearch_to_tsquery('english', query_text)
    ORDER BY ts_rank(co.fts, websearch_to_tsquery('english', query_text)) DESC
    LIMIT result_limit
  )
  ORDER BY rank DESC
  LIMIT result_limit;
$$;

CREATE OR REPLACE FUNCTION hybrid_search_lessons(
  query_text text,
  query_embedding vector(1024),
  match_count int DEFAULT 10,
  fts_weight float DEFAULT 0.3,
  vector_weight float DEFAULT 0.7,
  match_threshold float DEFAULT 0.2
)
RETURNS TABLE (
  lesson_id uuid,
  slug text,
  title text,
  category_name text,
  fts_rank float,
  vector_similarity float,
  combined_score float,
  snippet text
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    l.id AS lesson_id,
    l.slug,
    l.title,
    cat.name AS category_name,
    ts_rank(l.fts, websearch_to_tsquery('english', query_text))::float AS fts_rank,
    (1 - (le.embedding <=> query_embedding))::float AS vector_similarity,
    (
      fts_weight * ts_rank(l.fts, websearch_to_tsquery('english', query_text))
      + vector_weight * (1 - (le.embedding <=> query_embedding))
    )::float AS combined_score,
    CASE
      WHEN l.fts @@ websearch_to_tsquery('english', query_text)
      THEN ts_headline('english', coalesce(l.content, ''), websearch_to_tsquery('english', query_text),
           'MaxWords=40, MinWords=15, StartSel=**, StopSel=**')
      ELSE left(coalesce(l.content, ''), 200)
    END AS snippet
  FROM lessons l
  JOIN lesson_embeddings le ON le.lesson_id = l.id
  JOIN categories cat ON cat.id = l.category_id
  WHERE
    l.fts @@ websearch_to_tsquery('english', query_text)
    OR 1 - (le.embedding <=> query_embedding) > match_threshold
  ORDER BY combined_score DESC
  LIMIT match_count;
$$;

-- ═══════════════════════════════════════
-- RPCs: Analytics
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_lesson_engagement;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_activity;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_category_engagement;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_engagement_summary(target_user_id uuid)
RETURNS TABLE (
  lessons_started bigint,
  lessons_completed bigint,
  total_time_spent_min bigint,
  current_streak_days bigint,
  categories_explored bigint,
  favorite_category text
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH user_activity AS (
    SELECT
      count(DISTINCT lesson_id) FILTER (WHERE event_name = 'read_start') AS lessons_started,
      count(DISTINCT lesson_id) FILTER (WHERE event_name = 'read_complete') AS lessons_completed,
      coalesce(sum(duration_ms) / 60000, 0) AS total_time_spent_min
    FROM analytics_events
    WHERE user_id = target_user_id
  ),
  active_days AS (
    SELECT DISTINCT date_trunc('day', created_at)::date AS dt
    FROM analytics_events
    WHERE user_id = target_user_id
      AND created_at > now() - interval '365 days'
  ),
  numbered_days AS (
    SELECT dt, dt - make_interval(days => (row_number() OVER (ORDER BY dt))::int) AS grp
    FROM active_days
  ),
  streak_groups AS (
    SELECT grp, count(*) AS streak_len
    FROM numbered_days
    GROUP BY grp
  ),
  current_streak AS (
    SELECT coalesce(
      (SELECT sg.streak_len FROM streak_groups sg
       JOIN numbered_days nd ON nd.grp = sg.grp
       WHERE nd.dt = current_date OR nd.dt = current_date - 1
       ORDER BY sg.streak_len DESC
       LIMIT 1),
      0
    ) AS current_streak_days
  ),
  fav_cat AS (
    SELECT cat.name AS favorite_category
    FROM analytics_events ae
    JOIN lessons l ON l.id = ae.lesson_id
    JOIN categories cat ON cat.id = l.category_id
    WHERE ae.user_id = target_user_id
    GROUP BY cat.name
    ORDER BY count(*) DESC
    LIMIT 1
  )
  SELECT
    ua.lessons_started,
    ua.lessons_completed,
    ua.total_time_spent_min,
    cs.current_streak_days,
    (SELECT count(DISTINCT cat.id)
     FROM analytics_events ae2
     JOIN lessons l2 ON l2.id = ae2.lesson_id
     JOIN categories cat ON cat.id = l2.category_id
     WHERE ae2.user_id = target_user_id),
    coalesce(fc.favorite_category, 'None')
  FROM user_activity ua
  CROSS JOIN current_streak cs
  LEFT JOIN fav_cat fc ON true;
$$;

CREATE OR REPLACE FUNCTION get_reading_velocity(
  target_user_id uuid,
  window_days int DEFAULT 7
)
RETURNS TABLE (
  week_start date,
  lessons_read bigint,
  total_time_min bigint,
  running_avg_lessons float
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH weekly AS (
    SELECT
      date_trunc('week', created_at)::date AS week_start,
      count(DISTINCT lesson_id) AS lessons_read,
      coalesce(sum(duration_ms) / 60000, 0) AS total_time_min
    FROM analytics_events
    WHERE user_id = target_user_id
      AND event_name IN ('read_start', 'read_complete', 'page_view')
      AND created_at > now() - (window_days * 12) * interval '1 day'
    GROUP BY date_trunc('week', created_at)::date
  )
  SELECT
    w.week_start,
    w.lessons_read,
    w.total_time_min,
    avg(w.lessons_read) OVER (
      ORDER BY w.week_start
      ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
    )::float AS running_avg_lessons
  FROM weekly w
  ORDER BY w.week_start;
$$;

-- ── Topic grouping for external_courses ────────────────────────────
ALTER TABLE external_courses ADD COLUMN IF NOT EXISTS topic_group text;
