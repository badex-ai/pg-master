# Real-World Scenarios — Situation → Solution

> **What this file is.** A library of realistic "you're building something and hit a wall"
> engineering stories, each worked from **symptom to fix**. Where [[MASTERY-INSIGHTS.md]]
> teaches a *principle* (the myth/reality/trap), this file drops you into a *situation* — the
> way the problem actually shows up in a real system — and walks the diagnosis and the fix.
>
> **The app uses these as case-study lessons.** Present the *Situation* first (optionally as a
> "what would you do?" prompt against the live editor), then reveal *Diagnosis → Solution →
> Why → Prevent*. They're also a source of the "spot-the-bug" and "rewrite/optimize" question
> types from [[CURRICULUM.md]].
>
> **Every scenario has the same shape:**
> - **Situation** — the concrete setup and the symptom, in ordinary product terms.
> - **Diagnosis** — how you'd actually find the cause (the tool, the query, the tell).
> - **Solution** — what you change, with SQL.
> - **Why** — the mechanism underneath.
> - **Prevent** — how to not hit it again.
>
> **Pinned to PostgreSQL 18.**

---

## Index

**Performance**
- [S1. The dashboard that died at scale (`count(*)`)](#s1-the-dashboard-that-died-at-scale)
- [S2. The report that was fast for a year, then wasn't (stale stats)](#s2-the-report-that-was-fast-for-a-year-then-wasnt)
- [S3. The index you added that Postgres ignores](#s3-the-index-you-added-that-postgres-ignores)
- [S4. Infinite scroll that crawls on page 400 (OFFSET)](#s4-infinite-scroll-that-crawls-on-page-400)
- [S5. The N+1 that melted the API](#s5-the-n1-that-melted-the-api)
- [S6. The nightly import that ran into business hours (bulk writes)](#s6-the-nightly-import-that-ran-into-business-hours)
- [S7. The query that's fast 5 times then slow forever (plan cache)](#s7-the-query-thats-fast-5-times-then-slow-forever)

**Correctness**
- [S8. The re-engagement email that went to nobody (`NOT IN` + NULL)](#s8-the-re-engagement-email-that-went-to-nobody)
- [S9. The revenue dashboard that read 10× too high (fan-out)](#s9-the-revenue-dashboard-that-read-10-too-high)
- [S10. The "active users" report missing half its rows (LEFT JOIN)](#s10-the-active-users-report-missing-half-its-rows)
- [S11. The percentage that always showed 0 (integer division)](#s11-the-percentage-that-always-showed-0)

**Concurrency**
- [S12. The last item sold twice (lost update)](#s12-the-last-item-sold-twice)
- [S13. The job processed three times (queue without SKIP LOCKED)](#s13-the-job-processed-three-times)
- [S14. The money transfer that deadlocked (lock ordering)](#s14-the-money-transfer-that-deadlocked)
- [S15. The whole database slowed down at 2am (idle-in-transaction)](#s15-the-whole-database-slowed-down-at-2am)

**Design & schema**
- [S16. The double-booking that shouldn't have been possible](#s16-the-double-booking-that-shouldnt-have-been-possible)
- [S17. The `varchar(255)` that needed a migration to grow](#s17-the-varchar255-that-needed-a-migration-to-grow)
- [S18. The user renamed themselves and a million rows lied (denormalization)](#s18-the-user-renamed-themselves-and-a-million-rows-lied)
- [S19. The primary key that ran out of numbers (`int` overflow)](#s19-the-primary-key-that-ran-out-of-numbers)
- [S20. The timestamps that shifted by an hour twice a year (`timestamp` vs `timestamptz`)](#s20-the-timestamps-that-shifted-by-an-hour-twice-a-year)

**Operations at the app boundary**
- [S21. The migration that took the site down (lock queue)](#s21-the-migration-that-took-the-site-down)
- [S22. The serverless app that exhausted connections](#s22-the-serverless-app-that-exhausted-connections)
- [S23. The import procedure that mysteriously slowed the whole cluster (subtransactions)](#s23-the-import-procedure-that-mysteriously-slowed-the-whole-cluster)

---

## Performance

### S1. The dashboard that died at scale
→ [[MASTERY-INSIGHTS.md]] 5.2 · [[CURRICULUM.md]] 4.5

**Situation.** Your admin table view shows "Page 1 of 240,000" and runs
`SELECT count(*) FROM events` on every page load to compute that total. It was instant in dev
with 10k rows. In production with 200M rows, each page load takes ~8 seconds and the page now
times out.

**Diagnosis.** `EXPLAIN ANALYZE SELECT count(*) FROM events` shows a full `Seq Scan` (or a
parallel one) reading every visible row — hundreds of milliseconds to seconds. There's no
`WHERE`, so nothing to narrow it.

**Solution.** Stop computing an exact total on the hot path.
```sql
-- Fast approximate total (good enough for "about N results"):
SELECT reltuples::bigint AS approx
FROM pg_class WHERE relname = 'events';
```
For an accurate filtered count that must be live, keep a maintained counter (a summary row
updated by trigger/app), or switch the UI to **keyset pagination** that never needs a grand
total (see S4).

**Why.** Under MVCC, Postgres can't store one true row count — different transactions see
different numbers of live rows — so an exact `count(*)` must scan to find what *this*
transaction can see. `reltuples` is the planner's estimate, maintained by `ANALYZE`, and is
free.

**Prevent.** Never wire an unbounded `count(*)` to a per-request UI element. Decide up front:
approximate total, maintained counter, or no total at all.

---

### S2. The report that was fast for a year, then wasn't
→ [[MASTERY-INSIGHTS.md]] 2.1 · [[CURRICULUM.md]] 4.4

**Situation.** A reporting query ran in 40ms for a year. Nothing in the code changed. This
week it takes 40 seconds. Same query, same server.

**Diagnosis.** `EXPLAIN ANALYZE` shows the plan switched from a `Hash Join` to a `Nested
Loop`, and the loop now runs millions of times. Compare **estimated vs actual rows** on the
inner node: the planner estimated ~5 rows; the actual is ~5 million. The estimate is stale.

**Solution.**
```sql
ANALYZE the_table;   -- refresh statistics
```
The plan flips back to the hash join and the query returns to 40ms.

**Why.** The data distribution drifted (a value that used to be rare became common), but the
statistics `ANALYZE` feeds the planner were out of date. The planner chose a nested loop
based on a wrong, tiny row estimate; at the true cardinality that plan is catastrophic.

**Prevent.** Ensure autovacuum/autoanalyze is keeping up on high-churn tables; for tables
with skewed, correlated columns add **extended statistics** (`CREATE STATISTICS`). When a
query "suddenly" regresses, check the estimate/actual gap *before* touching indexes.

---

### S3. The index you added that Postgres ignores
→ [[MASTERY-INSIGHTS.md]] 1.2 · [[CURRICULUM.md]] 4.3, 4.6

**Situation.** You added `CREATE INDEX ON orders (created_at)` to speed up a date-filtered
query, but it's still slow and `EXPLAIN` shows a `Seq Scan`. The index is just sitting there.

**Diagnosis.** Look at the actual predicate. Common causes:
- The query wraps the column in a function: `WHERE date(created_at) = '2024-01-01'` — the
  index on `created_at` can't be used because the indexed expression is `created_at`, not
  `date(created_at)`.
- The filter isn't selective: it matches most of the table, so a seq scan is genuinely
  cheaper and the planner is right to ignore the index.
- Type mismatch: `WHERE user_id = '42'` (text literal) against a `bigint` column.

**Solution.** Make the predicate **sargable** (able to use the index):
```sql
-- Instead of date(created_at) = '2024-01-01', use a half-open range:
WHERE created_at >= '2024-01-01' AND created_at < '2024-01-02'
-- Or, if you must filter on an expression, index that expression:
CREATE INDEX ON orders (date(created_at));
```
If the filter simply isn't selective, the seq scan is correct — the fix is a different query
or a partial index on the rare case.

**Why.** A B-tree index is on an *expression* (usually the bare column). Any transformation
of the column in the `WHERE` defeats it unless you build a matching expression index. And an
index only wins when it eliminates most rows.

**Prevent.** Keep indexed columns bare in predicates; use range conditions instead of
functions on the column; confirm selectivity before assuming an index will help.

---

### S4. Infinite scroll that crawls on page 400
→ [[MASTERY-INSIGHTS.md]] 8.1 · [[CURRICULUM.md]] 1.3, 4.6

**Situation.** An infinite-scroll feed uses `ORDER BY created_at DESC LIMIT 20 OFFSET ?`.
Early pages are snappy. Around page 400 it's visibly slow, and your most engaged users (who
scroll furthest) get the worst experience.

**Diagnosis.** `OFFSET 8000` means Postgres computes and **discards** 8000 rows before
returning 20. `EXPLAIN ANALYZE` shows the cost climbing linearly with the offset.

**Solution.** Switch to **keyset (seek) pagination** — remember the last row seen and seek
past it:
```sql
SELECT * FROM posts
WHERE (created_at, id) < ($1, $2)   -- last seen (created_at, id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```
Backed by an index on `(created_at DESC, id DESC)`, every page costs the same — page 1 or
page 10,000.

**Why.** `OFFSET n` does all the work of the first `n` rows and throws it away. Keyset uses
the index to jump straight to the boundary. The tie-breaker `id` is required because
`created_at` isn't unique — without it you skip or duplicate rows at page edges.

**Prevent.** Use keyset for any deep or infinite pagination. Accept the trade: you get
next/prev, not "jump to page 500" — fine for feeds.

---

### S5. The N+1 that melted the API
→ [[MASTERY-INSIGHTS.md]] 13 · [[CURRICULUM.md]] 4.6, 2.13

**Situation.** An endpoint returns 50 orders, each with its line items. The ORM loads the 50
orders in one query, then loads items for each order in a separate query — **51 queries per
request**. Under load the database is pinned and latency spikes.

**Diagnosis.** Turn on query logging (or read the ORM's emitted SQL). You see one
`SELECT ... FROM orders LIMIT 50` followed by 50 × `SELECT ... FROM order_items WHERE
order_id = ?`. That's the N+1.

**Solution.** Fetch it in **one** query. Either a join, or aggregate the children into JSON
so each order comes back complete:
```sql
SELECT o.*,
       coalesce(jsonb_agg(oi.* ORDER BY oi.id)
                FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.id = ANY($1)          -- the 50 order ids
GROUP BY o.id;
```
Or use `LATERAL` for top-N children per parent. One round trip instead of 51.

**Why.** Each query has fixed overhead (round trip, planning, transaction). Multiplying it by
N is the cost. The database is superb at set-based work — do the join *there*, once.

**Prevent.** Watch the SQL your ORM emits. Use eager-loading / `include` / `join` for
associations you'll render; reserve lazy loading for genuinely optional data.

---

### S6. The nightly import that ran into business hours
→ [[MASTERY-INSIGHTS.md]] 10.1 · [[CURRICULUM.md]] 5.8

**Situation.** A nightly job imports a few million rows with `for row in file: INSERT ...`.
It used to finish by 2am; as data grew it now runs past 8am into peak traffic.

**Diagnosis.** Each `INSERT` is its own statement, its own round trip, its own commit and WAL
flush. Millions of them = millions of per-statement taxes. It's not the *data* that's slow,
it's the *shape* of the writes.

**Solution.** Use `COPY` for bulk load (orders of magnitude faster), or batch multi-row
inserts:
```sql
COPY staging_events (col_a, col_b, col_c) FROM STDIN WITH (FORMAT csv);
-- or, for moderate batches, one statement per ~1000 rows:
INSERT INTO events (col_a, col_b) SELECT * FROM unnest($1::int[], $2::text[]);
```
Chunk into transactions of ~1k–10k rows to balance throughput against lock/rollback size.

**Why.** `COPY` amortizes per-row overhead into a single streamed operation. Row-by-row
inserts pay commit + network latency per row.

**Prevent.** Default to `COPY`/batched inserts for any bulk path. Never loop single-row
inserts for large volumes. Don't wrap a million inserts in one giant transaction either —
chunk them.

---

### S7. The query that's fast 5 times then slow forever
→ [[MASTERY-INSIGHTS.md]] 2.3 · [[CURRICULUM.md]] 4.6

**Situation.** A parameterized query (prepared statement) is fast in testing and for the
first few production calls, then a specific customer's requests start timing out
intermittently — with no code or data change.

**Diagnosis.** The query filters on a skewed column (`status = $1` where one value is 99% of
rows). After 5 custom-planned executions, Postgres switched to a **generic plan** chosen from
an *average* estimate. For the skewed parameter value, the generic plan picks the wrong
access path.

**Solution.** Force a custom plan for that query:
```sql
SET plan_cache_mode = force_custom_plan;   -- session, or set per problem query
```
Confirm first by running `EXPLAIN` at the fast and slow parameter values and watching the
plan differ.

**Why.** Postgres builds custom plans for the first 5 executions, then decides whether a
parameter-blind generic plan is "close enough." With skew it isn't — one plan can't be right
for both a value matching 10 rows and one matching 10 million.

**Prevent.** For queries with known parameter skew, set `force_custom_plan` surgically. Don't
disable generic plans globally — for most queries they're a win.

---

## Correctness

### S8. The re-engagement email that went to nobody
→ [[MASTERY-INSIGHTS.md]] 3.1 · [[CURRICULUM.md]] 2.1

**Situation.** A campaign targets "customers who have never ordered":
`WHERE customer_id NOT IN (SELECT customer_id FROM orders)`. It worked in staging. In
production it selected **zero** customers and the campaign emailed no one — with no error.

**Diagnosis.** Check the subquery for NULLs: `SELECT count(*) FROM orders WHERE customer_id
IS NULL` returns > 0 (a guest order, a data-quality gap). One NULL in the `NOT IN` list makes
the whole predicate `UNKNOWN` for every row.

**Solution.** Use `NOT EXISTS` (NULL-safe by construction):
```sql
SELECT c.* FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.id
);
```

**Why.** `x NOT IN (1, 2, NULL)` expands to `x <> 1 AND x <> 2 AND x <> NULL`; `x <> NULL` is
`UNKNOWN`, so the `AND` can never be `TRUE`. Result: no rows, silently.

**Prevent.** Make `NOT EXISTS` your default for anti-joins. Treat `NOT IN (subquery)` as a
smell unless the column is provably `NOT NULL`.

---

### S9. The revenue dashboard that read 10× too high
→ [[MASTERY-INSIGHTS.md]] 4.1 · [[CURRICULUM.md]] 1.5

**Situation.** After someone added a second join, the revenue dashboard shows ~10× actual
revenue. The query joins `orders` to both `order_items` and `shipments` and sums
`orders.total`.

**Diagnosis.** Count rows before and after each join. An order with 5 items and 2 shipments
becomes `5 × 2 = 10` rows after both joins, so `SUM(orders.total)` counts each order's total
10 times. It's a **cardinality (fan-out) bug**, not a slow query.

**Solution.** Aggregate each one-to-many *before* joining, so each order stays one row:
```sql
SELECT o.id,
       o.total,
       i.item_count,
       s.shipment_count
FROM orders o
LEFT JOIN (SELECT order_id, count(*) item_count
           FROM order_items GROUP BY order_id) i ON i.order_id = o.id
LEFT JOIN (SELECT order_id, count(*) shipment_count
           FROM shipments GROUP BY order_id) s ON s.order_id = o.id;
-- Now SUM(o.total) is correct.
```

**Why.** Joining two independent one-to-many relationships multiplies rows. Any aggregate
over the multiplied set is inflated.

**Prevent.** Never join two independent one-to-many tables in one flat query and aggregate.
`SELECT DISTINCT` does **not** fix this — it hides duplicate rows but leaves the inflated
`SUM`. Pre-aggregate, or use `LATERAL`.

---

### S10. The "active users" report missing half its rows
→ [[MASTERY-INSIGHTS.md]] 3.3 · [[CURRICULUM.md]] 1.5

**Situation.** "All users and their last login, including those who never logged in":
```sql
SELECT u.*, l.last_login
FROM users u
LEFT JOIN logins l ON l.user_id = u.id
WHERE l.success = true;
```
The never-logged-in users — exactly the ones you wanted to include — are missing.

**Diagnosis.** For unmatched left rows, `l.success` is `NULL`. The `WHERE l.success = true`
evaluates `NULL = true` → `UNKNOWN` → row filtered out. The `WHERE` silently turned your
`LEFT JOIN` into an `INNER JOIN`.

**Solution.** Move the condition into the `ON` clause so it filters *what to join*, not *what
to keep*:
```sql
SELECT u.*, l.last_login
FROM users u
LEFT JOIN logins l ON l.user_id = u.id AND l.success = true;
```

**Why.** A condition on the outer (nullable) side of a `LEFT JOIN` placed in `WHERE` removes
the NULL-extended non-matching rows. In `ON`, it only restricts the match.

**Prevent.** Rule: conditions on the outer side of an outer join go in `ON`, not `WHERE` —
unless you specifically want `IS NULL` to find non-matches.

---

### S11. The percentage that always showed 0
→ [[MASTERY-INSIGHTS.md]] 3.2 · [[CURRICULUM.md]] 0.5, 1.4

**Situation.** A "shipped rate" metric computed as `count(shipped_at) / count(*)` shows `0`
for every group, even though clearly some orders shipped.

**Diagnosis.** Both counts are `bigint`. `bigint / bigint` is **integer division**:
`900 / 1000 = 0`, not `0.9`. The fraction is truncated to zero.

**Solution.** Cast before dividing:
```sql
SELECT count(shipped_at)::numeric / count(*) AS shipped_rate FROM orders;
-- or:
SELECT avg((shipped_at IS NOT NULL)::int) AS shipped_rate FROM orders;
```

**Why.** Division of two integers in Postgres truncates toward zero. Any ratio built from
integer columns loses its fractional part unless one side is `numeric`/`float`.

**Prevent.** Cast one operand to `numeric` in every ratio/percentage/average built from
integers. It's one of the most common "the number is just wrong, no error" bugs.

---

## Concurrency

### S12. The last item sold twice
→ [[MASTERY-INSIGHTS.md]] 6.1 · [[CURRICULUM.md]] 3.1, 3.2

**Situation.** Two checkout requests buy the last unit of a product at the same instant. Both
succeed. You've oversold — `stock` went to `-1`, or two orders got the one unit.

**Diagnosis.** The code reads `stock` (both see `1`), decides it's fine, and writes
`stock - 1` (both write `0`). Wrapping it in a transaction didn't help — under `READ
COMMITTED` a transaction isn't a lock, and the conflict is on the write (a **lost update**).

**Solution.** Do the check-and-decrement in **one atomic statement**:
```sql
UPDATE inventory SET stock = stock - 1
WHERE product_id = $1 AND stock > 0
RETURNING stock;      -- zero rows returned = it was already out
```
If it returns no row, the sale failed the stock check. (Alternatives: `SELECT ... FOR
UPDATE` around the read-modify-write, or `REPEATABLE READ`/`SERIALIZABLE` with retry.)

**Why.** The single `UPDATE` is safe even under `READ COMMITTED` via **EvalPlanQual**: when
the second update blocks on the row and the first commits, Postgres re-reads the new row
version and re-checks `stock > 0` against it — so it sees the already-decremented value.

**Prevent.** Never do read-modify-write of a contended value across a round trip without a
lock. Prefer a single conditional `UPDATE ... WHERE`.

---

### S13. The job processed three times
→ [[MASTERY-INSIGHTS.md]] 6.2 · [[CURRICULUM.md]] 3.2

**Situation.** You built a job queue as a table with a `status` column. Ten workers each run
"grab the oldest pending job." Jobs get processed multiple times, or all workers block on the
same row and throughput collapses to one-worker speed.

**Diagnosis.** Every worker's `SELECT ... WHERE status='pending' ORDER BY created_at LIMIT 1`
selects the *same* row. Plain `FOR UPDATE` makes them queue behind each other; no locking at
all lets them all grab it.

**Solution.** `FOR UPDATE SKIP LOCKED` — each worker takes a row others haven't:
```sql
UPDATE jobs SET status = 'running'
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

**Why.** `SKIP LOCKED` makes each worker skip rows already locked by another, so ten workers
pull ten distinct jobs concurrently with no blocking and no double-processing.

**Prevent.** Any table-as-queue needs `SKIP LOCKED`. This is why "just use Postgres as your
queue" is viable — but only with this clause.

---

### S14. The money transfer that deadlocked
→ [[MASTERY-INSIGHTS.md]] 6.3 · [[CURRICULUM.md]] 3.2

**Situation.** A "transfer from account A to account B" function occasionally fails with
`deadlock detected` (`40P01`) under concurrency. It locks the sender row, then the receiver.

**Diagnosis.** Request 1 transfers A→B (locks A, wants B). Request 2 transfers B→A (locks B,
wants A). Each holds what the other needs — a cycle. Postgres detects it and kills one.

**Solution.** Acquire locks in a **consistent order** regardless of transfer direction:
```sql
-- Always lock the lower id first:
SELECT * FROM accounts
WHERE id IN ($sender, $receiver)
ORDER BY id
FOR UPDATE;      -- both requests grab the lower id first; one simply waits
```
Keep a retry loop for the residual cases.

**Why.** Deadlocks are almost always *inconsistent lock ordering*. Impose a total order on
lock acquisition and the cycle can't form.

**Prevent.** Establish one canonical ordering for multi-row locks (by id) everywhere.
Retries handle the rare remainder; frequent deadlocks mean the ordering bug isn't fixed.

---

### S15. The whole database slowed down at 2am
→ [[MASTERY-INSIGHTS.md]] 7.1 · [[CURRICULUM.md]] 4.7, 5.4

**Situation.** Overnight, query latency across *many* unrelated tables degrades, and table
sizes creep up despite stable row counts. By morning it's noticeably worse every day.

**Diagnosis.** `SELECT * FROM pg_stat_activity WHERE state = 'idle in transaction'` shows
connections sitting in open transactions for minutes. A batch job (or an app path doing an
HTTP call mid-transaction) leaves transactions open. That holds back the xmin horizon so
`VACUUM` can't reclaim dead tuples **anywhere**.

**Solution.** Close transactions promptly; never do network I/O inside one. Add a safety net:
```sql
SET idle_in_transaction_session_timeout = '30s';   -- kills leaked transactions
```

**Why.** Postgres can't vacuum row versions newer than the oldest running transaction's
snapshot — it might still need to see them. One long-open transaction freezes cleanup
database-wide, so dead tuples accumulate and every scan reads more pages.

**Prevent.** Keep transactions short and DB-only; no `await`-ing an external call with a
transaction open. Set `idle_in_transaction_session_timeout` as a backstop.

---

## Design & schema

### S16. The double-booking that shouldn't have been possible
→ [[DESIGN.md]] §8 · [[CURRICULUM.md]] 3.3, 3.4

**Situation.** A room-booking app occasionally books the same room for overlapping times,
even though the app checks availability before inserting. Two concurrent requests both pass
the check, then both insert.

**Diagnosis.** The "check then insert" has a race — between the check and the insert, the
other request inserts. Application-level checks can't prevent this; only the database, at
insert time, can.

**Solution.** Enforce non-overlap with an **`EXCLUDE` constraint** so the database rejects any
overlapping booking atomically:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, during WITH &&);
-- `during` is a tstzrange; && is "overlaps". A conflicting insert now errors.
```

**Why.** The `EXCLUDE` constraint enforces a relationship *between rows* (no two rows for the
same room have overlapping ranges) at write time, holding under concurrency — something no
per-row check or app logic can guarantee.

**Prevent.** Any "no two of these can overlap/collide" rule belongs in a constraint, not app
code. Use half-open ranges `[start, end)` so adjacent bookings that merely touch don't count
as overlapping.

---

### S17. The `varchar(255)` that needed a migration to grow
→ [[MASTERY-INSIGHTS.md]] 9.2 · [[DESIGN.md]] §6

**Situation.** A `notes varchar(255)` column starts rejecting valid input as the product
evolves. Relaxing the limit needs an `ALTER TABLE` — historically a table-rewrite risk under
load — for a constraint that never bought anything.

**Diagnosis.** `varchar(255)` was a guessed limit (a MySQL-era habit). In Postgres, `text`
and `varchar` are identical in storage and performance; the `(255)` is a validation rule with
no upside here, and now it's a liability.

**Solution.** Use `text`; enforce a real limit with a `CHECK` *only* when the business has one:
```sql
ALTER TABLE t ALTER COLUMN notes TYPE text;
-- Only if there's a genuine rule:
ALTER TABLE t ADD CONSTRAINT notes_len CHECK (length(notes) <= 2000);
```

**Why.** The declared length doesn't save space (storage tracks actual length). It's purely a
validator, so it should reflect a real domain rule, not a guess.

**Prevent.** Default text columns to `text`. Add length checks only for actual constraints
(an SMS body, a username), where the limit is defensible.

---

### S18. The user renamed themselves and a million rows lied
→ [[DESIGN.md]] §4 · [[CURRICULUM.md]] (modeling)

**Situation.** To "avoid a join," someone copied `user_name` onto every `posts` row. A user
changes their display name, and now a million old posts show the *old* name. Nobody updated
the copies.

**Diagnosis.** The name is a fact about the *user*, stored redundantly on *posts*. Redundant
data drifts the moment the source changes and the copies don't. This is a normalization
violation adopted as a "performance" shortcut without the sync obligation.

**Solution.** Store the name once on `users`; join to display it:
```sql
SELECT p.*, u.user_name
FROM posts p JOIN users u ON u.id = p.user_id;
```
If the join genuinely is too expensive at scale and you *must* denormalize, keep the copy
honest with a trigger (or accept eventual consistency deliberately) — and write down that
obligation.

**Why.** Normalization stores each fact once so it can't disagree with itself. Denormalization
trades that for read speed and takes on a sync duty. A denormalized value with no sync
mechanism is a latent bug.

**Prevent.** Don't copy a related entity's attributes to "avoid a join" by default. Denormalize
only when a specific query forces it, and always pair the copy with how it stays in sync.

---

### S19. The primary key that ran out of numbers
→ [[DESIGN.md]] §6, §7 · [[CURRICULUM.md]] 1.8b

**Situation.** A high-volume `events` table with `id int` (or `serial`) starts throwing
`integer out of range` on insert. The table hit ~2.1 billion rows and the PK sequence
exhausted `int`'s range. Writes are now failing in production.

**Diagnosis.** `int` maxes at 2,147,483,647. A busy append-only table reaches that faster than
people expect (it counts *all* inserts ever, including deleted rows — sequences don't reuse
numbers). Migrating a live PK from `int` to `bigint` is a painful, near-full-table operation.

**Solution.** Use `bigint` identity for keys from the start. To fix an existing one, plan a
careful migration (add a new `bigint` column, backfill in batches, switch over) — expensive,
which is why prevention matters.

**Why.** Sequences increment past deleted rows and never look back; the ceiling is total
inserts, not current row count. `bigint` (2^63) is effectively inexhaustible.

**Prevent.** Default every surrogate PK to `bigint` (`GENERATED ALWAYS AS IDENTITY`). Never
`int` for anything that could grow. For distributed id generation, `uuidv7()` (PG18,
timestamp-ordered) preserves index locality that random UUIDv4 destroys.

---

### S20. The timestamps that shifted by an hour twice a year
→ [[MASTERY-INSIGHTS.md]] 9.1 · [[DESIGN.md]] §6

**Situation.** "Events in the last hour" reports go wrong by an hour twice a year (at DST
boundaries), and after adding a server in another region, the same stored time means different
moments to different readers. The column is `timestamp` (without time zone).

**Diagnosis.** Plain `timestamp` stores a zone-less wall-clock reading — an ambiguous number.
Its meaning depends on who reads it and in what zone; DST and multi-region readers expose the
ambiguity.

**Solution.** Store `timestamptz`, which records an unambiguous instant (normalized to UTC)
and converts on display:
```sql
ALTER TABLE events ALTER COLUMN occurred_at TYPE timestamptz
  USING occurred_at AT TIME ZONE 'UTC';   -- interpret existing values as UTC
```

**Why.** `timestamptz` fixes the instant; only its *display* varies by session zone. `timestamp`
leaves the instant undefined, so correctness depends on every writer and reader agreeing on a
zone forever — a property real systems don't have.

**Prevent.** Store `timestamptz` for any real moment in time. Reserve plain `timestamp` for a
genuinely zone-less wall clock (a store's "opens at 09:00" independent of date/zone).

---

## Operations at the app boundary

### S21. The migration that took the site down
→ [[MASTERY-INSIGHTS.md]] TODO (migrations) · [[CURRICULUM.md]] 5.6

**Situation.** A schema migration that was "instant in staging" locked up production: for
several minutes, *all* queries on a busy table hung, and the site effectively went down.

**Diagnosis.** The migration ran an `ALTER TABLE` needing an `ACCESS EXCLUSIVE` lock (or `ADD
FOREIGN KEY`, or a plain `CREATE INDEX`). It queued behind one long-running `SELECT`, and —
critically — a *waiting* `ACCESS EXCLUSIVE` lock request **blocks all new queries** on the
table behind it. Staging had no long-running query to queue behind, so it looked instant.

**Solution.** Use non-blocking forms and fail fast instead of queuing:
```sql
CREATE INDEX CONCURRENTLY ...;        -- doesn't take ACCESS EXCLUSIVE
SET lock_timeout = '2s';              -- don't sit in the lock queue; fail and retry
-- then run the ALTER; retry on lock_timeout rather than blocking traffic
```
Add columns without a volatile default (fast path), backfill in batches, validate constraints
in a second step (`NOT VALID` then `VALIDATE CONSTRAINT`).

**Why.** A pending strong lock blocks everything arriving after it, so one slow query plus a
blocking DDL statement freezes the whole table. `CONCURRENTLY` and `lock_timeout` avoid the
queue.

**Prevent.** Treat every migration as running against live traffic: prefer `CONCURRENTLY`, set
a short `lock_timeout` with retry, split blocking operations into non-blocking steps, and test
against a database that *has* concurrent load.

---

### S22. The serverless app that exhausted connections
→ [[MASTERY-INSIGHTS.md]] 11.1 · [[CURRICULUM.md]] 5.1

**Situation.** Under traffic, a serverless app spins up hundreds of function instances, each
opening its own database connection. Postgres starts refusing connections (`too many
clients`), and even before that, throughput *drops* as connections climb.

**Diagnosis.** Each Postgres connection is a full backend process. Hundreds of them contend
for CPU/RAM, and throughput often *peaks* at a low connection count then degrades. Raising
`max_connections` makes it worse, not better.

**Solution.** Put a **connection pooler** (PgBouncer, or the platform's pooled endpoint) in
**transaction mode** between the app and Postgres, multiplexing many clients onto a few dozen
real backends. Point the app at the pooler.

**Why.** Connections are expensive and Postgres doesn't scale by adding them past a point.
Transaction-mode pooling shares a small pool of real connections across many short
transactions.

**Prevent.** Never open a connection per request/instance directly to Postgres in a
high-fan-out (serverless) environment. Use a pooler — and know transaction mode breaks
session state (session `SET`, `LISTEN/NOTIFY`, advisory session locks), so write the app not
to rely on it.

---

### S23. The import procedure that mysteriously slowed the whole cluster
→ [[MASTERY-INSIGHTS.md]] 7.3 · [[CURRICULUM.md]] 2.11, 3.6

**Situation.** A PL/pgSQL import wraps each row in a `BEGIN ... EXCEPTION WHEN ... END` block
for robustness. On 100 rows in dev it's fine. In production at scale, throughput collapses —
and *unrelated* queries across the whole database slow down at the same time.

**Diagnosis.** Each `EXCEPTION` block (and each `SAVEPOINT`) opens a **subtransaction**. Once a
transaction holds more than **64** subtransactions, the per-backend cache overflows and other
backends must hit the `pg_subtrans` SLRU on disk to resolve row visibility — a small,
contended, cluster-wide resource. Look for `SubtransSLRU` wait events in `pg_stat_activity`.

**Solution.** Don't open a subtransaction per row. Handle errors outside the hot loop, or use a
set-based write that needs no exception handling:
```sql
INSERT INTO target (...)
SELECT ... FROM staging
ON CONFLICT DO NOTHING;      -- no per-row SAVEPOINT/EXCEPTION needed
```

**Why.** Subtransactions are cheap individually and pathological in bulk: they burn XIDs and,
past 64 per transaction, trigger SLRU lookups under contention that slow every backend, not
just the offender.

**Prevent.** Avoid per-row `EXCEPTION`/`SAVEPOINT` in large loops. Validate up front or use
`ON CONFLICT`. Watch subtransaction-related wait events on import workloads.

---

*Maintenance note: each scenario keeps the Situation → Diagnosis → Solution → Why → Prevent
shape — that shape is the lesson. New scenarios should cross-link to the principle they
illustrate in [[MASTERY-INSIGHTS.md]] / [[DESIGN.md]] / [[CURRICULUM.md]] rather than
re-explaining it. When a scenario reveals a gap in those files, add the principle there too.*
