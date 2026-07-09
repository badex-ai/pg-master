# PostgreSQL Query Mastery — Complete Curriculum

> **Pinned version: PostgreSQL 18** (released September 2025). Every feature, default,
> and version gate in this file is written against PG 18; the live practice instance
> must match. Version-gated features are marked (e.g. `MERGE` 15+, SQL/JSON `JSON_TABLE`
> 17+, skip scan / virtual generated columns / `uuidv7()` / `RETURNING old`·`new` 18+).
> Re-pin and reconcile on each new major release.
>
> **Purpose.** This is the single source of truth for a learning app that turns a
> working backend developer (JavaScript / TypeScript / Python / Go / any language)
> into someone who writes PostgreSQL queries at an expert level.
>
> **How the app uses this file.** Each numbered topic below is a *lesson unit*. For
> every unit the app must, in order:
> 1. **Teach** the concept (explanation + worked SQL example).
> 2. **Quiz** the learner with deep, thorough questions (see the question-type
>    taxonomy at the end).
> 3. **Reveal** the answer *and the reasoning* — why the answer is correct, why the
>    plausible wrong answers are wrong, and what PostgreSQL actually does under the
>    hood.
> 4. Provide a **live SQL editor** where the learner runs real SQL against a real
>    Postgres instance and sees real results, `EXPLAIN` output, and errors — as
>    close to production Postgres as possible.
>
> **Ordering.** Units are ordered so each depends only on earlier ones. The three
> tiers (Beginner → Intermediate → Advanced/Mastery) are learning phases; a learner
> is "proficient" at the end of Intermediate and progressing to "mastery" through
> Advanced.
>
> **Nothing is omitted by design.** If a real Postgres feature that affects how you
> write or reason about queries is missing, it is a bug in this file — add it.
>
> **Taught first: database design.** Before any tier below, the learner works through
> [[DESIGN.md]] — how to plan a schema from scratch (entities, relationships, normalization,
> types, keys, indexes) with a full real-company teardown. You cannot write good queries
> against a badly designed schema, so the design method precedes the query curriculum. The
> practice data every query lesson runs against is specified in [[DATASET.md]].

---

## Table of Contents

- [Tier 0 — Foundations & Mental Model](#tier-0--foundations--mental-model)
- [Tier 1 — Beginner: Reading & Writing Basic Queries](#tier-1--beginner-reading--writing-basic-queries)
- [Tier 2 — Intermediate: Real-World Query Craft](#tier-2--intermediate-real-world-query-craft)
- [Tier 3 — Advanced / Mastery](#tier-3--advanced--mastery)
- [Tier 4 — Performance, Internals & Operations](#tier-4--performance-internals--operations)
- [Tier 5 — Backend Integration (the JS/any-backend layer)](#tier-5--backend-integration-the-jsany-backend-layer)
- [Cross-Cutting Mastery Themes](#cross-cutting-mastery-themes)
- [Question-Type Taxonomy (for the quiz engine)](#question-type-taxonomy-for-the-quiz-engine)
- [Practice Dataset Requirements](#practice-dataset-requirements)
- [Mastery Rubric](#mastery-rubric)

---

## Tier 0 — Foundations & Mental Model

*Goal: understand what a relational database is and how a query is actually processed. Without this, everything later is memorization.*

### 0.1 What a relational database is
- Tables, rows (tuples), columns (attributes), the relational model.
- Schemas, databases, clusters — the difference and the hierarchy.
- PostgreSQL as a client/server system: backend processes, connections, sessions.
- `psql` basics: connecting, `\d`, `\dt`, `\l`, `\c`, `\x`, `\timing`, running a file.

### 0.2 The logical order of query evaluation (the single most important mental model)
- Written order vs. logical evaluation order:
  `FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT/OFFSET`.
- Why you cannot reference a `SELECT` alias in `WHERE` but can in `ORDER BY`.
- Why `WHERE` filters rows and `HAVING` filters groups.

### 0.3 SQL is declarative, not imperative
- You describe *what* you want; the planner decides *how*.
- Introduction to the query planner/optimizer as the thing that turns SQL into a plan.
- Set-based thinking vs. row-by-row (loop) thinking — the core habit shift for backend devs.

### 0.4 NULL and three-valued logic (introduce early, revisit forever)
- `NULL` means "unknown," not "zero" and not "empty string."
- Three-valued logic: `TRUE`, `FALSE`, `UNKNOWN`.
- `= NULL` is never true; use `IS NULL` / `IS NOT NULL`.
- `NULL` in aggregates, `NULL` in `NOT IN`, `NULL` in joins, `NULL` in `UNIQUE`.
- `UNIQUE NULLS NOT DISTINCT` (PG15+) — treating NULLs as equal so only one NULL is allowed; resolves the "multiple NULLs slip past a unique constraint" trap.
- `IS DISTINCT FROM` / `IS NOT DISTINCT FROM`.

### 0.5 Data types overview (the type system underpins everything)
- Numeric: `smallint`, `integer`, `bigint`, `numeric`/`decimal`, `real`, `double precision`, `serial`/`bigserial` vs `GENERATED … AS IDENTITY`.
- Character: `text`, `varchar(n)`, `char(n)` — and why `text` is usually right.
- Boolean.
- Date/time: `date`, `time`, `timestamp`, `timestamptz`, `interval` — and why `timestamptz` is almost always correct.
- Binary: `bytea`.
- Bit string: `bit(n)`, `bit varying(n)` and bit-string operators.
- UUID.
- XML type (awareness) — deepened in 3.11.
- Casting: `CAST(x AS type)` and `x::type`; implicit vs explicit casts.
- **Collation** (`COLLATE`) — how it changes comparison/`ORDER BY` results and index usability; deterministic vs non-deterministic collations, `citext` as an alternative.

---

## Tier 1 — Beginner: Reading & Writing Basic Queries

*Goal: write correct single-table and simple multi-table queries with confidence. End state = can build a basic CRUD backend's queries unaided.*

### 1.1 SELECT fundamentals
- Selecting columns, `*`, column aliases (`AS`), computed/derived columns.
- `DISTINCT` and `DISTINCT ON (...)`.
- Literals, expressions, and operators in the select list.

### 1.2 Filtering with WHERE
- Comparison operators, `BETWEEN`, `IN`, `NOT IN`.
- Pattern matching: `LIKE`, `ILIKE`, `SIMILAR TO`, wildcards, escaping.
- Boolean composition: `AND`, `OR`, `NOT`, and operator precedence (parenthesize!).
- Range and membership filters; the `NOT IN` + NULL trap.

### 1.3 Sorting and limiting
- `ORDER BY` (multiple keys, `ASC`/`DESC`, `NULLS FIRST`/`NULLS LAST`).
- `LIMIT` / `OFFSET` and why `OFFSET` is dangerous at scale (forward reference to keyset pagination).
- `FETCH FIRST … ROWS` (SQL-standard form).

### 1.4 Aggregation
- General-purpose aggregates: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `bool_and`/`bool_or`/`every`, `array_agg`, `string_agg`, `any_value`.
- `COUNT(*)` vs `COUNT(column)` vs `COUNT(DISTINCT column)`.
- `GROUP BY` — grouping semantics, one row per group.
- `HAVING` vs `WHERE`.
- `FILTER (WHERE …)` clause on aggregates.
- `DISTINCT` and `ORDER BY` *inside* an aggregate call (e.g. `array_agg(x ORDER BY y)`, `count(DISTINCT x)`).
- (Preview, deepened in 2.x) statistical aggregates (`stddev`, `variance`, `corr`, `regr_*`) and ordered-set/hypothetical-set aggregates (`WITHIN GROUP`).

### 1.5 Joins (the heart of relational querying)
- `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `FULL OUTER JOIN`.
- `CROSS JOIN` and accidental cartesian products.
- Join predicates (`ON`) vs filters (`WHERE`) — and why moving a condition from `ON` to `WHERE` changes outer-join results.
- Self-joins.
- `USING` and `NATURAL JOIN` (and why `NATURAL JOIN` is a footgun).
- Multi-table joins and join order (logical vs planner-chosen).

### 1.6 Set operations
- `UNION` vs `UNION ALL` (dedup cost).
- `INTERSECT`, `EXCEPT` (and their `ALL` variants).
- Column count/type compatibility rules.
- `VALUES` lists as a standalone row source and inside `FROM`/`JOIN`.
- `TABLESAMPLE` (`BERNOULLI`, `SYSTEM`, `REPEATABLE`) for sampling large tables.

### 1.7 Basic data modification (DML)
- `INSERT` — single row, multi-row, `INSERT … SELECT`.
- `UPDATE` — with `WHERE`, `UPDATE … FROM`.
- `DELETE` — with `WHERE`, `DELETE … USING`.
- `RETURNING` clause on INSERT/UPDATE/DELETE (a Postgres superpower for backends).
- `RETURNING old.*` / `new.*` (PG18+) — explicitly return pre- and post-image values from `INSERT`/`UPDATE`/`DELETE`/`MERGE` in one statement.
- `TRUNCATE` vs `DELETE`.

### 1.8 Creating and altering tables (enough DDL to be dangerous)
- `CREATE TABLE`, column definitions, `NOT NULL`, `DEFAULT`.
- Primary keys, **unique constraints**, foreign keys, check constraints (introduced here; deepened in 3.3).
- `ALTER TABLE` (add/drop/alter column, add/drop constraint).
- `DROP TABLE`, `IF EXISTS`, `CASCADE`/`RESTRICT`.

### 1.8b Auto-generated keys: sequences vs identity
- `CREATE SEQUENCE` and `nextval`/`currval`/`setval`/`lastval`; caching, increment, cycle.
- Why sequences leave gaps and are not transactional (rollback doesn't reclaim numbers).
- `serial`/`bigserial` (legacy sugar) vs `GENERATED ALWAYS/BY DEFAULT AS IDENTITY` (standard, preferred) — the differences and why identity is now recommended.
- **Choosing a key type**: `integer` exhausts at ~2.1 billion (`2^31`) — a real production incident class; prefer `bigint`. UUID keys: `gen_random_uuid()` (v4, random) vs `uuidv7()` (PG18+, timestamp-ordered) and why v4's randomness hurts B-tree insert locality and cache behavior while v7 restores it.
- `RETURNING id` to read the generated key on `INSERT`.

### 1.9 Handling NULLs in practice
- `COALESCE`, `NULLIF`, `GREATEST`, `LEAST`.
- `CASE` expressions (simple and searched).

---

## Tier 2 — Intermediate: Real-World Query Craft

*Goal: write the queries that real backends actually run — subqueries, CTEs, window functions, JSON, upserts, transactions. End state = "proficient."*

### 2.1 Subqueries
- Scalar subqueries.
- Subqueries in `WHERE` (`IN`, `NOT IN`, `= ANY`, `> ALL`).
- Subqueries in `FROM` (derived tables) and required aliasing.
- **Correlated** subqueries — how they reference the outer query and their cost model.
- `EXISTS` / `NOT EXISTS` and why they usually beat `IN`/`NOT IN` (semantics + NULL safety + performance).

### 2.2 Common Table Expressions (CTEs)
- `WITH` syntax, multiple CTEs, readability benefits.
- Materialization: `MATERIALIZED` vs `NOT MATERIALIZED` and the pre-12 vs 12+ optimization-fence behavior.
- **Recursive CTEs** (`WITH RECURSIVE`): hierarchies, trees, graphs, generating sequences.
- `SEARCH BREADTH FIRST`/`DEPTH FIRST BY …` and — critically — `CYCLE … SET … USING …` for cycle detection (PG14+). A single cyclic row makes an uncontrolled recursive query run forever; cycle detection is the guard, not an optional extra.
- Writable CTEs: `INSERT/UPDATE/DELETE … RETURNING` inside `WITH` and data-modifying pipelines.

### 2.3 Window functions (the skill that separates intermediate from beginner)
- The `OVER (…)` clause; how windows differ from `GROUP BY` (rows are not collapsed).
- `PARTITION BY`, `ORDER BY` within the window.
- Ranking: `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE`, `PERCENT_RANK`, `CUME_DIST`.
- Offset: `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE`.
- Aggregates as window functions (running totals, moving averages).
- **Frame clauses**: `ROWS` vs `RANGE` vs `GROUPS`, `BETWEEN … AND …`, `UNBOUNDED PRECEDING`, `CURRENT ROW` — and the classic `LAST_VALUE` frame gotcha.
- `WINDOW` named-window clause.

### 2.4 Advanced grouping and advanced aggregates
- `GROUPING SETS`, `ROLLUP`, `CUBE`.
- `GROUPING()` function to distinguish real NULLs from grouping NULLs.
- **Ordered-set aggregates** (`WITHIN GROUP (ORDER BY …)`): `percentile_cont`, `percentile_disc`, `mode`.
- **Hypothetical-set aggregates** (`WITHIN GROUP`): `rank`, `dense_rank`, `percent_rank`, `cume_dist`.
- **Statistical aggregates**: `stddev_pop`/`stddev_samp`, `var_pop`/`var_samp`, `corr`, `covar_*`, `regr_*` family.
- `range_agg` / `range_intersect_agg`; `xmlagg`.
- Defining your own aggregates (`CREATE AGGREGATE`) — awareness level.

### 2.5 Conditional and pivot logic
- `CASE` for conditional aggregation (manual pivot).
- `crosstab` from the `tablefunc` extension.
- Unpivot patterns (`LATERAL` + `VALUES`, or `unnest`).

### 2.6 Working with dates, times, and intervals
- `now()`, `current_date`, `current_timestamp`, `clock_timestamp()` vs `statement_timestamp()` vs `transaction_timestamp()`.
- `EXTRACT`, `date_trunc`, `date_part`, `age()`.
- `AT TIME ZONE` and correct timezone reasoning; `timestamptz` storage vs display.
- `generate_series()` for date/number spines (gap-filling, calendars).
- Interval arithmetic.

### 2.7 String processing
- Concatenation (`||`, `concat`, `concat_ws`), `format()`.
- `substring`, `position`, `left`, `right`, `trim`, `lpad`/`rpad`, `replace`, `split_part`, `string_to_array`, `regexp_*` functions.
- `string_agg` (with `ORDER BY` inside the aggregate).
- Regular expressions: `~`, `~*`, `!~`, `regexp_match`, `regexp_matches`, `regexp_replace`, `regexp_split_to_table/array`.

### 2.8 Arrays
- Array types, literals, subscripting, slicing.
- `unnest`, `array_agg`, `array_length`, `cardinality`, `ANY`/`ALL` with arrays.
- Array containment operators (`@>`, `<@`, `&&`).

### 2.9 JSON and JSONB (essential for JS backends)
- `json` vs `jsonb` — storage, ordering, dedup, and when to use which.
- Building: `to_json`, `to_jsonb`, `json_build_object`, `jsonb_build_object`, `json_agg`, `jsonb_agg`, `jsonb_object_agg`.
- Accessing: `->`, `->>`, `#>`, `#>>`, path semantics.
- Containment and existence: `@>`, `<@`, `?`, `?|`, `?&`.
- Modifying: `jsonb_set`, `jsonb_insert`, `||`, `-`, `#-`.
- Expanding: `jsonb_each`, `jsonb_array_elements`, `jsonb_to_recordset`, `json_populate_record`.
- SQL/JSON path language (`jsonb_path_query`, `@?`, `@@`) — 12+.
- **Standard SQL/JSON functions** (the biggest recent addition for app backends):
  - `JSON_TABLE(...)` (PG17+) — turn a JSONB document into a relational rowset you can join; the cleanest way to shred JSON arrays into columns.
  - `JSON_VALUE`, `JSON_QUERY`, `JSON_EXISTS` (PG17+) — extract a scalar, extract a JSON fragment, test a path.
  - `JSON_OBJECT`, `JSON_ARRAY`, `JSON_OBJECTAGG`, `JSON_ARRAYAGG` constructors and the `IS JSON [SCALAR|ARRAY|OBJECT|VALUE] [WITH|WITHOUT UNIQUE KEYS]` predicate (PG16+).
- Indexing JSONB (GIN default opclass vs `jsonb_path_ops`) — forward reference to Tier 4.

### 2.10 Upserts and conflict handling
- `INSERT … ON CONFLICT DO NOTHING`.
- `INSERT … ON CONFLICT (…) DO UPDATE SET … ` and the `EXCLUDED` pseudo-table.
- Conflict targets: unique index/constraint vs `WHERE` predicate; partial-index conflicts.
- `MERGE` (Postgres 15+) and when it differs from `ON CONFLICT`.

### 2.11 Transactions (correctness foundation for any backend)
- `BEGIN`, `COMMIT`, `ROLLBACK`.
- `SAVEPOINT`, `ROLLBACK TO SAVEPOINT`.
- ACID properties, concretely, in Postgres terms.
- Autocommit behavior in `psql` and in drivers.
- Why every backend write path is a transaction whether you name it or not.

### 2.12 Views
- `CREATE VIEW`, updatable views, `WITH CHECK OPTION`.
- `CREATE MATERIALIZED VIEW`, `REFRESH MATERIALIZED VIEW [CONCURRENTLY]`.
- When a view helps and when it hides a performance problem.

### 2.13 LATERAL joins
- `LATERAL` semantics — a join where the right side sees the left side's columns.
- `CROSS JOIN LATERAL` and `LEFT JOIN LATERAL … ON true`.
- Top-N-per-group with `LATERAL` + `LIMIT`.
- Common with set-returning functions (`unnest`, `jsonb_array_elements`).

---

## Tier 3 — Advanced / Mastery

*Goal: reason about correctness under concurrency, design for performance, and use Postgres's advanced query features. End state = "mastery."*

### 3.1 Concurrency control and isolation (the hardest correctness topic)
- MVCC (Multi-Version Concurrency Control): row versions, xmin/xmax, snapshots.
- Isolation levels: `READ COMMITTED` (default), `REPEATABLE READ`, `SERIALIZABLE`.
- Anomalies: dirty read, non-repeatable read, phantom read, write skew, lost update — which levels prevent which.
- Serializable Snapshot Isolation (SSI) and serialization failures (`40001`) + retry loops.
- Read anomalies you can still hit under `READ COMMITTED` (e.g. the classic "read-modify-write" race).

### 3.2 Explicit locking
- Row locks: `SELECT … FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`.
- `SKIP LOCKED` and `NOWAIT` (queue/worker patterns — critical for job-queue backends).
- Table locks and `LOCK TABLE`; lock modes and conflict matrix.
- Deadlocks: how they arise, how Postgres detects and resolves them, how to avoid them (consistent ordering).
- Advisory locks (`pg_advisory_lock`, session vs transaction scope).

### 3.3 Constraints, deeply
- `NOT NULL`, `CHECK`, `UNIQUE`, `PRIMARY KEY`, `FOREIGN KEY`.
- `DEFERRABLE` constraints and `SET CONSTRAINTS … DEFERRED`.
- `EXCLUDE` constraints (with GiST — e.g. no-overlap on ranges/rooms).
- `ON DELETE`/`ON UPDATE` referential actions (`CASCADE`, `SET NULL`, `SET DEFAULT`, `RESTRICT`, `NO ACTION`).
- Composite and partial unique constraints.

### 3.4 Advanced data types & domain modeling
- `ENUM` types (and their migration pain).
- Composite (row) types.
- Range types (`int4range`, `tsrange`, `daterange`, `numrange`) and range operators.
- **Multirange types** (`int4multirange`, `tstzmultirange`, …) and `range_agg` — non-contiguous ranges (PG14+).
- `hstore`.
- Network types (`inet`, `cidr`, `macaddr`, `macaddr8`) and their operators.
- Geometric types; `citext`; `money` (and why to avoid it).
- Domains (`CREATE DOMAIN`) with `CHECK`/`NOT NULL`.
- `GENERATED ALWAYS AS (…)` computed columns: `VIRTUAL` (computed on read — the **PG18 default**) vs `STORED` (computed on write, materialized on disk). Know which default you get and the tradeoff (VIRTUAL saves storage/write cost but can't be indexed directly).

### 3.5 Full-text search
- `tsvector`, `tsquery`, `to_tsvector`, `to_tsquery`, `plainto_tsquery`, `phraseto_tsquery`, `websearch_to_tsquery`.
- `@@` match operator, ranking (`ts_rank`, `ts_rank_cd`), highlighting (`ts_headline`).
- Text search configurations, dictionaries, stemming.
- GIN indexing for full-text; generated `tsvector` columns.
- Trigram search with `pg_trgm` (`%`, `<->`, `word_similarity`) for fuzzy matching/autocomplete.

### 3.6 Programmability (server-side logic)
- Functions: `CREATE FUNCTION`, `LANGUAGE sql` vs `plpgsql`; `IMMUTABLE`/`STABLE`/`VOLATILE`; `STRICT`; `SECURITY DEFINER` vs `INVOKER`.
- PL/pgSQL: variables, control flow, `RETURN QUERY`, exception handling, `RAISE`.
- Set-returning functions (`RETURNS SETOF` / `RETURNS TABLE`).
- Triggers: `BEFORE`/`AFTER`/`INSTEAD OF`, row vs statement, `NEW`/`OLD`, trigger functions.
- `LISTEN`/`NOTIFY` and `pg_notify` for event-driven backends.
- Stored procedures (`CREATE PROCEDURE`, `CALL`) and in-procedure transaction control.

### 3.7 Partitioning
- Declarative partitioning: `RANGE`, `LIST`, `HASH`.
- Partition pruning (planning-time and run-time).
- Attaching/detaching partitions; partition-wise joins and aggregates.
- When partitioning helps and when it hurts.

### 3.8 Inheritance and advanced schema patterns
- Table inheritance (legacy, but still appears).
- Multi-tenant patterns: shared schema vs schema-per-tenant vs database-per-tenant.
- Soft deletes, audit columns, temporal/history tables, slowly-changing dimensions.

### 3.9 Roles, privileges, and access control
- Roles vs users vs groups; `CREATE ROLE`, `GRANT`/`REVOKE`, role membership, `SET ROLE`.
- Object privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `USAGE`, `EXECUTE`, …) and schema/`search_path` privileges.
- `DEFAULT PRIVILEGES`, ownership, `SECURITY DEFINER` implications.
- Why the query you can run depends on who you are — the foundation RLS builds on.

### 3.10 Row-Level Security (RLS)
- `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `USING` vs `WITH CHECK`.
- Multi-tenant enforcement and interaction with `SECURITY DEFINER` functions.
- Performance implications of policy predicates.

### 3.11 XML data and functions
- `xml` type; `xmlparse`/`xmlserialize`.
- Producing XML (`xmlelement`, `xmlforest`, `xmlagg`) and querying it (`xpath`, `xmltable`).
- When XML matters (legacy/enterprise integration) vs when JSONB is the better choice.

### 3.12 The rule system and query rewriting (awareness)
- How views are implemented as `ON SELECT DO INSTEAD` rules.
- `CREATE RULE`, why rules are rarely the right tool today, and when triggers are preferred.
- Understanding rewriting demystifies view/materialized-view/updatable-view behavior.

---

## Tier 4 — Performance, Internals & Operations

*Goal: make queries fast and understand why they are fast or slow. This is where "writes SQL" becomes "masters PostgreSQL."*

### 4.1 Reading query plans — the core mastery skill
- `EXPLAIN` vs `EXPLAIN ANALYZE` (planned vs actual).
- `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON)`.
- Reading the plan tree: nodes, startup cost vs total cost, estimated vs actual rows, loops.
- Spotting the villains: bad row estimates, unexpected sequential scans, nested-loop blowups, spills to disk (`Sort Method: external merge`).

### 4.2 Scan and join node types
- Scans: `Seq Scan`, `Index Scan`, `Index Only Scan`, `Bitmap Index Scan` + `Bitmap Heap Scan`, `Tid Scan`.
- Joins: `Nested Loop`, `Hash Join`, `Merge Join` — cost model and when the planner picks each.
- Aggregates: `HashAggregate` vs `GroupAggregate`; `Sort`, `Incremental Sort`, `Gather`/parallel nodes.

### 4.3 Indexing (the single biggest performance lever)
- B-tree indexes: how they work, sorted output, range and equality.
- Multicolumn indexes and **column order** (the leftmost-prefix rule).
- Covering indexes and `INCLUDE`.
- Partial indexes (`WHERE`).
- Expression/functional indexes.
- Unique indexes vs constraints.
- GIN (arrays, JSONB, full-text, trigram), GiST (ranges, geometry, nearest-neighbor), SP-GiST, BRIN (huge append-only tables), Hash.
- Index-only scans and the visibility map.
- Why an index isn't used (type mismatch, function on the column, low selectivity, stale stats).
- Index maintenance cost on writes; over-indexing.
- `CREATE INDEX CONCURRENTLY`.

### 4.4 Statistics and the planner
- `ANALYZE` and `pg_statistic`/`pg_stats`.
- Selectivity estimation; histograms, most-common-values, n-distinct.
- Extended statistics (`CREATE STATISTICS`) for correlated columns.
- `default_statistics_target`.
- How stale statistics cause bad plans.

### 4.5 The physical layer
- Heap storage, pages (8 KB), tuples, the row header.
- TOAST (oversized attribute storage) and its query implications.
- Fill factor.
- MVCC bloat: dead tuples, why `UPDATE` is `DELETE`+`INSERT`.
- `VACUUM`, `VACUUM FULL`, autovacuum, and the visibility map.
- Transaction ID wraparound (why it matters even if rarely hit).
- The Write-Ahead Log (WAL): durability, checkpoints, and write-path cost.

### 4.6 Query optimization techniques
- Sargable predicates (avoid wrapping indexed columns in functions).
- Rewriting `NOT IN` → `NOT EXISTS` / anti-join.
- `EXISTS` vs `IN` vs `JOIN` for semi-joins.
- Keyset (seek) pagination vs `OFFSET`.
- Batching and chunked writes.
- Avoiding N+1 (data-side view of the backend problem): aggregate to JSON, `LATERAL`, arrays.
- `LIMIT` + `ORDER BY` and the "top-N" plan.
- Denormalization and materialized views as deliberate tradeoffs.
- Prepared statements and the generic-vs-custom-plan decision.

### 4.7 Configuration that affects query behavior
- `work_mem` (sorts/hashes and spill), `shared_buffers`, `effective_cache_size`.
- `random_page_cost` / `seq_page_cost` and how they steer the planner.
- `max_parallel_workers_per_gather` and parallel query.
- `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`.
- `enable_*` planner flags (for diagnosis only).

### 4.8 Observability
- `pg_stat_activity` (what's running, blocked, idle-in-transaction).
- `pg_locks` and finding blockers.
- `pg_stat_statements` (top queries by time/calls).
- `pg_stat_user_tables` / `pg_stat_user_indexes` (seq scans, index usage, dead tuples).
- `auto_explain`.
- Finding unused and duplicate indexes.

### 4.9 Extensions ecosystem (know they exist and when to reach)
- `pg_stat_statements`, `pg_trgm`, `hstore`, `uuid-ossp`/`pgcrypto`, `tablefunc`, `postgres_fdw`, `citext`, `btree_gin`/`btree_gist`, PostGIS, `pgvector` (embeddings/AI), `pg_partman`, `TimescaleDB`.
- `CREATE EXTENSION` mechanics and awareness of what an extension can add (types, operators, index methods, functions).

### 4.10 Foreign data and cross-database queries
- Foreign Data Wrappers: `postgres_fdw` / `dblink` — querying another Postgres (or non-Postgres source) as if it were a local table.
- `CREATE SERVER`, `CREATE USER MAPPING`, `IMPORT FOREIGN SCHEMA`, foreign tables in `FROM`.
- Predicate/join pushdown and its performance implications; why a foreign join can be slow.

---

## Tier 5 — Backend Integration (the JS/any-backend layer)

*Goal: connect everything above to how application code actually talks to Postgres. This is what makes the skill usable "in a JavaScript backend or any other backend."*

### 5.1 The connection model
- TCP vs unix socket; SSL/TLS.
- Connections are expensive; the per-connection backend process.
- Connection pooling: client-side pools (`pg.Pool`), and server-side poolers (PgBouncer) — transaction vs session vs statement pooling and what breaks in each.
- `max_connections` and why pooling exists.

### 5.2 Parameterized queries and SQL injection (non-negotiable)
- Bind parameters (`$1, $2, …`) vs string interpolation.
- Why parameterization prevents injection *and* enables plan reuse.
- Safe dynamic SQL (identifiers vs values), `quote_ident`, `format('%I', …)`.
- Why ORMs/query builders parameterize — and how to still get it wrong.

### 5.3 Mapping types across the wire
- Postgres types → JS/driver types (numeric precision, `bigint`, dates/timestamps, JSON, arrays, UUID).
- The `numeric`-as-string and `bigint`-precision traps in JavaScript.
- `timestamptz` and timezone handling end-to-end.

### 5.4 Transactions from application code
- Begin/commit/rollback via the driver; keeping a transaction on one pooled connection.
- Retry logic for serialization failures and deadlocks (`40001`, `40P01`).
- Idempotency keys and exactly-once-ish write patterns.
- The "transaction held open across an `await`/network call" anti-pattern.

### 5.5 Error handling
- SQLSTATE error codes (class → condition), e.g. `23505` unique violation, `23503` FK violation, `40001`, `40P01`, `55P03`.
- Translating DB errors into application/domain errors.

### 5.6 Migrations & schema evolution
- Migration tooling concepts (up/down, versioning).
- Safe migrations under load: `CREATE INDEX CONCURRENTLY`, adding columns with defaults (11+ fast path), avoiding long `ACCESS EXCLUSIVE` locks, `lock_timeout` + retry, backfilling in batches.
- Expand/contract (parallel-change) pattern for zero-downtime schema changes.

### 5.7 Query construction in application code
- Raw SQL vs query builder (Knex, Kysely) vs ORM (Prisma, Drizzle, TypeORM, Sequelize; and non-JS equivalents).
- Where ORMs help and where they generate pathological SQL (N+1, over-fetching, bad joins).
- Reading the SQL your ORM emits — always.

### 5.8 Bulk and streaming operations
- `COPY` for bulk load/export (orders of magnitude faster than `INSERT`).
- Multi-row `INSERT` and `unnest`-based bulk insert.
- Cursors and server-side result streaming for large result sets (avoid loading everything into memory).

---

## Cross-Cutting Mastery Themes

*These are not a single lesson; they recur and the app should tag questions with them.*

1. **NULL correctness** — surfaces in joins, aggregates, `NOT IN`, unique constraints, `ORDER BY`.
2. **Set-based vs procedural thinking** — the recurring habit to reinforce.
3. **Logical evaluation order** — explains dozens of "why doesn't this work" errors.
4. **Selectivity & cardinality** — the intuition behind every plan choice.
5. **Concurrency correctness** — the same query can be right single-user and wrong under load.
6. **Cost of writes** — MVCC, indexes, WAL, vacuum all tax every write.
7. **Read the plan, don't guess** — every performance claim must be verified with `EXPLAIN ANALYZE`.
8. **Portability vs Postgres-specific** — know which features are standard SQL and which are Postgres extensions.

---

## Question-Type Taxonomy (for the quiz engine)

Each lesson unit should draw questions from several of these types. "Deep and thorough"
means the app rarely asks pure recall; it asks the learner to *predict, explain, and fix*.

1. **Predict-the-output** — "Given this table and this query, what exactly is returned (including row order, NULLs, duplicates)?"
2. **Predict-the-error** — "Does this query run? If not, what error and why?" (e.g. alias in `WHERE`, ungrouped column.)
3. **Spot-the-bug** — a query that runs but returns wrong results (NULL in `NOT IN`, condition in `WHERE` instead of `ON` for an outer join).
4. **Write-the-query** — from a natural-language requirement; graded by running against the real DB and comparing result sets.
5. **Rewrite/optimize** — "Make this correct/faster; explain what changed and why."
6. **Read-the-plan** — given `EXPLAIN ANALYZE` output, identify the bottleneck and the fix.
7. **Choose-the-index** — "Which index (if any) makes this query fast? Why that one, that column order?"
8. **Concurrency scenario** — two interleaved transactions; "what does each see / what fails / how to fix."
9. **Why-is-the-answer-what-it-is** — after any answer, force an explanation of the underlying mechanism.
10. **Compare-approaches** — `EXISTS` vs `IN` vs `JOIN`; CTE vs subquery; `jsonb_agg` vs N+1 — with tradeoffs.
11. **Trap questions** — targeting the classic footguns (`NATURAL JOIN`, `LAST_VALUE` frame, `COUNT(nullable)`, `= NULL`).

> **Answer-reveal requirement.** Every reveal must include: the correct answer, *why* it is
> correct (mechanism, not just restatement), why each distractor is wrong, and — where relevant —
> the actual `EXPLAIN`/result the learner can reproduce in the live editor.

---

## Practice Dataset Requirements

The live SQL editor needs a realistic, seeded dataset so questions feel like production:

- A recognizable domain (e.g. e-commerce: `users`, `orders`, `order_items`, `products`,
  `categories`, `payments`, `reviews`, `inventory`) — enough tables for multi-way joins.
- Deliberate `NULL`s, duplicates, and edge cases baked in (so NULL/dedup questions bite).
- At least one table large enough (millions of rows) that a missing index is *visibly* slow
  and `EXPLAIN ANALYZE` differences are real, not theoretical.
- Hierarchical data (categories tree, org chart) for recursive CTEs.
- JSONB columns (product attributes, event payloads) for JSON lessons.
- Time-series data (events with `timestamptz`) for window/date lessons.
- Range data (bookings/reservations) for `EXCLUDE` constraints and range types.
- A version of Postgres that is current and pinned, so behavior matches the lessons
  (note the version-specific features: `MERGE` 15+, SQL/JSON path 12+, etc.).

---

## Mastery Rubric

A learner has reached **mastery** when they can, without references:

- Predict a query's exact result — order, NULLs, duplicates — from the schema alone.
- Read an `EXPLAIN ANALYZE` plan and name the bottleneck and the fix.
- Choose the right index (type + columns + order) for a given query and justify it.
- Reason correctly about two concurrent transactions at each isolation level.
- Rewrite a correct-but-slow query into a fast one and prove the improvement with the planner.
- Write correct, injection-safe, pool-aware, retry-safe queries from application code.
- Explain *why* Postgres behaves as it does at the level of MVCC, the planner, and storage.

---

*Maintenance note: revisit on each new PostgreSQL major release; move version-gated
features out of "forward reference" as the pinned practice version catches up.*
