# Database Design — How to Think About Schemas From Scratch

> **What this file is.** [[CURRICULUM.md]] teaches you to *query* a database. This file
> teaches you to *design* one — the thinking that happens **before** a single query exists.
> The goal is not to memorize one schema; it's to internalize a **repeatable method** you
> can point at any domain — a bank, a hospital, a game, a social network — and produce a
> sound schema, at any scale.
>
> **Two halves:**
> 1. **The Method** (§1–§9) — a step-by-step process for going from "we're building X" to a
>    concrete set of tables, columns, types, keys, and indexes, with the *reasoning* at each
>    step. This is the transferable skill.
> 2. **The Teardown** (§10) — the method applied end-to-end to a real system: **Instagram**.
>    Every table, and the *why* behind every column and index, including the hard problems
>    (the feed, the follow graph, counters at scale, the celebrity problem).
>
> **Pinned to PostgreSQL 18.** Type and feature choices assume PG 18.
>
> **How the app uses this.** DESIGN is taught **first**, before query-writing — you can't
> write good queries against a bad schema. Each step becomes a lesson with a design exercise
> ("here's a domain, produce the entities / pick the types / choose the indexes"), and the
> Instagram teardown is the worked answer key the learner is measured against.

---

## Table of Contents

- [The one idea to hold onto](#the-one-idea-to-hold-onto)
- [§1. Start with the questions, not the tables](#1-start-with-the-questions-not-the-tables)
- [§2. Find the entities (nouns) and their relationships](#2-find-the-entities-nouns-and-their-relationships)
- [§3. Model the relationships (1:1, 1:N, M:N)](#3-model-the-relationships-11-1n-mn)
- [§4. Normalize — then know when to stop](#4-normalize--then-know-when-to-stop)
- [§5. Choose the columns — and defend every one](#5-choose-the-columns--and-defend-every-one)
- [§6. Choose the type for each column — and why](#6-choose-the-type-for-each-column--and-why)
- [§7. Choose keys — primary and foreign](#7-choose-keys--primary-and-foreign)
- [§8. Add constraints — push correctness into the schema](#8-add-constraints--push-correctness-into-the-schema)
- [§9. Design the indexes — from the queries, never guessed](#9-design-the-indexes--from-the-queries-never-guessed)
- [§10. Full teardown: Instagram](#10-full-teardown-instagram)
- [§11. The design review checklist](#11-the-design-review-checklist)
- [§12. The same method on other domains](#12-the-same-method-on-other-domains)

---

## The one idea to hold onto

**A schema is a set of promises about your data, enforced by the database instead of by
hope.** Every decision — a type, a `NOT NULL`, a foreign key, a unique constraint — is you
deciding *what must always be true* and making the database refuse anything else. Bad
schemas push those promises up into application code (where every developer must remember
them, forever, and one won't); good schemas encode them once, at the bottom, where they
cannot be bypassed.

Design is therefore not "drawing boxes." It's answering, for every piece of data: **What is
this? What must always be true about it? How will it be read and written? What happens when
there are a billion of them?** The method below is just a disciplined way to ask those four
questions in the right order.

---

## §1. Start with the questions, not the tables

**The mistake beginners make:** open a blank file and start typing `CREATE TABLE users`.
You're designing storage before you know what you're storing *for*.

**The method:** write down the **access patterns** first — the questions the application will
ask the database, and the writes it will make. The schema exists to serve these; a table
nobody queries a certain way doesn't need to be shaped for that way.

**Do this concretely.** For the product you're building, list:
- **Reads:** "Show a user's profile." "Show the 20 most recent posts from people they
  follow." "Count a post's likes." "Search posts by hashtag." Each read tells you what must
  be *fast* and what you'll *join*.
- **Writes:** "Create a post." "Like a post." "Follow someone." Each write tells you what
  must be *consistent* and where contention will happen.
- **Volume & shape:** "10M users, each following ~200 others, some celebrities followed by
  100M." Scale changes design — a table with a thousand rows and a table with a billion rows
  are *different design problems* even for the same entity.

**Why this comes first:** indexes, denormalization, and partitioning are all answers to
*specific* access patterns. You literally cannot choose them correctly without the list. The
access patterns are the spec; the schema is the implementation.

> **Real-life framing.** When engineers say "we designed the schema around the feed," they
> mean the single most important read — "give me my feed" — dictated the shape of several
> tables. The dominant query earns the right to distort the schema in its favor.

---

## §2. Find the entities (nouns) and their relationships

**The method:** from the access patterns and a plain-English description of the product,
extract the **nouns**. Nouns that have identity and a lifecycle become **entities** (tables):
*user, post, comment, photo, follow*. Nouns that merely describe another noun become
**attributes** (columns): a user's *email*, a post's *caption*.

**How to tell an entity from an attribute:**
- Does it have its own identity you'd refer to elsewhere? (A `comment` is referenced by
  likes and replies → entity. A `caption` is not referenced by anything → attribute.)
- Are there *many* of them per parent? (One user has *many* posts → `post` is its own entity
  with a `user_id`, not a column on `users`.)
- Does it have its own attributes? (A `payment` has amount, method, status, timestamp →
  entity, not just an `amount` column on `orders`.)

**Verbs become relationships.** "A user *follows* a user." "A user *likes* a post." "A post
*belongs to* a user." Each verb is an edge between entities, and each edge will become either
a foreign key or a join table (§3).

**Why this works:** it's a mechanical translation from how humans describe the domain into
how a relational database represents it. The domain expert's sentences already contain the
schema; you're just transcribing them.

---

## §3. Model the relationships (1:1, 1:N, M:N)

Every relationship between two entities is one of three shapes. Getting the shape right is
most of relational design.

### One-to-many (1:N) — the workhorse
One user has many posts; one post has many comments. **The "many" side holds the foreign
key.** `posts.user_id → users.id`. You never put a list of post-ids on the user row — that's
the array-in-a-column smell, and it can't be indexed, constrained, or joined efficiently.

**Why the FK goes on the many side:** a column holds one value. The side that has *one*
parent can hold one FK; the side that has *many* children cannot hold many FKs in one column.

### Many-to-many (M:N) — needs a join table
A user follows many users; a user is followed by many users. A post has many hashtags; a
hashtag tags many posts. **You cannot represent M:N with a column on either side** — you
create a third table (a **join / junction table**) whose rows are the *pairs*:
`follows(follower_id, followee_id)`, `post_hashtags(post_id, hashtag_id)`.

**The join table is a first-class citizen.** It often has its own attributes (a `follows`
row can carry `created_at`; an `order_items` row carries `quantity` and `price`) and its own
primary key — usually the composite `(a_id, b_id)`, which also enforces "you can't follow
someone twice."

### One-to-one (1:1) — rarer, and usually a smell
When you're tempted by 1:1, ask "why isn't this just more columns on the same table?" Valid
reasons to split: (a) **optional heavy data** you rarely read (a `user_profiles` row with a
big bio/avatar you don't need on every user lookup), (b) **different access control** (PII in
a separate table), (c) **different write frequency** (a hot counter split off from cold
profile data to avoid bloating the main row — see §10 counters). Absent a reason, keep it in
one table; a gratuitous 1:1 just adds a join to every query.

> **The test for every relationship:** can one side have *more than one* of the other? If
> yes in *both* directions → M:N join table. If yes in one direction → FK on the many side.
> If no in both → same table (or a justified 1:1).

---

## §4. Normalize — then know when to stop

**Normalization** is the discipline of storing each fact **exactly once**, so it can never
disagree with itself. The rule of thumb that gets you 95% there:

> **Every non-key column depends on the key, the whole key, and nothing but the key.**

Practically, that means: **don't store derived or duplicated data.** If `users.city` and
`users.country` both live on the user, fine — they describe the user. But if you copy the
user's name onto every `post` row "to avoid a join," you've created a lie waiting to happen:
the user renames themselves and now a million posts show the old name. Store the name once
on `users`; join to get it.

**The classic violations to recognize:**
- **Repeating groups** — `phone1, phone2, phone3` columns → should be a `phones` child table
  (1:N). You can't query "who has this phone number" across three columns.
- **A column that depends on another non-key column** — storing both `zip` and `city` where
  `zip` determines `city`; the city is redundant and can drift.
- **A comma-separated list in one column** — `tags = 'sql,postgres,db'`. Unqueryable,
  unconstrainable. That's an M:N begging for a join table (§3).

**Then know when to STOP.** Normalization optimizes for *write consistency*; it costs *read
joins*. At scale, some reads are so hot that joining is too expensive, and you deliberately
**denormalize** — store a redundant copy — and take on the *obligation to keep it in sync*
(via triggers, application logic, or accepting eventual consistency). This is a **conscious
trade**, not laziness:

- A **`like_count` on the post row** duplicates `COUNT(*)` from the likes table — because
  counting a celebrity post's 4 million likes on every page view is untenable (see §10).
- A **feed table** duplicates post references per follower — because generating the feed by
  joining at read time doesn't scale (see §10).

**The master's rule:** *normalize until it hurts, then denormalize until it works* — and
every denormalization must name the query that forced it and the mechanism that keeps the
copy honest. A denormalized value with no sync mechanism is just a bug you haven't hit yet.

---

## §5. Choose the columns — and defend every one

For **each column**, you must be able to answer: *what is this, and what must be true about
it?* Walk this checklist per column:

1. **What does it mean, in one sentence?** If you can't say it crisply, you don't understand
   the data yet. ("`status` is the current state of the order in its fulfillment lifecycle.")
2. **Can it be absent?** This decides `NULL` vs `NOT NULL`. `NULL` must mean *genuinely
   unknown / not-applicable*, never "zero" or "empty" or "false." If "not set" should behave
   like a value, use a `DEFAULT` and `NOT NULL` instead. (A nullable boolean has *three*
   states — usually a design mistake.)
3. **Is it a fact about *this* entity?** If it's really a fact about a related entity, it
   belongs on that entity's table (§4). A `post` row should not carry the author's follower
   count.
4. **Is it raw or derived?** Derived values (age from birthdate, total from line items) are
   normally *computed*, not *stored* — unless performance forces you to store them (then §4's
   sync obligation applies, or use a `GENERATED` column so the database maintains it).
5. **What's its domain of valid values?** This becomes a `CHECK`, an enum, or a FK. ("rating
   is 1–5" → `CHECK (rating BETWEEN 1 AND 5)`.)
6. **Will you filter, sort, or join on it?** That flags it as an index candidate later (§9) —
   but note it now.

> **The discipline:** a column you cannot defend on these six points is either missing a
> constraint, in the wrong table, or shouldn't exist. Junk columns ("we might need it") are
> future confusion and dead weight — add columns when a real access pattern needs them.

---

## §6. Choose the type for each column — and why

The type is the *first and cheapest* constraint. A wrong type is a bug source and a
migration you'll regret. Reason it out, don't default to `text` for everything.

### Identity / keys
- **`bigint` identity (`GENERATED ALWAYS AS IDENTITY`)** for primary keys by default. Not
  `int` — `int` caps at ~2.1 billion and *real systems hit it* (§10 has the war story). Not
  `serial` — identity is the modern standard.
- **UUID** when you need to generate ids *outside* the database (clients, multiple services,
  offline) or hide sequential counts. Use **`uuidv7()`** (PG18) not `uuidv4()` — v7 is
  timestamp-ordered, so it preserves the B-tree insert locality that random v4 destroys.
  Cost: 16 bytes vs 8, and worse cache behavior than bigint even with v7. Choose deliberately.

### Numbers
- **Money → `numeric(precision, scale)`, never `float`.** `float` can't represent `0.10`
  exactly; a ledger built on it drifts by cents. `numeric(12,2)` is exact.
- **Counts / quantities → `int` or `bigint`** depending on the ceiling (likes on a viral post
  can exceed 2.1B → `bigint`).
- **Measurements where tiny error is fine → `double precision`** (a distance, a score).

### Text
- **`text` by default** — in Postgres it's identical in storage/performance to `varchar`.
  Don't cargo-cult `varchar(255)`; the number is meaningless here and only creates a future
  migration to *relax* it.
- Add a length **`CHECK`** only when there's a *real* business rule ("SMS body ≤ 160").
- **`citext`** for case-insensitive uniqueness (emails, usernames) so `Ada@x.com` and
  `ada@x.com` collide.

### Time
- **`timestamptz`, essentially always** — it stores an unambiguous instant. Plain `timestamp`
  stores a zone-less wall-clock reading that means different moments to different readers;
  it's a latent bug that surfaces on your second server or at a DST boundary. Store
  `timestamptz`, convert to the user's zone at the edge.
- **`date`** for a calendar day with no time (a birthday). **`interval`** for durations.

### Categorical (a small fixed set of values)
- Options: a **`text` column + `CHECK IN (...)`**, a **lookup table + FK**, or a Postgres
  **`enum`**. Trade-off: `CHECK` is simplest but changing the allowed set is a schema change;
  a lookup table is the most flexible and lets you attach attributes to each value; `enum` is
  compact and type-safe but *painful to reorder/remove* values. Default to a **lookup table +
  FK** when the set might grow or carry metadata; `CHECK` for a truly fixed tiny set
  (`'active'|'inactive'`).

### Structured / variable data
- **`jsonb`** for genuinely variable, sparse, or document-shaped data (per-item attributes
  that differ by category, a webhook payload). **Not** as a lazy substitute for columns:
  fields you filter, sort, constrain, or join on should be real columns — JSONB loses column
  statistics, cheap constraints, and simple indexing (§10 discusses where Instagram would and
  wouldn't use it).
- **Arrays** for a small ordered list that belongs wholly to one row and you don't need to
  join to (a photo's `tagged_user_ids` *can* be an array, but if you need "photos this user
  is tagged in," that's an M:N join table instead).

> **The type is a decision, not a default.** For every column, the type should be the
> *tightest* one that admits all valid values and rejects invalid ones. Tight types catch
> bugs at write time instead of corrupting data silently.

---

## §7. Choose keys — primary and foreign

### Primary key
Every table gets one. It's the row's identity — stable, unique, never reused.

- **Prefer a surrogate key** (a `bigint`/UUID with no business meaning) over a **natural key**
  (email, SSN, username) *as the primary key*. Natural keys change (people change emails,
  countries rename), and when a PK changes, every foreign key referencing it must cascade —
  pain. The surrogate is immutable by construction.
- **Still enforce the natural key** with a separate `UNIQUE` constraint (unique email) — you
  want both: a stable internal id *and* the real-world uniqueness rule.
- **Composite primary keys** are right for join tables: `follows(follower_id, followee_id)`
  as the PK both identifies the row and enforces "no duplicate follow" in one stroke.

### Foreign keys
An FK is a promise: "this value points at a real row over there." Declare them.

- **They prevent orphans** — you can't insert a `post` for a `user_id` that doesn't exist,
  can't delete a user who still has posts (unless you say what should happen).
- **Choose the referential action deliberately:** `ON DELETE CASCADE` (delete a user →
  delete their posts — right for owned data), `ON DELETE SET NULL` (delete a category →
  products become uncategorized), `ON DELETE RESTRICT` (refuse to delete a user with orders —
  right for financial records you must retain). *Picking this wrong is a data-loss bug.*
- **The cost:** FKs check on write and take a lock on the referenced row. At extreme scale
  some systems drop them and enforce integrity in the application — a real trade (you gain
  write throughput, you lose the guarantee). Know you're making it; don't drop them by
  default.

---

## §8. Add constraints — push correctness into the schema

This is where good designers separate from average ones: **encode every invariant you can as
a constraint**, so violating it is *impossible*, not merely *discouraged*.

- **`NOT NULL`** — the most under-used constraint. Every column that must have a value should
  say so. A nullable column is a promise that "absent" is meaningful; if it isn't, forbid it.
- **`UNIQUE`** — every real-world uniqueness rule (one email per user, one review per
  user-per-product, one follow per pair). Note `UNIQUE NULLS NOT DISTINCT` (PG15) if multiple
  NULLs should also be disallowed.
- **`CHECK`** — value domains (`rating BETWEEN 1 AND 5`, `amount <> 0`, `stock >= 0`,
  `status IN (...)`). Cheap, always-on, and documents intent.
- **`FOREIGN KEY`** — referential integrity (§7).
- **`EXCLUDE`** — the exotic one worth knowing: "no two bookings for the same room overlap"
  (`EXCLUDE USING gist (room_id WITH =, during WITH &&)`). Enforces a *relationship between
  rows* that no per-row constraint can.
- **`GENERATED ALWAYS AS (...)`** — for derived columns you want the database to compute and
  keep correct (a `full_name`, a normalized search column), removing the sync burden from
  §4.

> **Why this matters more than it seems:** application code has bugs, gets bypassed by
> scripts, migrations, and other services. A constraint in the schema is the *last line* that
> holds when everything above it fails. The cost of a `CHECK` is nearly zero; the cost of
> discovering corrupt data six months later is enormous.

---

## §9. Design the indexes — from the queries, never guessed

**Indexes are not part of modeling — they're a response to access patterns (§1).** You design
them *after* the tables, by walking your list of reads and asking, for each: *what would make
this fast?*

**The method, per query:**
1. **What's in the `WHERE`?** Equality columns are prime index candidates. `WHERE user_id =
   ? AND created_at > ?` wants an index on `(user_id, created_at)` — **equality column first,
   range column second** (§ the leftmost-prefix reasoning in [[MASTERY-INSIGHTS.md]] 1.3).
2. **What's in the `ORDER BY` / `LIMIT`?** An index in the sort order lets Postgres return
   top-N without sorting the whole set. Feed queries (`ORDER BY created_at DESC LIMIT 20`)
   live or die on this.
3. **What's in the `JOIN`?** FK columns you join on should usually be indexed (Postgres does
   *not* auto-index FK columns — a classic omission that makes deletes and joins slow).
4. **Is the filter *selective*?** An index only helps if it eliminates most rows. Indexing a
   boolean that's 95% `true` is near-useless for finding `true` — but a **partial index**
   `WHERE is_deleted = false` is excellent for the common "not deleted" filter.
5. **Can it be covering?** If a query needs only a few columns, `INCLUDE` them so the index
   answers the query without touching the table (an *index-only scan*).

**Match the index type to the data:**
- **B-tree** — the default; equality, ranges, sorting, uniqueness. 99% of indexes.
- **GIN** — "is this value *inside* this container": JSONB containment, array membership,
  full-text search. (Post hashtags, JSONB attributes.)
- **GiST** — ranges, geometry, nearest-neighbor, the `EXCLUDE` no-overlap constraint.
- **BRIN** — huge, naturally-ordered append-only tables (an events log by time); tiny index,
  great when data is physically clustered by the indexed column.

**The discipline going the other way:** every index taxes every write (more to update, more
WAL, more bloat, slower `VACUUM`). So **the fewest indexes that serve your real queries** —
not one per column "just in case." Periodically hunt unused ones (`pg_stat_user_indexes
.idx_scan = 0`) and drop them.

> **The mantra:** *index the queries you run, not the columns you have.* An index with no
> query behind it is pure cost.

---

## §10. Full teardown: Instagram

Now the method applied end-to-end to a real, hard system. Photo-sharing social network. We'll
build it table by table, and for each, justify **why it exists**, **why each column and its
type**, and **why each index** — then tackle the three problems that make this domain famous:
the **feed**, the **follow graph**, and **counters at scale**.

*(Access patterns first, per §1. The dominant reads: (a) show a user's profile + their posts;
(b) show a user's home feed — recent posts from everyone they follow; (c) show a post with
its like count and comments; (d) find posts by hashtag. The dominant writes: create a post,
like/unlike, follow/unfollow, comment. Scale: ~2 billion users, power-law follow graph —
most users follow a few hundred, a handful of celebrities are followed by 100M+.)*

### 10.1 `users` — the account
**Why it exists:** the root entity; almost everything references it.

| Column          | Type          | Why this column, this type                                                    |
|-----------------|---------------|-------------------------------------------------------------------------------|
| `id`            | `bigint` PK   | Surrogate, immutable identity (§7). `bigint` not `int` — 2B+ users blows past `int`'s 2.1B ceiling. |
| `username`      | `citext`      | The public handle. `citext` + `UNIQUE` so `Ada`/`ada` can't both exist. Natural key, but *not* the PK (users can change it). |
| `email`         | `citext`      | `UNIQUE`, `NOT NULL`. Login + recovery. Case-insensitive.                     |
| `password_hash` | `text`        | Hash only, never the password. `text` — length varies by algorithm.           |
| `full_name`     | `text`        | Display name. Nullable — not everyone sets one.                               |
| `bio`           | `text`        | Free text. Nullable.                                                          |
| `is_private`    | `boolean`     | `NOT NULL DEFAULT false`. Drives whether followers must be approved.           |
| `created_at`    | `timestamptz` | Signup instant. `timestamptz` (§6) — accounts span every timezone.            |

**Indexes:** `UNIQUE(username)`, `UNIQUE(email)` (both enforce rules *and* speed up login/
lookup). PK is auto-indexed. That's it — you look users up by id, username, or email, and
nothing else here is a hot filter.

**Design note — the 1:1 split.** Heavy, rarely-read profile data (a long bio, settings blob,
avatar metadata) could split into a `user_profiles(user_id PK/FK, ...)` table (§3) so the hot
`users` row stays skinny and cache-friendly. Whether to split is a *read-frequency* decision.

### 10.2 `posts` — a shared photo/video
**Why it exists:** the core content entity; 1:N from users (`§3` — FK on the many side).

| Column          | Type          | Why                                                                    |
|-----------------|---------------|-----------------------------------------------------------------------|
| `id`            | `bigint` PK   | Immutable id. At Instagram's rate, `bigint` is mandatory.             |
| `user_id`       | `bigint` FK   | → `users.id`. The author. **Indexed** — "show a user's posts" is a top query. |
| `caption`       | `text`        | Nullable — photos can have no caption.                                |
| `location_id`   | `bigint` FK   | → `locations.id`, nullable. Optional geotag.                          |
| `created_at`    | `timestamptz` | Post time. **Part of every feed/profile query's `ORDER BY`.**         |
| `like_count`    | `bigint`      | **Denormalized counter** (§4, §10.8). `bigint` — viral posts exceed 2.1B is unlikely but headroom is cheap; realistically `int` is fine, the point is it's *stored*, not counted live. |
| `comment_count` | `int`         | Same rationale.                                                        |

**Why `media` is separate (10.3):** a post can have *multiple* photos/videos (a carousel) →
1:N, so media is its own table, not columns on `posts`. This is §2's "many per parent → own
entity" applied.

**Indexes:** `(user_id, created_at DESC)` — serves "this user's posts newest-first" with no
sort (§9 rules 1+2). PK auto-indexed.

### 10.3 `media` — the actual files (1:N from posts)
| Column       | Type        | Why                                                                 |
|--------------|-------------|---------------------------------------------------------------------|
| `id`         | `bigint` PK | —                                                                   |
| `post_id`    | `bigint` FK | → `posts.id`. **Indexed** (fetch a post's media).                   |
| `url`        | `text`      | Points at object storage (S3/CDN). **The DB stores the *pointer*, not the bytes** — binary blobs belong in object storage; the DB holds metadata. |
| `media_type` | `text`      | `CHECK IN ('image','video')`.                                       |
| `position`   | `smallint`  | Order within a carousel. `NOT NULL` — display order is a fact.      |
| `width`,`height` | `int`   | Dimensions for layout without downloading the file.                 |

**Design lesson:** *don't store large binaries in Postgres.* The row holds a URL and
metadata; the CDN holds the pixels. This keeps rows small, backups sane, and reads cheap.

### 10.4 `follows` — the social graph (M:N join table)
**Why it exists:** "user follows user" is M:N (§3) → a join table whose rows are directed
edges.

| Column         | Type          | Why                                                                        |
|----------------|---------------|----------------------------------------------------------------------------|
| `follower_id`  | `bigint` FK   | → `users.id`. The one doing the following.                                 |
| `followee_id`  | `bigint` FK   | → `users.id`. The one being followed.                                      |
| `created_at`   | `timestamptz` | When the follow happened (the join table carries its own attribute).       |
| **PK**         |               | **Composite `(follower_id, followee_id)`** — identifies the edge *and* enforces "can't follow twice." |

**The two indexes that define the whole feature:**
- The PK index on `(follower_id, followee_id)` answers **"who does X follow?"** (my feed
  sources) — leading column `follower_id`.
- A **second index on `(followee_id, follower_id)`** answers **"who follows X?"** (X's
  follower list, X's follower count). *You need both directions*, and one composite index
  can't serve both leading columns (§ leftmost-prefix). This is the canonical "a graph edge
  needs two indexes, one per direction" lesson.

**Why `is_private` interacts here:** for private accounts a follow may be *pending approval*
— add a `status` (`'accepted'|'pending'`) column, and the feed query filters on it.

### 10.5 `likes` — M:N (user likes post)
| Column      | Type          | Why                                                                    |
|-------------|---------------|-----------------------------------------------------------------------|
| `user_id`   | `bigint` FK   | → `users.id`.                                                         |
| `post_id`   | `bigint` FK   | → `posts.id`.                                                         |
| `created_at`| `timestamptz` | When liked.                                                          |
| **PK**      |               | Composite `(user_id, post_id)` — enforces "can't like twice," the whole business rule of a like. |

**Index:** a second index on `(post_id, user_id)` or just `(post_id)` to answer "who liked
this post" and to *compute* like counts during backfills. The **live** count is *not* read
from here per page view — see §10.8.

### 10.6 `comments` — 1:N from posts, self-referencing for replies
| Column       | Type          | Why                                                                     |
|--------------|---------------|-------------------------------------------------------------------------|
| `id`         | `bigint` PK   | Comments are referenced (by replies, likes) → they need identity.        |
| `post_id`    | `bigint` FK   | → `posts.id`. **Indexed** (`(post_id, created_at)`).                     |
| `user_id`    | `bigint` FK   | → `users.id`. Author.                                                    |
| `parent_id`  | `bigint` FK   | → `comments.id`, nullable. **Self-reference** for threaded replies (the recursive-CTE case). |
| `body`       | `text`        | `NOT NULL` — an empty comment is meaningless.                            |
| `created_at` | `timestamptz` | Ordering.                                                               |

**Design lesson:** the self-referencing `parent_id` is exactly §3's hierarchy pattern; "load
a comment thread" is a recursive CTE with a `CYCLE` guard (you never want a reply loop to
hang the query).

### 10.7 `hashtags` + `post_hashtags` — M:N with a lookup table
- **`hashtags(id, tag citext UNIQUE)`** — each distinct tag stored **once** (§4 normalization;
  the tag text is a fact that shouldn't be duplicated across millions of posts).
- **`post_hashtags(post_id, hashtag_id)`** — the M:N join, PK `(hashtag_id, post_id)` so the
  leading column serves the dominant query **"recent posts for this hashtag"** (index order:
  hashtag first, then post/time).

**Why a lookup table, not a JSONB array of strings on the post:** you must query *across*
posts by tag ("all posts tagged #postgres, newest first"). A per-row array can't serve that
efficiently or keep tag identity consistent. This is §4/§6's "list-in-a-column is an M:N in
disguise" made concrete.

### 10.8 The hard problem #1 — counters at scale (`like_count`)
**The naive design:** compute `SELECT COUNT(*) FROM likes WHERE post_id = ?` on every post
view. **Why it fails:** a celebrity post has *tens of millions* of likes; counting them is a
huge scan, run on *every* page load, for the most-viewed content. `count(*)` cost is real
(the MVCC reason, [[MASTERY-INSIGHTS.md]] 5.2).

**The design response:** a **denormalized `like_count` on `posts`** (§4's conscious
denormalization). Reads are now a single-row lookup. The obligation you take on: keep it in
sync on every like/unlike. Options, each with a trade:
- **Increment in the same transaction** as the like insert — exactly consistent, but every
  like now updates the hot `posts` row, and for a viral post *millions* of concurrent
  increments contend on one row (lock contention + MVCC bloat, §5.1). Doesn't scale for
  celebrities.
- **Sharded counters** — spread the count across N rows (`post_counters(post_id, shard,
  count)`), increment a random shard, sum on read. Removes the single-row hotspot. This is
  how hyperscale "likes" actually work.
- **Async aggregation** — likes go into the table; a background process rolls up counts
  periodically. Eventually consistent, cheapest at write time.

**Why this is the master lesson:** the *modeling* (a like is an M:N row) and the *performance*
(you can't count them live) pull in opposite directions, and the resolution is a deliberate,
named denormalization with an explicit consistency trade. There is no "correct" answer — only
the right trade for your read/write ratio and consistency needs.

### 10.9 The hard problem #2 — the feed (fan-out on write vs read)
**The query:** "show me the 20 newest posts from the ~300 people I follow." Two ways to build
it:

- **Fan-out on read (pull):** at read time, `JOIN follows → posts` for this user, order by
  time, limit 20. **Simple, always fresh, no extra storage.** But for a user following
  thousands, and with posts spread across a giant table, this join+sort is expensive to run
  on *every feed refresh by every user*. It also can't easily merge ranking signals.

- **Fan-out on write (push):** when a user posts, **insert a reference into a `feed_items`
  table for every follower** (`feed_items(user_id, post_id, created_at)`). Reading a feed is
  then a trivial indexed `WHERE user_id = ? ORDER BY created_at DESC LIMIT 20` — blazing fast.
  Cost: a single post by someone with 100M followers means **100M inserts** (the *celebrity
  problem*).

**The real design is a hybrid** (§4 denormalization taken to its logical end):
- Fan-out on **write** for normal users (cheap: a post fans out to a few hundred feed rows).
- Fan-out on **read** for **celebrities** — you *don't* push their posts to 100M feeds;
  instead each user's feed read merges (a) their pre-computed `feed_items` with (b) a live
  pull of the handful of celebrities they follow. Best of both: fast for the common case, no
  write explosion for the pathological case.

**Why `feed_items` is a table at all:** it's a *materialized, denormalized* answer to the
single most important query, accepting storage cost and sync complexity to make the dominant
read O(1)-ish. This is §1's "the dominant query earns the right to distort the schema"
carried through to a whole table that exists only to serve one read.

### 10.10 The hard problem #3 — the follow graph at scale
Two design pressures the `follows` table (§10.4) creates:
- **Both-direction indexes** (already covered) — the edge must be traversable both ways.
- **Skew:** most rows have low-degree endpoints, but celebrity `followee_id`s have 100M rows
  each. Any operation "for all followers of X" is huge for those X. The feed hybrid (§10.9)
  exists precisely to *avoid* ever materializing "all followers of a celebrity" on write.
- **Sharding hint:** at true scale this table is partitioned/sharded (often by `follower_id`
  so "my follows" is local), which is a physical-design concern beyond pure modeling but is
  *driven by* the access pattern — same principle, one level down.

### 10.11 Supporting tables (named, briefly)
- **`stories`** — like posts but with an **expiry** (`expires_at timestamptz`); the design
  addition is a TTL/cleanup pattern (partition by day, drop old partitions — cheap deletion).
- **`direct_messages` / `conversations`** — a messaging sub-schema; `conversations` (M:N of
  users) + `messages` (1:N from conversation). Ordering and read-receipts drive its indexes.
- **`notifications`** — 1:N from users, high write volume, mostly append + mark-read;
  a candidate for partitioning by time and BRIN on `created_at`.
- **`locations`** — lookup table for geotags (normalized once, referenced by posts).

### 10.12 What Instagram's schema teaches, in one paragraph
Almost every table is a direct application of §2–§3 (entities and relationship shapes). The
*interesting* decisions — `like_count`, `feed_items`, the two-direction follow indexes, the
celebrity hybrid — are all §4's normalize-then-denormalize trade, forced by §1's dominant
access patterns and §9's "index the query." The schema is not clever for its own sake; each
denormalization pays for a specific, named, unaffordable query, and takes on a specific,
named consistency obligation in exchange. **That trade — and being able to state both halves
of it out loud — is the whole skill.**

---

## §11. The design review checklist

Run this against any schema (yours or under review) before it ships:

**Entities & relationships**
- [ ] Every entity has a clear one-sentence purpose.
- [ ] Every M:N is a join table (no comma-lists, no arrays-as-relationships).
- [ ] Every 1:1 has a *reason* to be split (else merge it).

**Columns & types**
- [ ] Every column is defensible on §5's six points.
- [ ] Every type is the tightest that fits (money `numeric`, time `timestamptz`, no `varchar(255)` cargo cult).
- [ ] No stored derived data *without* a named sync mechanism.

**Keys & constraints**
- [ ] Surrogate PK; natural keys enforced with `UNIQUE`.
- [ ] Every FK declared, with a *deliberately chosen* `ON DELETE` action.
- [ ] Every real invariant is a `NOT NULL` / `CHECK` / `UNIQUE` / `EXCLUDE`, not just app code.

**Indexes & scale**
- [ ] Every index traces to a real query (§9); no speculative indexes.
- [ ] FK columns you join/filter on are indexed (Postgres won't auto-do it).
- [ ] Graph/edge tables have both-direction indexes.
- [ ] You've asked "what happens at 100×?" for every big table, and named the denormalizations that answer it.

**The final question**
- [ ] Can you state, for each denormalization, *the query it serves* and *how the copy stays honest*? If not, it's a bug in waiting.

---

## §12. The same method on other domains

The proof the method is transferable — the *same* §1–§9 produces very different schemas:

- **Uber (ride-hailing):** entities *rider, driver, trip, payment*. The interesting parts:
  a **trip is a state machine** (`requested→matched→…→completed`), so `trip_events` is an
  append-only 1:N log (never mutate the trip's history — you *record* transitions). Money is
  an **immutable ledger** (append-only `payments`/`entries`, never `UPDATE` a balance —
  §8/§4 taken to the extreme because financial correctness demands it). "Nearby drivers" needs
  **GiST/geospatial** indexing. A person can be *both* rider and driver → model **roles**, not
  duplicate person rows.
- **Airbnb (marketplace + booking):** two-sided (host/guest are *roles* on one `users` table,
  §3's 1:1-smell reasoning). The signature constraint is **no double-booking** — `EXCLUDE
  USING gist` on a `tstzrange` (§8), the same pattern as the bookings table in
  [[DATASET.md]]. Availability calendars and search each distort the schema toward their
  dominant read, exactly as the feed did for Instagram.

Different nouns, different hard problems, **identical method**: questions → entities →
relationships → normalize/denormalize on purpose → tight types → keys → constraints →
indexes-from-queries. Learn the method, not the schema, and you can design any of them.

---

*Maintenance note: as the app builds design lessons, each §1–§9 step is one lesson with a
"design this domain" exercise; §10 is the graded worked example. Keep every denormalization
in §10 paired with its query-served + sync-mechanism, per the house rule — that pairing is
the lesson.*
