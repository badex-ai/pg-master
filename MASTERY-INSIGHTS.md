# PostgreSQL Mastery Insights — What Separates a Master from a Pro

> **Pinned version: PostgreSQL 18.** All numbers and behaviors are written against PG 18;
> the live practice instance must match. Where a "numbers" block cites a figure, it also
> names the query that reproduces it (`pgstatindex`, `pg_stats`, `EXPLAIN`) — an asserted
> figure the learner can't reproduce is worse than none.
>
> **What this file is.** [[CURRICULUM.md]] lists *what* to learn. This file holds the
> other thing — the buried, counter-intuitive judgment that only shows up after years
> of running Postgres in production and getting burned. A pro knows the feature. A
> master knows the *myth* about the feature, the *number* that kills the myth, and the
> *trap* that still catches people who "know" the feature.
>
> **How the app uses this.** After teaching a topic and quizzing on it, the app surfaces
> the matching insight(s) here as the "what a master knows" reveal. Every entry follows
> the same shape so the app can render it consistently:
>
> - **The myth** — what a competent pro believes (and why it's reasonable to believe).
> - **The reality** — what's actually true.
> - **The numbers** — concrete figures/table, because intuition needs an anchor.
> - **Real life** — a scenario you can picture, in ordinary application terms.
> - **The trap** — the thing that *still* bites people who know the reality.
>
> Each entry is cross-referenced to its curriculum unit like `→ Curriculum 4.3`.

---

## Table of Contents

- [1. Indexing](#1-indexing)
- [2. Query Planning & EXPLAIN](#2-query-planning--explain)
- [3. NULL & Three-Valued Logic](#3-null--three-valued-logic)
- [4. Joins & Cardinality](#4-joins--cardinality)
- [5. MVCC, Bloat & VACUUM](#5-mvcc-bloat--vacuum)
- [6. Concurrency & Locking](#6-concurrency--locking)
- [7. Transactions & Isolation](#7-transactions--isolation)
- [8. Pagination & Large Result Sets](#8-pagination--large-result-sets)
- [9. Data Types & Modeling](#9-data-types--modeling)
- [10. Writes, Batching & the Cost of Modification](#10-writes-batching--the-cost-of-modification)
- [11. Connections, Pooling & the Application Boundary](#11-connections-pooling--the-application-boundary)
- [12. JSONB — Power and Its Price](#12-jsonb--power-and-its-price)
- [13. The Meta-Skill: How Masters Think](#13-the-meta-skill-how-masters-think)
- [Areas still to be written (second pass)](#areas-still-to-be-written-second-pass)

---

## 1. Indexing

### 1.1 "Billions of rows can't be cheaply indexed" — WRONG
→ Curriculum 4.3

**The myth.** Index lookup cost scales with the number of rows. A table with 1.5 billion
rows must be far more expensive to search than one with 4 million, so at some point a
table gets "too big to index."

**The reality.** Postgres B-tree indexes scale *logarithmically*, not linearly. Lookup
and insert are **O(log n)**. The tree gains *levels*, not proportional work, as it grows.

**The numbers.** (Reproduce with `SELECT * FROM pgstatindex('your_index')` and read
`tree_level`; each B-tree page holds ~hundreds of keys, so levels grow very slowly.)

| Rows in index          | Tree levels to traverse (≈ log) |
|------------------------|---------------------------------|
| 4 million (one day)    | ~3                              |
| 1.5 billion (one year) | ~4                              |

A **375× increase** in data adds roughly **one extra level**. `log₂(1.5 billion) ≈ 30` in
raw comparisons, but only a *handful* of page reads in tree levels because each B-tree page
holds hundreds of keys (a 4M-row index has ~11k leaf pages → ~30 internal → 1 root ≈ 3
levels). Billions of rows in one indexed table is a *boring, ordinary* size for Postgres.

**Real life.** You're building seat reservations. A year of bookings is ~1.5 billion rows
and you hesitate: "is a unique index on `(event_id, seat_id)` even reasonable at that
size?" It is completely reasonable. The uniqueness check that prevents double-booking
costs about *one* more page read than it did on day one. Your instinct to shard or archive
"because it's too big to index" would be solving a problem you don't have.

**The trap that still bites pros.** The cost that *does* grow is not lookup depth — it's
(a) the index **not fitting in RAM** (once the upper levels fall out of `shared_buffers`
and OS cache, those "cheap hops" become disk reads), and (b) **write amplification** —
every insert maintains every index, and a wide row with 8 indexes pays 8× the write cost
plus WAL. So the master's correction is precise: *lookup* is O(log n) and basically free;
*maintaining* the index on writes and *keeping it cached* are the real costs. You right-size
by caring about index size vs RAM and write volume, never about lookup depth.

### 1.2 An index can make a query *slower* — and often does nothing
→ Curriculum 4.3

**The myth.** Adding an index makes reads faster. More indexes = faster database.

**The reality.** An index helps only when it's **selective** — when it lets Postgres skip
most of the table. If a query returns a large fraction of rows, a sequential scan is
*faster* than an index scan, because random index-driven heap access is slower than a
clean sequential read. The planner knows this and will *ignore* your index. Meanwhile the
index still taxes every write.

**The numbers.** Rule of thumb: if a query touches more than roughly **5–10%** of a table,
Postgres usually prefers a `Seq Scan`. An index on a boolean `is_active` where 95% of rows
are active is nearly useless for finding active rows (but *is* useful for the 5% inactive —
which is exactly what a **partial index** `WHERE is_active = false` captures).

**Real life.** You add an index on `orders.status` to speed up "show me pending orders."
It works great. Then someone runs "show me completed orders" — 90% of the table — and the
index is ignored; you've paid for an index that helps one value and not the other. The
master reaches for a **partial index** on the rare states, not a full index on the column.

**The trap.** People add indexes reactively ("this query is slow, add an index") and never
remove them. Six months later the write path is carrying a dozen indexes, half never used.
Check `pg_stat_user_indexes.idx_scan = 0` to find the freeloaders. An unused index is pure
cost: slower writes, more WAL, more bloat, longer `VACUUM`.

### 1.3 Column order in a composite index is not cosmetic
→ Curriculum 4.3

**The myth.** A multicolumn index on `(a, b)` helps any query touching `a` or `b` equally.

**The reality.** A B-tree on `(a, b)` is sorted by `a` first, then `b` *within* each `a`.
It efficiently serves `WHERE a = ?`, `WHERE a = ? AND b = ?`, and `a`-range queries. For
`WHERE b = ?` **alone** the classic **leftmost-prefix rule** says the index is useless,
because the `b` values are scattered. **Design as if that rule holds** — but know the PG18
nuance so the live editor doesn't blindsight you: PostgreSQL 18 added **B-tree skip scan**,
which *can* use `(a, b)` for a query restricted only on `b` by internally "skipping" through
the distinct `a` values. The catch is cardinality — skip scan is a win only when `a` has
**few** distinct values (it does one sub-search per distinct `a`); when `a` has millions of
distinct values, skipping degrades toward a full index scan and the leftmost-prefix
intuition is effectively back. So: still order your index for the leading-column queries you
actually run; treat skip scan as a safety net for the occasional `b`-only query on a
low-cardinality leading column, not as license to stop thinking about column order.

**The numbers.** `(a, b)` is ideal for: `a`; `a, b`; `a`-range. For `b` alone: fast only if
`a` has, say, tens of distinct values (skip scan does ~that many sub-searches); useless if
`a` has millions. So `(tenant_id, created_at)` with 20 tenants can skip-scan a
`created_at`-only query tolerably; with 10 million tenants it can't. Confirm which you got
by reading the `Index Skip Scan` vs `Seq Scan` node in `EXPLAIN`.

**Real life.** Multi-tenant app with thousands of tenants. You index `(tenant_id,
created_at)` and per-tenant dashboards fly. Analytics asks for "signups across all tenants
this week" — `created_at` only. Even on PG18, with thousands of distinct tenants skip scan
won't save you; the honest fix is a *different* index with `created_at` leading, or a
different access pattern. The lesson survives skip scan; skip scan just changes *where* the
line sits.

**The trap.** Ordering by "most columns first" or alphabetically. The right order is:
**equality columns before range columns**, and generally the most selective equality first.
`WHERE a = ? AND b > ?` wants `(a, b)`, not `(b, a)` — put the equality (`a`) first so the
range (`b`) can be walked contiguously.

---

## 2. Query Planning & EXPLAIN

### 2.1 The plan is built from *estimates*, and estimates lie
→ Curriculum 4.1, 4.4

**The myth.** `EXPLAIN` tells you what the query costs.

**The reality.** `EXPLAIN` shows **estimates** from statistics. `EXPLAIN ANALYZE` shows what
*actually* happened. The single most valuable habit in Postgres performance work is
comparing the two — the gap between **estimated rows** and **actual rows** is where bad
plans are born. A planner that thinks a step returns 5 rows but it returns 5 million will
pick a nested loop that runs 5 million times.

**The numbers.** In `EXPLAIN ANALYZE` output, look at `rows=X ... (actual ... rows=Y)`.
If `Y` is 100× or 1000× off from `X`, the planner is flying blind on that node, and every
decision above it in the tree is suspect.

**Real life.** A report query that ran in 40ms for a year suddenly takes 40 seconds. Nothing
in the code changed. What changed: the data distribution drifted and `ANALYZE` hadn't run,
so the planner's estimate for a filter went stale, it switched from a hash join to a nested
loop, and the loop now iterates millions of times. `ANALYZE the_table;` fixes it in one line
— but only a master looks at the estimate/actual gap first instead of "adding an index."

**The trap.** Trusting the `cost=` numbers as if they were milliseconds. They're an abstract
unit for *comparing plans*, not a time prediction. Two plans with cost 100 and 200 don't run
in 100ms and 200ms. Read `actual time`, `rows`, `loops`, and `BUFFERS` — never the cost —
when you want truth.

### 2.2 Correlated columns wreck estimates (and Postgres assumes independence)
→ Curriculum 4.4

**The myth.** The planner understands your data.

**The reality.** By default Postgres estimates the selectivity of `WHERE a = ? AND b = ?`
by *multiplying* the two column selectivities, **assuming they're independent**. When the
columns are correlated, this undershoots massively.

**The numbers.** `city = 'Paris'` selects 1% of rows; `country = 'France'` selects 2%.
Postgres estimates `1% × 2% = 0.02%`. But every Paris row *is* in France, so the true
selectivity is 1%, not 0.02% — a **50× underestimate**. That bad estimate can turn a
correct hash join into a catastrophic nested loop.

**Real life.** You filter shipments by `warehouse_region` and `warehouse_id` (which is
fully determined by region). The planner thinks the combination is vanishingly rare, picks
a nested loop, and a nightly job that should take a minute takes an hour. `CREATE STATISTICS
(dependencies) ON warehouse_region, warehouse_id FROM shipments;` then `ANALYZE` — and the
planner suddenly sees the real cardinality.

**The trap.** Assuming the planner "learns." It never notices correlation on its own; you
must declare it with **extended statistics**. Almost no one below master level knows
`CREATE STATISTICS` exists, which is exactly why it's here.

### 2.3 The prepared statement that's fast five times, then slow on the sixth
→ Curriculum 4.6, 5.2

**The myth.** A prepared/parameterized statement plans once and reuses that plan, so its
performance is stable.

**The reality.** Postgres builds a **custom plan** (re-planned with the actual parameter
values) for the first **five** executions of a prepared statement, then decides whether to
switch to a **generic plan** (planned once, parameter-blind, reused forever). If your data
is *skewed* on the parameter — some values match 10 rows, others match 10 million — the
generic plan is chosen from an *average* estimate and can be catastrophically wrong for the
value you actually pass on execution six and beyond.

**The numbers.** A query on `WHERE status = $1` where `status='archived'` is 99% of rows and
`status='pending'` is 0.1%: the custom plans (executions 1–5) each pick the right access
path per value; the generic plan picks *one* path for the averaged selectivity. The sixth
execution can flip from an index scan to a seq scan (or vice-versa) and jump from 2ms to
20s — with **zero** code or data change, purely because the plan cache crossed a threshold.

**Real life.** A dashboard endpoint is fast in load testing and fast for the first few real
requests, then a specific customer's requests start timing out intermittently — the ones
whose parameter value the generic plan is wrong for. It's maddening to debug because it's
invisible until execution six *and* only for certain parameter values. The master knows to
check `plan_cache_mode` — set it to `force_custom_plan` for the offending query (or globally
for known-skewed workloads), which trades a little planning time for stable, per-value plans.

**The trap.** Reaching for this too early — for most queries the generic plan is fine and
re-planning every time wastes CPU. The master applies `force_custom_plan` *surgically* to
queries with known parameter skew, having first confirmed the flip with `EXPLAIN` at
different parameter values, rather than globally disabling a mostly-helpful optimization.

---

## 3. NULL & Three-Valued Logic

### 3.1 `NOT IN` with a NULL in the list returns *nothing*
→ Curriculum 0.4, 2.1

**The myth.** `WHERE x NOT IN (subquery)` returns rows where `x` isn't in the subquery.

**The reality.** If the subquery yields even a *single* `NULL`, `NOT IN` returns **zero
rows** — silently, no error. Because `x NOT IN (1, 2, NULL)` expands to `x <> 1 AND x <> 2
AND x <> NULL`, and `x <> NULL` is `UNKNOWN`, so the whole `AND` can never be `TRUE`.

**The numbers.** One NULL in a million-row subquery is enough to make the entire outer
query return empty. It's not "slightly wrong" — it's *all-or-nothing* wrong.

**Real life.** "Find customers with no orders": `WHERE customer_id NOT IN (SELECT
customer_id FROM orders)`. Works in dev. In production one order row has a NULL
`customer_id` (a data-quality issue you didn't cause), and the query returns **no
customers at all** — so your "customers to re-engage" campaign emails nobody, and no error
ever fires. This is a genuinely famous production incident pattern.

**The trap.** Even knowing this, people "fix" it with `NOT IN (SELECT ... WHERE x IS NOT
NULL)` and move on. The master's reflex is to use **`NOT EXISTS`** instead — it's NULL-safe
by construction, and usually gets a better anti-join plan too. `NOT EXISTS` should be your
default; `NOT IN` should make you nervous.

### 3.2 `COUNT(column)` silently skips NULLs; `COUNT(*)` doesn't
→ Curriculum 1.4

**The myth.** `COUNT(x)` counts the rows.

**The reality.** `COUNT(*)` counts rows. `COUNT(x)` counts rows where `x IS NOT NULL`. They
differ by exactly the number of NULLs in `x`.

**Real life.** "Fraction of orders that shipped" computed as `COUNT(shipped_at) /
COUNT(*)`. The moment some orders haven't shipped (`shipped_at IS NULL`), `COUNT(shipped_at)`
drops below `COUNT(*)` — which is *correct* here, that's the point. But the report shows
`0` for every group, because both counts are `bigint` and `bigint / bigint` is **integer
division**: `900 / 1000 = 0`, not `0.9`. The master writes `COUNT(shipped_at)::numeric /
COUNT(*)` (or `AVG((shipped_at IS NOT NULL)::int)`), and reaches for `COUNT(x)` deliberately
only when "how many have a value" is the actual question, `COUNT(*)` for "how many rows."

**The trap #1 — integer division.** `a / b` where both are integers **truncates toward
zero** in Postgres: `1/2 = 0`, `9/10 = 0`, `7/2 = 3`. Any ratio, percentage, or average
built from integer columns silently loses its fractional part. Cast one side to `numeric`
(or `::float`) *before* dividing. This is one of the most common "the number is just wrong,
not erroring" bugs in reporting SQL.

**The trap #2 — `AVG(x)` ignores NULLs too.** `AVG` over a column with NULLs is the average
*of the non-null values*, which is often **not** the business average you want (where a
missing value might mean zero). "Ignore vs treat-as-zero" is a decision; NULL makes it for
you unless you use `COALESCE(x, 0)`.

### 3.3 An outer join's `WHERE` clause can secretly turn it into an inner join
→ Curriculum 1.5

**The myth.** `LEFT JOIN` always keeps all left rows.

**The reality.** It does — until you put a condition on the *right* table in `WHERE`. For
unmatched left rows, the right columns are NULL, and almost any `WHERE right.col = ?` filters
those NULL rows back out, collapsing your `LEFT JOIN` into an `INNER JOIN`.

**Real life.** "All users and their last login, including users who never logged in":
`LEFT JOIN logins ... WHERE logins.success = true`. The never-logged-in users have
`logins.success = NULL`, `NULL = true` is `UNKNOWN`, and they vanish — the exact users you
were trying to find. The fix: move the condition into the `ON` clause (`LEFT JOIN logins ON
... AND logins.success = true`), so it filters *what to join*, not *what to keep*.

**The trap.** This is *the* outer-join mistake, and it survives code review constantly
because the query looks correct and returns plausible (just incomplete) results. The
master's rule: **conditions on the outer (nullable) side of a `LEFT JOIN` belong in `ON`,
not `WHERE`** — unless you specifically want `IS NULL` to find non-matches.

---

## 4. Joins & Cardinality

### 4.1 The join that returns too many rows is a cardinality bug, not a speed bug
→ Curriculum 1.5, 4.2

**The myth.** A slow join needs an index or more `work_mem`.

**The reality.** Very often a "slow" join is actually a **row-multiplication** bug: you
joined on a non-unique key and every left row matched many right rows, so the result set
exploded. It's not slow because it's inefficient — it's slow because it's *producing
millions of rows you didn't intend*, and your `SUM` is now inflated too.

**The numbers.** Join `orders` (1M rows) to `order_items` on `order_id` and then also to
`shipments` on `order_id`, where an order has 5 items and 2 shipments: you get `1M × 5 × 2
= 10M` rows, and `SUM(order_total)` is now **10× too high** because each order's total is
counted once per item-shipment combination.

**Real life.** Revenue dashboard reads 10× actual revenue after someone adds a second join.
Finance is thrilled, then confused. The bug isn't performance — it's the fan-out. The fix
is to aggregate each side to one row per order *before* joining (subqueries or `LATERAL`),
never to join two independent one-to-many relationships in one flat query.

**The trap.** `SELECT DISTINCT` to "fix" the duplicate rows. It hides the symptom, doubles
the cost (now you sort/hash to dedup), and does nothing for the inflated `SUM`. The master
diagnoses fan-out by checking row counts at each join, not by papering over it with `DISTINCT`.

### 4.2 `EXISTS` short-circuits; `IN` may materialize
→ Curriculum 2.1

**The myth.** `IN (subquery)` and `EXISTS (subquery)` are interchangeable.

**The reality.** `EXISTS` stops at the *first* matching row (semi-join semantics). `IN` can
require materializing/deduplicating the subquery result. Modern planners often rewrite both
to the same semi-join, but they diverge sharply around NULLs (see 3.1) and when the subquery
is large or correlated.

**Real life.** "Users who have at least one order" — `EXISTS (SELECT 1 FROM orders WHERE
orders.user_id = users.id)` can stop as soon as it finds one order per user. The equivalent
`IN` over a 100M-row orders table may build a large hash of distinct user_ids first. On big
tables the difference is seconds vs minutes.

**The trap.** Cargo-culting "`EXISTS` is always faster." It isn't always — for small,
uncorrelated sets they tie. The master picks `EXISTS` for **existence checks** (and for NULL
safety) and reaches for a real **`JOIN`** when they actually need columns from the other
table, rather than fetching them in a second round trip.

---

## 5. MVCC, Bloat & VACUUM

### 5.1 `UPDATE` is a `DELETE` + `INSERT` in disguise
→ Curriculum 4.5

**The myth.** Updating one column of one row is a cheap, in-place edit.

**The reality.** Under MVCC, an `UPDATE` writes a **whole new row version** and marks the
old one dead. The old version sticks around until `VACUUM` reclaims it. So updates create
**bloat** and touch **every index** on the table (unless the update qualifies for HOT — a
heap-only tuple update, which only applies when no indexed column changed and there's free
space on the page).

**The numbers.** A table you `UPDATE` in a tight loop can physically **double or triple in
size** even though the logical row count is unchanged, because dead versions accumulate
faster than autovacuum clears them. A 10GB table can become 30GB of mostly-dead tuples,
and now every scan reads 3× the pages.

**Real life.** A `jobs` table where a worker updates `last_heartbeat_at` every few seconds
per job. Logically tiny. Physically it bloats relentlessly and queries slow down over
weeks, because each heartbeat is a new row version and (if `last_heartbeat_at` is indexed)
an index write too. Masters either don't index the churning column, put high-churn counters
in a separate skinny table, or tune autovacuum to be aggressive on that table specifically.

**The trap.** `VACUUM FULL` to "fix" bloat in production — it takes an `ACCESS EXCLUSIVE`
lock and rewrites the whole table, blocking all reads and writes for the duration. On a
large hot table that's an outage. The master prevents bloat (autovacuum tuning, schema
design) rather than curing it with a lock that stops the world.

### 5.2 `count(*)` on a big table is slow, and that surprises everyone
→ Curriculum 4.5

**The myth.** `SELECT count(*) FROM t` is instant; databases "know" how many rows they have.

**The reality.** Because of MVCC, Postgres can't keep a single true row count — different
transactions see different numbers of live rows. So an exact `count(*)` must **scan every
visible row** (or at least every page, via an index-only scan if the visibility map is
fresh). On a billion-row table that's seconds to minutes.

**Real life.** A paginated admin UI shows "Page 1 of 240,000" by running `count(*)` on every
page load. It was instant with 10k rows in dev and takes 8 seconds per request in production
with 200M rows, and now the admin page times out. The master shows an **estimate**
(`reltuples` from `pg_class`) for "about 200 million," or drops the total count entirely, or
uses keyset pagination that never needs a grand total.

**The trap.** Assuming a `WHERE`-filtered count is cheaper because it returns fewer rows —
it still has to *find* them, which without a selective index means scanning everything anyway.

---

## 6. Concurrency & Locking

### 6.1 Read-modify-write across a round trip is a race, even in a transaction
→ Curriculum 3.1, 5.4

**The myth.** Wrapping "read the balance, then write the new balance" in a transaction makes
it safe.

**The reality.** At the default `READ COMMITTED` isolation, a transaction is **not** a lock.
Two transactions can both read the same value, both compute a new one, and the second write
silently overwrites the first — the **lost update**. `BEGIN`/`COMMIT` alone does not prevent
this.

**Real life.** Two requests decrement the last item of inventory at the same time. Both read
`stock = 1`, both write `stock = 0`, and you've sold the same unit twice. The transaction
boundary did nothing because each transaction read a consistent-*enough* snapshot and the
conflict was on the *write*. Fixes, in order of preference:
1. **Do it in one statement**: `UPDATE ... SET stock = stock - 1 WHERE stock > 0`. This is
   safe even under `READ COMMITTED` because of **EvalPlanQual**: when the second `UPDATE`
   blocks on the row the first is modifying and the first commits, Postgres re-reads the
   *new* row version and **re-checks the `WHERE`** against it — so `stock > 0` is evaluated
   against the freshly-decremented value, not the stale snapshot. (Caveat: EvalPlanQual
   re-checks the row's own predicate; it does not make a multi-row read-modify-write across
   *different* rows atomic — that still needs locking or higher isolation.)
2. **`SELECT ... FOR UPDATE`** to lock the row for the whole read-modify-write.
3. **`REPEATABLE READ`** — already enough to *prevent lost updates*: the second writer gets a
   serialization failure (`40001`) on the concurrent-update recheck. You don't need full
   `SERIALIZABLE` for this specific anomaly.
4. **`SERIALIZABLE`** for the harder anomalies (write skew), with a retry loop.

**The trap.** Thinking `SERIALIZABLE` is "just slower `READ COMMITTED`." It genuinely
prevents these anomalies — but it does so by *aborting* transactions with a serialization
failure (`40001`), which means your application **must** implement a retry loop. Turning on
`SERIALIZABLE` without retry logic just converts silent corruption into visible errors under
load. The master ships the retry loop *with* the isolation level, never one without the other.

### 6.2 `SELECT ... FOR UPDATE SKIP LOCKED` is how you build a correct job queue
→ Curriculum 3.2

**The myth.** A job queue in a table needs a `status` flag and "grab the oldest pending row."

**The reality.** Naively, ten workers all `SELECT ... WHERE status='pending' ORDER BY
created_at LIMIT 1` will all grab the *same* row and either block on each other or process
it multiple times. `FOR UPDATE SKIP LOCKED` is the purpose-built answer: each worker locks
and takes a row *other workers have already skipped*, so ten workers pull ten different jobs
with no blocking and no double-processing.

**Real life.** This single feature is why "just use Postgres as your queue" is viable for a
huge range of systems that reach for Redis/SQS reflexively. Ten workers, `SELECT id FROM jobs
WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, and the database
hands each worker a distinct job with correct concurrency guarantees for free.

**The trap.** Forgetting `SKIP LOCKED` and using plain `FOR UPDATE`: now workers *queue up*
behind each other on the same hot row instead of fanning out, and throughput collapses to
single-worker speed under load — the opposite of what you deployed ten workers for.

### 6.3 Deadlocks are almost always inconsistent lock ordering
→ Curriculum 3.2

**The myth.** Deadlocks are random, mysterious, and mostly unavoidable.

**The reality.** A deadlock is two transactions acquiring the **same locks in opposite
order**: A locks row 1 then wants row 2; B locks row 2 then wants row 1. Postgres detects the
cycle and kills one (`40P01`). The cause is almost always avoidable: lock in a **consistent
order** everywhere.

**Real life.** A "transfer money from account X to account Y" function locks X then Y. When
one request transfers X→Y and a simultaneous one transfers Y→X, they deadlock. Fix: always
lock accounts in a fixed order (e.g. ascending by id) regardless of transfer direction, so
both requests grab the lower id first and one simply waits.

**The trap.** "Fixing" deadlocks purely with retry loops. Retries are necessary (you can
never make deadlocks *impossible* in a concurrent system), but if you're deadlocking
*frequently*, the real bug is lock ordering, and retrying just burns CPU papering over it.

---

## 7. Transactions & Isolation

### 7.1 An idle-in-transaction connection is a slow-motion outage
→ Curriculum 4.7, 5.4

**The myth.** An open transaction that isn't doing anything is harmless — it's idle.

**The reality.** A transaction left open (`BEGIN` with no `COMMIT`/`ROLLBACK`) holds any
locks it took **and** holds back `VACUUM`: Postgres can't reclaim dead row versions newer
than the oldest running transaction's snapshot, because that transaction might still need to
see them. One forgotten transaction can freeze cleanup for the *entire database*.

**Real life.** An app opens a transaction, then makes an external API call that hangs for
minutes while holding the transaction open. Under load, dozens of these pile up, dead tuples
stop being vacuumed database-wide, tables bloat, and performance degrades everywhere — not
just on the table the transaction touched. The classic tell in `pg_stat_activity` is
`state = 'idle in transaction'`.

**The trap.** Doing network I/O (an HTTP call, a message publish, a slow external lookup)
*inside* a database transaction. The master's rule: **transactions should be short and
contain only database work** — never `await` a network call with a transaction open. Set
`idle_in_transaction_session_timeout` as a safety net so a leaked transaction gets killed
instead of slowly strangling the database.

### 7.2 `READ COMMITTED` gives you a fresh snapshot *per statement*, not per transaction
→ Curriculum 3.1

**The myth.** Inside one transaction, you see a consistent view of the database.

**The reality.** At the default `READ COMMITTED`, **each statement** sees a new snapshot of
committed data. So two identical `SELECT`s in the same transaction can return **different
results** if another transaction committed in between. Only `REPEATABLE READ` and
`SERIALIZABLE` freeze the snapshot for the whole transaction.

**Real life.** A report runs several queries in one transaction assuming they all see the
same data. Between query 1 and query 3, a bulk import commits, and the report's totals don't
reconcile with its own line items — an "impossible" inconsistency that only appears under
concurrent writes and is nearly impossible to reproduce in dev. The master uses `REPEATABLE
READ` for any multi-query read that must be self-consistent.

**The trap.** Assuming the isolation *default* matches what a given ORM/framework configures —
some set `REPEATABLE READ` or wrap things differently. Masters know their default and set it
explicitly for anything that depends on it, rather than inheriting a surprise.

### 7.3 Every `SAVEPOINT` and PL/pgSQL `EXCEPTION` block is a subtransaction — and they're not free
→ Curriculum 2.11, 3.6

**The myth.** `SAVEPOINT` (and its ORM cousin, the nested transaction) and PL/pgSQL
`BEGIN ... EXCEPTION WHEN ... END` blocks are lightweight — just error handling.

**The reality.** Each one opens a **subtransaction** with its own transaction id (subxid).
This is cheap in isolation and *pathological in bulk*. Two distinct costs bite: (1) a
subtransaction consumes an XID, so a loop that opens one per row burns XIDs fast; (2) once a
single transaction holds **more than 64** subtransactions, the per-backend subxid cache
overflows and other backends must consult the **`pg_subtrans` SLRU** on disk to resolve row
visibility — and that SLRU is a small, contended, cluster-wide resource.

**The numbers.** The magic threshold is **64** subxids per transaction. Cross it under
concurrency and you can trigger *SLRU contention* that slows down **the entire cluster**,
not just the offending transaction — a superlinear cliff, not a gentle slope. A batch job
that wraps each of 100,000 rows in its own `EXCEPTION` block or `SAVEPOINT` is the classic
trigger.

**Real life.** A data-import procedure does `FOR row IN ... LOOP BEGIN INSERT ... EXCEPTION
WHEN unique_violation THEN CONTINUE; END; END LOOP`. It works fine on 100 rows in dev. In
production at scale, throughput collapses and — bafflingly — *unrelated* queries across the
whole database slow down at the same time, because every backend is now hitting the
`pg_subtrans` SLRU under lock. Nothing in the slow queries changed; they're collateral
damage from one procedure's subtransaction storm. This is one of the purest "master knows,
pro is mystified" incidents in Postgres.

**The trap.** "Just add exception handling for robustness" inside a hot loop. The master
handles errors *outside* the row loop where possible (validate up front, or batch-insert
with `ON CONFLICT DO NOTHING` which needs **no** subtransaction), and treats per-row
`EXCEPTION`/`SAVEPOINT` as something to avoid at scale, not a free safety wrapper. Watch
`pg_stat_activity` for backends waiting on `SubtransSLRU`/`Subtrans` wait events.

---

## 8. Pagination & Large Result Sets

### 8.1 `OFFSET` gets linearly slower the deeper you page
→ Curriculum 1.3, 4.6

**The myth.** `LIMIT 20 OFFSET 10000` fetches 20 rows, so it's cheap.

**The reality.** `OFFSET n` computes and **discards** the first `n` rows before returning
any. Page 500 does all the work of pages 1–500 and throws away 99.8% of it. Cost grows
linearly with the offset.

**The numbers.** `OFFSET 20` is instant; `OFFSET 1,000,000` reads and discards a million
rows on *every* request. Deep pages of a large table can take seconds each, and they get
slower the further users scroll.

**Real life.** An infinite-scroll feed feels snappy in testing (everyone tests page 1–3) and
crawls in production once real users scroll to page 400 — and those are your most engaged
users, getting the worst experience. The fix is **keyset (seek) pagination**: `WHERE
(created_at, id) < (:last_seen_ts, :last_seen_id) ORDER BY created_at DESC, id DESC LIMIT 20`.
It uses the index to *jump* to the right place — every page costs the same, page 1 or page
10,000.

**The trap.** Keyset pagination needs a **stable, unique** sort key (hence the tie-breaker
`id`); sorting by a non-unique column alone silently skips or duplicates rows at page
boundaries. And it trades away "jump to page 500" (you can only go next/prev) — which for
feeds is a fine trade, but you must know you're making it.

---

## 9. Data Types & Modeling

### 9.1 `timestamp` (without time zone) is a bug waiting to happen; use `timestamptz`
→ Curriculum 0.5, 2.6

**The myth.** `timestamptz` "stores the time zone," so if you don't need zones, plain
`timestamp` is simpler and correct.

**The reality.** Backwards. `timestamp` (without tz) stores a wall-clock reading with **no
zone context** — it's an ambiguous number that means different instants depending on who
reads it. `timestamptz` does **not** store a zone; it stores an unambiguous **instant**
(normalized to UTC) and converts to the session's zone on display. `timestamptz` is the one
that "just works."

**Real life.** You store `timestamp` and your server runs in UTC. Everything's fine until you
deploy a second server in another region, or someone runs a report in a different session
timezone, or daylight-saving shifts — and now "the same" timestamp means two different real
moments, and your "events in the last hour" query is wrong by hours twice a year. With
`timestamptz` none of this happens; the instant is fixed and only its *display* varies.

**The trap.** Thinking the fix is to "just always use UTC everywhere" with plain `timestamp`.
That works only as long as *every* writer and reader remembers, forever, with zero exceptions
— which is not a property real systems have. `timestamptz` makes correctness the default
instead of a discipline everyone must maintain. Store `timestamptz`; convert at the edges.

### 9.2 `varchar(255)` buys you nothing; `text` is the right default
→ Curriculum 0.5

**The myth.** `varchar(n)` is more efficient than `text` and the length limit protects your
data. `varchar(255)` is a sensible default.

**The reality.** In Postgres, `text` and `varchar` have **identical performance and
storage** — same implementation underneath. The `(n)` adds a length *check*, not an
optimization. And `255` is a cargo-culted MySQL number with no meaning in Postgres.

**Real life.** You set `varchar(255)` on `email`, then a valid longer address (or a field you
later reuse) hits the limit and you need an `ALTER TABLE` — historically a table-rewrite risk
under load — to *relax* a constraint that never bought you anything. Meanwhile `text` would
have just worked. The master uses `text` and enforces real limits with a `CHECK` constraint
*when the business actually has one* (and where changing the check is cheap), not a guessed
column width.

**The trap.** Believing a smaller declared length saves space. It doesn't — storage is based
on the actual string length regardless of the declared max. The `(n)` is purely a validation
rule, so only add it when `n` is a genuine domain rule you can defend.

---

## 10. Writes, Batching & the Cost of Modification

### 10.1 One thousand single-row `INSERT`s cost far more than one thousand-row `INSERT`
→ Curriculum 4.6, 5.8

**The myth.** Inserting 1000 rows is 1000 inserts; how you send them barely matters.

**The reality.** Each separate `INSERT` statement is its own round trip, its own transaction
(under autocommit), its own WAL flush, its own planning. Batching them into one multi-row
`INSERT` — or better, `COPY` — collapses all that per-statement overhead.

**The numbers.** `COPY` is routinely **10×–100×** faster than row-by-row `INSERT` for bulk
load. A million rows that take minutes as individual inserts can load in seconds via `COPY`.
Even a naive change from 1M single inserts to batches of 1000 is a dramatic win, mostly by
amortizing transaction commit and network latency.

**Real life.** A nightly import does `for row in file: INSERT ...` and takes 3 hours,
creeping toward the morning traffic window. Switching to `COPY` (or `unnest`-based batch
insert) drops it to minutes. Nothing about the data changed — only the *shape* of how it was
sent. The per-statement tax was the entire cost.

**The trap.** Wrapping a million single inserts in **one giant transaction** to "make it
fast." It helps (one commit instead of a million) but now you hold locks and generate dead
tuples for the whole run, and a failure at row 999,999 rolls back everything. Masters batch
in **chunks** (e.g. 1000–10000 rows per transaction) to balance throughput against lock
duration, rollback granularity, and replication lag.

---

## 11. Connections, Pooling & the Application Boundary

### 11.1 A Postgres connection is a whole OS process, not a cheap socket
→ Curriculum 5.1

**The myth.** Open a connection per request; connections are lightweight like HTTP.

**The reality.** Each Postgres connection is backed by a **dedicated backend process** with
its own memory. Hundreds of connections mean hundreds of processes competing for CPU and RAM,
and each can use up to `work_mem` *per sort/hash node*. Postgres throughput often **peaks at
a surprisingly low connection count** (frequently near the number of CPU cores × a small
factor) and then *degrades* as you add more.

**The numbers.** A box that handles 5000 queries/sec beautifully at 20 connections can
collapse to a fraction of that at 500 connections — same hardware, more contention. This is
why "just raise `max_connections`" usually makes things *worse*.

**Real life.** A serverless app spins up 500 function instances under traffic, each opens its
own connection, and Postgres falls over — not from query load but from connection count.
The answer is a **pooler** (PgBouncer, or the platform's pooled endpoint) in **transaction
mode**, multiplexing thousands of clients onto a few dozen real backends.

**The trap.** Transaction-mode pooling **breaks** anything that assumes session state persists
across statements — session-level `SET`, `LISTEN/NOTIFY`, advisory *session* locks, and
holding a transaction across the pool checkout boundary. (Server-side **prepared statements**
used to be on this list, but PgBouncer ≥ 1.21 supports them in transaction mode via
`max_prepared_statements` — so that specific breakage is now configurable away; verify your
pooler version before relying on it.) The master knows transaction pooling is nearly free
performance *if* the app is written to not rely on session state — and a footgun if it does.

---

## 12. JSONB — Power and Its Price

### 12.1 JSONB is not a schema-design shortcut
→ Curriculum 2.9, 4.3

**The myth.** Store everything in a `jsonb` column and you get schemaless flexibility with no
downside.

**The reality.** JSONB is excellent for genuinely variable/sparse data and document payloads.
But you lose what the relational model gives you: **column statistics** (the planner
estimates poorly inside JSONB), **cheap constraints and foreign keys**, compact typed
storage, and simple indexing. Querying deep into JSONB needs GIN indexes (large, and not a
silver bullet) or expression indexes on specific paths.

**Real life.** A team models `orders` as one `jsonb` blob "to move fast." Six months later
they need "sum revenue by month," "enforce that `customer_id` references a real customer,"
and "index status" — all trivial with columns, all awkward and slow through JSONB. They end
up extracting the same handful of fields into real columns anyway, having paid interest on
the shortcut. The master's rule: model **known, queried, constrained** fields as columns;
reserve JSONB for the genuinely open-ended tail.

**The trap.** Indexing a whole `jsonb` column with GIN and assuming all queries are now fast.
GIN accelerates **containment/existence** (`@>`, `?`) well, but not range or ordering queries
inside the document, and it's large and write-heavy. For "rows where `payload->>'status' =
'x'`" you often want a small **expression index** on that one path, not a giant GIN over
everything.

---

## 13. The Meta-Skill: How Masters Think

These aren't about a feature — they're the postures that generate all of the above.

1. **Measure, never assume.** Every performance belief is a hypothesis until `EXPLAIN
   (ANALYZE, BUFFERS)` confirms it. Masters have been wrong often enough to distrust their
   own intuition and reach for the tool first. The junior guesses; the pro reasons; the
   master reproduces.

2. **Correct-single-user is not correct.** The question that separates levels is always
   *"what happens when two of these run at the same time?"* A query that's right in a test is
   a query that's right for one user. Production is concurrent, and concurrency is where the
   subtle, expensive, intermittent bugs live.

3. **Every write is taxed.** Indexes, MVCC, WAL, replication, and vacuum all levy a toll on
   writes. Masters right-size indexing and denormalization by the *write* cost, not just the
   read benefit — the pro optimizes the `SELECT` and forgets the `INSERT` pays for it.

4. **The planner is a probabilistic guesser fed by statistics.** Bad plans are usually bad
   *estimates*. Before touching the query, masters check whether the planner even knows the
   truth (`ANALYZE`, extended statistics, the estimate-vs-actual gap).

5. **Small numbers hide the future.** Almost every trap here is invisible at 10k rows and
   fatal at 100M: `OFFSET`, `count(*)`, missing indexes, fan-out joins, bloat. Masters test
   and reason at **production scale**, because the behaviors that matter don't appear in dev
   data.

6. **Push work to the database, but know its cost.** The database is extraordinarily good at
   set-based work — do the aggregation, filtering, and joining *there*, not in application
   loops (the N+1 antipattern). But "push it down" is not unconditional: a master knows *why*
   each pushed-down operation is cheap or expensive, rather than treating the database as a
   magic box.

7. **Reversibility is a feature.** Masters favor decisions that are easy to undo (a `text`
   column you can constrain later, an index you can drop) over ones that aren't (a `varchar(n)`
   you must rewrite to relax, an enum you must migrate, a `jsonb`-everything model you must
   unwind). Much of "experience" is just having been trapped by irreversible choices before.

---

## Areas still to be written (second pass)

This volume covers the highest-frequency, highest-cost insight areas. Being honest per the
"nothing omitted" goal: a complete master's-judgment file is effectively a career in text,
and these areas still deserve the same worked-entry treatment. Flagged so they're tracked,
not forgotten:

- **Full-text search vs `ILIKE '%x%'` vs trigram** — when each is right, and why `LIKE
  '%x'` (leading wildcard) can't use a normal index.
- **Partitioning** — when it genuinely helps (and the common case where it just adds pain);
  partition pruning failures; the "too many partitions" planning-time cost.
- **Window functions** — the `LAST_VALUE` frame gotcha (default frame is `RANGE ... CURRENT
  ROW`, so `LAST_VALUE` returns the current row, not the partition's last); `ROWS` vs `RANGE`.
- **CTE materialization** — the pre-12 optimization fence and when `MATERIALIZED` /
  `NOT MATERIALIZED` changes plans dramatically.
- **Foreign key overhead** — the write-time cost of FK checks and the locking they take on
  the referenced row.
- **`ON CONFLICT` subtleties** — needing an actual unique constraint/index to target, and
  the `EXCLUDED` semantics.
- **Sequence gaps** — why IDs skip after rollbacks/crashes and why "gapless numbering"
  (invoices) is a genuinely hard concurrency problem, not a bug to fix casually.
- **Migrations under load** — which `ALTER TABLE` forms take `ACCESS EXCLUSIVE` locks and
  block all traffic; `CREATE INDEX CONCURRENTLY`; the expand/contract pattern. Sharper scar
  to name in the entry: a *waiting* `ALTER TABLE` queued behind one long-running `SELECT`
  blocks **all new queries** on the table — the lock-queue effect behind most "instant in
  staging" migration outages. Also: `lock_timeout` + retry as the mitigation.
- **`work_mem` is per-node, not per-query** — a complex query with many sorts/hashes can use
  many multiples of `work_mem` simultaneously, times every connection. Note `hash_mem_multiplier`
  (default 2.0 since PG15) applies an extra factor to hash nodes.
- **`random_page_cost` on SSDs** — the default (4.0) assumes spinning disks; lowering it
  toward ~1.1 changes index-vs-seqscan decisions across the whole database.
- **TOAST** — large values stored out-of-line, and how that changes the cost of `SELECT *`
  vs selecting only the columns you need; a 100KB `jsonb` document is fully **detoasted per
  access** even to read one key (connects to entry 12.1).
- **`ORDER BY … LIMIT` pathological plan** — the planner walks the sort-key index expecting
  an early match; when the filter almost never matches, `LIMIT 1` can take minutes scanning
  the index. A perfect "numbers" story.
- **JIT compilation spikes** — an analytics-tuned `jit=on` can add hundreds of ms of compile
  time to a *single* OLTP query ("the same query is sometimes 100× slower"); when to disable.
- **`BETWEEN` on timestamps is inclusive on both ends** — the off-by-one-row report bug;
  prefer half-open `>= start AND < end` for time ranges.
- **`OFFSET` page drift under concurrent writes** — even when fast, offset pages skip or
  duplicate rows when inserts land between page loads (a *correctness* reason for keyset,
  extending entry 8.1 beyond speed).
- **Client/server timeout mismatch** — client gives up but the server keeps burning the
  query; `statement_timeout` vs application timeout, and query-cancellation semantics.
- **Batch `ON CONFLICT` "cannot affect row a second time"** — one statement hitting the same
  conflict key twice errors; deduplicate the input first.
- **Prefix `LIKE` under non-C collations** — `col LIKE 'foo%'` won't use a normal index
  unless the index uses `text_pattern_ops` or the column/DB uses `COLLATE "C"` (connects to
  the trigram material in Curriculum 3.5).
- **Collation-change index breakage** — an OS/ICU/glibc upgrade can change string sort order
  and silently *corrupt* text B-tree indexes; reindex after collation-library upgrades.

*Deliberately scoped OUT (documented, not omitted):* replication setup, backup/HA, and
DBA operations. The one gray-area call: **read-replica lag / read-your-writes** in
application read paths is arguably backend query craft — flagged for a possible Tier 5
curriculum unit rather than a mastery-insight entry.

---

*Maintenance note: as each second-pass area is written, promote it into a numbered section
above and cross-link it from [[CURRICULUM.md]]. Every entry must keep the five-part shape
(myth → reality → numbers → real life → the trap) — that shape is the product.*
