# Practice Dataset — Visual Sample & Data Spec

> **What this file is.** The concrete practice dataset the learning app queries against.
> It realizes the abstract "Practice Dataset Requirements" section of [[CURRICULUM.md]].
> For every table you get: (1) a **column dictionary** (name, type, meaning, constraints),
> and (2) a **visible 10-row sample** rendered as a plain markdown table so you can *see*
> the data while you write SQL — no guessing what's in there.
>
> **Pinned to PostgreSQL 18.** Types and features match the pinned instance.
>
> **Design principle: the sample is curated, not random.** The 10 rows shown per table are
> chosen to contain the *edge cases* the lessons depend on — NULLs, duplicates, empty
> collections, boundary timestamps, cyclic-looking hierarchy, JSONB variety. Each "why this
> row exists" note ties a row back to a specific trap in [[MASTERY-INSIGHTS.md]]. When the
> app needs scale (e.g. to make a missing index *visibly* slow), it generates millions more
> rows programmatically from the same schema — but the **visible 10** always include the
> teaching edge cases.
>
> **The domain: a small e-commerce store.** Eight related tables — enough for multi-way
> joins, window functions, recursive hierarchy, JSONB, time-series, and range/booking work.

---

## Table of Contents & Relationships

```
categories ──(self-ref parent_id)──┐
     ▲                             │
     │ category_id                 │
  products ──┐                     
     ▲        │ (JSONB attributes) 
     │ product_id                  
 order_items ──► orders ──► users  
     │             ▲          ▲    
     │             │ user_id  │    
 (qty, price)   payments      reviews ──► products
                              (user_id, product_id)
 inventory ──► products (stock levels, reorder)
 shipments ──► orders   (0..many per order — the fan-out source)
```

**Relationship summary (for join practice):**
- `users` 1—∞ `orders` (a user has many orders; note the *guest* order with NULL user).
- `orders` 1—∞ `order_items` (an order has many line items — the fan-out multiplier).
- `orders` 1—∞ `shipments` (an order can ship in multiple parcels — the *other* fan-out).
- `orders` 1—∞ `payments` (usually one, sometimes split/refunded).
- `products` ∞—1 `categories`; `categories` self-references `parent_id` (the tree).
- `products` 1—∞ `reviews`, `reviews` ∞—1 `users`.
- `products` 1—1 `inventory`.

---

## 1. `users`

**Column dictionary**

| Column        | Type          | Meaning / constraints                                        |
|---------------|---------------|--------------------------------------------------------------|
| `id`          | `bigint`      | PK, identity. `GENERATED ALWAYS AS IDENTITY`.                |
| `email`       | `citext`      | Unique (case-insensitive). Nullable? No — but see row 7.     |
| `full_name`   | `text`        | Display name. Nullable (row 4 never completed profile).      |
| `country`     | `text`        | ISO-ish country name. Correlated with `city` (for `CREATE STATISTICS` lessons). |
| `city`        | `text`        | Correlated with `country`.                                   |
| `status`      | `text`        | `CHECK (status IN ('active','inactive','banned'))`. Skewed: mostly `active`. |
| `created_at`  | `timestamptz` | Signup instant. Spans multiple years/timezones on display.   |
| `preferences` | `jsonb`       | Sparse settings blob; some rows `NULL`, some `{}`.           |

**Visible sample (10 rows)**

| id | email                   | full_name        | country | city      | status   | created_at (UTC)        | preferences                          |
|----|-------------------------|------------------|---------|-----------|----------|-------------------------|--------------------------------------|
| 1  | ada@example.com         | Ada Lovelace     | UK      | London    | active   | 2022-01-05 09:12:00+00  | {"theme":"dark","newsletter":true}   |
| 2  | grace@example.com       | Grace Hopper     | USA     | New York  | active   | 2022-03-18 14:02:00+00  | {"theme":"light"}                    |
| 3  | linus@example.com       | Linus Torvalds   | Finland | Helsinki  | active   | 2022-06-30 23:59:00+00  | {}                                   |
| 4  | anon4@example.com       | *NULL*           | USA     | Austin    | inactive | 2023-02-11 06:45:00+00  | *NULL*                               |
| 5  | margaret@example.com    | Margaret Hamilton| USA     | Boston    | active   | 2023-05-22 11:30:00+00  | {"theme":"dark","beta":true}         |
| 6  | edsger@example.com      | Edsger Dijkstra  | Netherlands | Amsterdam | banned | 2023-08-01 08:00:00+00  | {"newsletter":false}                 |
| 7  | katherine@example.com   | Katherine Johnson| USA     | Newport News | active | 2023-11-19 17:15:00+00 | {"theme":"light","newsletter":true}  |
| 8  | alan@example.com        | Alan Turing      | UK      | London    | active   | 2024-01-02 00:01:00+00  | *NULL*                               |
| 9  | barbara@example.com     | Barbara Liskov   | USA     | New York  | inactive | 2024-04-14 13:20:00+00  | {"theme":"dark"}                     |
| 10 | dennis@example.com      | Dennis Ritchie   | USA     | Murray Hill | active | 2024-09-09 09:09:00+00  | {"newsletter":true}                  |

**Why these rows exist (edge cases):**
- **Row 4** — `full_name` and `preferences` are `NULL` → drives the `COUNT(full_name)` vs
  `COUNT(*)` and `AVG`-ignores-NULL traps ([[MASTERY-INSIGHTS.md]] 3.2).
- **Rows 1, 8 (London/UK) and 2, 9 (New York/USA)** — `city`/`country` correlation → the
  extended-statistics / independence-assumption lesson (2.2).
- **`status` skew** (7 active, 2 inactive, 1 banned) → generic-plan-flip lesson (2.3) and the
  partial-index-on-rare-value lesson (1.2).
- **`created_at`** spans 2022–2024 with a `+00` offset → `timestamptz` display/timezone and
  window/date lessons; row 10's `09:09:00` and row 8's `00:01:00` are deliberate boundary
  values for `date_trunc`/`BETWEEN` questions.
- **`preferences`** mixes `NULL`, `{}`, and populated JSONB → JSONB containment/existence
  and `->>` vs `->` lessons; the NULL-vs-empty-object distinction is itself a trap.

---

## 2. `categories` (self-referencing tree)

**Column dictionary**

| Column       | Type     | Meaning / constraints                                       |
|--------------|----------|------------------------------------------------------------|
| `id`         | `int`    | PK, identity.                                              |
| `name`       | `text`   | Category name.                                            |
| `parent_id`  | `int`    | FK → `categories.id`. `NULL` for top-level roots.         |
| `slug`       | `text`   | Unique URL slug.                                          |

**Visible sample (10 rows)**

| id | name             | parent_id | slug              |
|----|------------------|-----------|-------------------|
| 1  | Electronics      | *NULL*    | electronics       |
| 2  | Computers        | 1         | computers         |
| 3  | Laptops          | 2         | laptops           |
| 4  | Desktops         | 2         | desktops          |
| 5  | Peripherals      | 1         | peripherals       |
| 6  | Keyboards        | 5         | keyboards         |
| 7  | Mice             | 5         | mice              |
| 8  | Books            | *NULL*    | books             |
| 9  | Programming      | 8         | programming       |
| 10 | Databases        | 9         | databases         |

**Why these rows exist:**
- Two **roots** (`Electronics` id 1, `Books` id 8, both `parent_id NULL`) and multiple levels
  (Electronics → Computers → Laptops is 3 deep) → **recursive CTE** lessons (Curriculum 2.2),
  including `SEARCH` ordering and the `CYCLE` guard.
- The tree is **acyclic on purpose**, but the app can inject a cyclic row (e.g. set
  `categories.parent_id = 10` on id 8) to demonstrate the infinite-loop failure and how the
  `CYCLE` clause stops it — that's the whole point of teaching cycle detection.

---

## 3. `products`

**Column dictionary**

| Column        | Type          | Meaning / constraints                                          |
|---------------|---------------|---------------------------------------------------------------|
| `id`          | `bigint`      | PK, identity.                                                 |
| `sku`         | `text`        | Unique stock-keeping unit.                                    |
| `name`        | `text`        | Product name.                                                |
| `category_id` | `int`         | FK → `categories.id`. Nullable (row 9 uncategorized).        |
| `price`       | `numeric(10,2)`| Price. **Never `float`** — money precision lesson (9.x).    |
| `attributes`  | `jsonb`       | Variable per-category attributes (the JSONB-modeling lesson). |
| `created_at`  | `timestamptz` | When listed.                                                 |

**Visible sample (10 rows)**

| id | sku       | name                  | category_id | price   | attributes                                        | created_at (UTC)       |
|----|-----------|-----------------------|-------------|---------|---------------------------------------------------|------------------------|
| 1  | LAP-001   | UltraBook 14          | 3           | 1299.00 | {"ram_gb":16,"cpu":"i7","touch":false}            | 2022-02-01 10:00:00+00 |
| 2  | LAP-002   | UltraBook 14 Pro      | 3           | 1799.00 | {"ram_gb":32,"cpu":"i9","touch":true}             | 2022-02-01 10:05:00+00 |
| 3  | DSK-001   | TowerPro Desktop      | 4           |  999.00 | {"ram_gb":64,"gpu":"RTX4070"}                     | 2022-04-10 12:00:00+00 |
| 4  | KEY-001   | Mechanical Keyboard   | 6           |  120.00 | {"switch":"brown","layout":"US","wireless":true}  | 2022-05-15 09:30:00+00 |
| 5  | KEY-002   | Compact 60% Keyboard  | 6           |   89.99 | {"switch":"red","layout":"US"}                    | 2022-05-15 09:31:00+00 |
| 6  | MOU-001   | Ergonomic Mouse       | 7           |   59.50 | {"dpi":16000,"wireless":true}                     | 2022-07-20 14:00:00+00 |
| 7  | BOK-001   | The C Programming Lang| 9           |   45.00 | {"pages":272,"format":"paperback"}                | 2022-09-01 08:00:00+00 |
| 8  | BOK-002   | PostgreSQL Internals  | 10          |   59.00 | {"pages":540,"format":"ebook","drm":false}        | 2023-01-12 16:00:00+00 |
| 9  | MISC-001  | Mystery Gadget        | *NULL*      |   19.99 | {}                                                | 2023-03-03 03:03:00+00 |
| 10 | LAP-003   | Budget Laptop 13      | 3           |  549.00 | {"ram_gb":8,"cpu":"i3","touch":false,"refurb":true}| 2024-06-01 11:11:00+00 |

**Why these rows exist:**
- **Row 9** — `category_id NULL` (uncategorized) → the `LEFT JOIN` categories + the
  `NOT IN (SELECT category_id ...)` NULL trap ([[MASTERY-INSIGHTS.md]] 3.1, 3.3).
- **`attributes` JSONB** varies by category (laptops have `ram_gb`/`cpu`, books have
  `pages`/`format`) → `JSON_TABLE`, `@>` containment, `->>'ram_gb'` expression-index lessons
  (Curriculum 2.9; MASTERY 12.1). Row 9's `{}` and varied key sets are deliberate.
- **`price` as `numeric`** with cents → the integer-division and float-money traps (3.2 trap).
- **Rows 1 & 2** are near-duplicate product names differing by suffix → `DISTINCT ON`,
  window `ROW_NUMBER` "one per group" practice.

---

## 4. `orders`

**Column dictionary**

| Column        | Type          | Meaning / constraints                                          |
|---------------|---------------|---------------------------------------------------------------|
| `id`          | `bigint`      | PK, identity.                                                 |
| `user_id`     | `bigint`      | FK → `users.id`. **Nullable** — row 5 is a guest order.      |
| `status`      | `text`        | `CHECK IN ('pending','paid','shipped','delivered','cancelled')`. |
| `total`       | `numeric(10,2)`| Order total (denormalized; reconcile-with-items lesson).    |
| `placed_at`   | `timestamptz` | When the order was placed.                                   |
| `shipped_at`  | `timestamptz` | When it shipped — **NULL until shipped** (the ratio lesson). |

**Visible sample (10 rows)**

| id  | user_id | status    | total   | placed_at (UTC)        | shipped_at (UTC)       |
|-----|---------|-----------|---------|------------------------|------------------------|
| 101 | 1       | delivered | 1418.99 | 2023-02-01 10:00:00+00 | 2023-02-02 08:00:00+00 |
| 102 | 1       | delivered |  120.00 | 2023-03-15 12:30:00+00 | 2023-03-16 09:00:00+00 |
| 103 | 2       | shipped   | 1858.00 | 2024-01-10 09:00:00+00 | 2024-01-11 07:30:00+00 |
| 104 | 3       | paid      |  999.00 | 2024-02-20 15:45:00+00 | *NULL*                 |
| 105 | *NULL*  | pending   |   89.99 | 2024-03-01 18:00:00+00 | *NULL*                 |
| 106 | 5       | cancelled |  149.49 | 2024-03-05 08:15:00+00 | *NULL*                 |
| 107 | 7       | delivered |  104.50 | 2024-04-01 11:00:00+00 | 2024-04-03 10:00:00+00 |
| 108 | 1       | paid      |  549.00 | 2024-06-10 20:00:00+00 | *NULL*                 |
| 109 | 9       | delivered |   45.00 | 2024-07-04 07:00:00+00 | 2024-07-05 12:00:00+00 |
| 110 | 2       | shipped   |   59.00 | 2024-09-01 00:30:00+00 | 2024-09-01 23:59:00+00 |

**Why these rows exist:**
- **Row 105** — `user_id NULL` (guest checkout) → *the* re-engagement `NOT IN` incident:
  "customers with no orders" via `NOT IN (SELECT user_id FROM orders)` returns **nothing**
  because of this one NULL ([[MASTERY-INSIGHTS.md]] 3.1). This is the single most important row.
- **`shipped_at` NULL** for pending/paid/cancelled orders → `COUNT(shipped_at) / COUNT(*)`
  integer-division + NULL-skip lesson (3.2), and the `LEFT JOIN`-condition-in-WHERE trap (3.3).
- **User 1 has 3 orders** (101, 102, 108) → `GROUP BY user_id`, window running totals,
  keyset pagination within a user.
- **`status` skew** (many delivered/paid, one cancelled/pending) → filtered aggregates,
  `FILTER (WHERE ...)`, partial indexes.
- **`total` is denormalized** → deliberately set so it *can* be reconciled against
  `order_items` (and where a fan-out join would inflate it — see `order_items` + `shipments`).
- **Boundary timestamps** (110 placed `00:30` shipped `23:59` same day) → `date_trunc`,
  `BETWEEN`-inclusive-upper-bound trap, same-day window questions.

---

## 5. `order_items` (the fan-out multiplier)

**Column dictionary**

| Column       | Type          | Meaning / constraints                                          |
|--------------|---------------|---------------------------------------------------------------|
| `id`         | `bigint`      | PK, identity.                                                 |
| `order_id`   | `bigint`      | FK → `orders.id`.                                             |
| `product_id` | `bigint`      | FK → `products.id`.                                           |
| `quantity`   | `int`         | `CHECK (quantity > 0)`.                                       |
| `unit_price` | `numeric(10,2)`| Price at time of purchase (may differ from current `products.price`). |

**Visible sample (10 rows)**

| id | order_id | product_id | quantity | unit_price |
|----|----------|------------|----------|------------|
| 1  | 101      | 1          | 1        | 1299.00    |
| 2  | 101      | 4          | 1        | 120.00     |
| 3  | 102      | 4          | 1        | 120.00     |
| 4  | 103      | 2          | 1        | 1799.00    |
| 5  | 103      | 6          | 1        | 59.00      |
| 6  | 104      | 3          | 1        | 999.00     |
| 7  | 105      | 5          | 1        | 89.99      |
| 8  | 106      | 4          | 1        | 120.00     |
| 9  | 106      | 6          | 1        | 29.50      |
| 10 | 107      | 6          | 1        | 59.50      |

**Why these rows exist:**
- **Order 101 has 2 items** (rows 1, 2) and (see `shipments`) **3 shipments** → join both to
  `orders` in one flat query and `SUM(orders.total)` is counted `2 × 3 = 6` times — the
  **fan-out / cardinality-inflation** lesson ([[MASTERY-INSIGHTS.md]] 4.1). This is the
  centerpiece of the "revenue reads 10× too high" demo.
- **`unit_price` ≠ current `products.price`** in places (row 5: bought product 6 at 59.00,
  current price 59.50) → why you snapshot price at purchase; join-to-products gotchas.
- **Order 106 (cancelled) still has items** → filtering cancelled orders out of revenue.

---

## 6. `shipments` (the *other* fan-out source)

**Column dictionary**

| Column        | Type          | Meaning / constraints                                       |
|---------------|---------------|-------------------------------------------------------------|
| `id`          | `bigint`      | PK, identity.                                               |
| `order_id`    | `bigint`      | FK → `orders.id`. **0..many per order.**                   |
| `carrier`     | `text`        | Shipping carrier.                                          |
| `tracking_no` | `text`        | Nullable until dispatched.                                 |
| `shipped_at`  | `timestamptz` | Per-parcel dispatch time.                                  |

**Visible sample (10 rows)**

| id | order_id | carrier | tracking_no | shipped_at (UTC)       |
|----|----------|---------|-------------|------------------------|
| 1  | 101      | DHL     | DH1001      | 2023-02-02 08:00:00+00 |
| 2  | 101      | DHL     | DH1002      | 2023-02-02 08:05:00+00 |
| 3  | 102      | UPS     | UP2001      | 2023-03-16 09:00:00+00 |
| 4  | 103      | FedEx   | FX3001      | 2024-01-11 07:30:00+00 |
| 5  | 107      | DHL     | DH1003      | 2024-04-03 10:00:00+00 |
| 6  | 109      | UPS     | *NULL*      | 2024-07-05 12:00:00+00 |
| 7  | 110      | FedEx   | FX3002      | 2024-09-01 23:59:00+00 |
| 8  | 103      | FedEx   | FX3003      | 2024-01-12 06:00:00+00 |
| 9  | 101      | DHL     | *NULL*      | 2023-02-02 08:10:00+00 |
| 10 | 107      | UPS     | UP2002      | 2024-04-03 11:00:00+00 |

**Why these rows exist:**
- **Order 101 has 3 shipments** (rows 1, 2, 9) and 2 order_items → the exact fan-out
  multiplier for the cardinality lesson. **Order 103 has 2 shipments** (rows 4, 8) too.
- **Orders 104, 105, 106, 108 have ZERO shipments** → `LEFT JOIN` producing NULL right-side,
  and the "condition on the outer side in WHERE collapses the join" trap (3.3).
- **`tracking_no` NULL** (rows 6, 9) → NULL handling in `string_agg`, `COUNT`.

---

## 7. `payments`

**Column dictionary**

| Column       | Type          | Meaning / constraints                                        |
|--------------|---------------|--------------------------------------------------------------|
| `id`         | `bigint`      | PK, identity.                                                |
| `order_id`   | `bigint`      | FK → `orders.id`.                                            |
| `amount`     | `numeric(10,2)`| Positive = charge, negative = refund.                      |
| `method`     | `text`        | `CHECK IN ('card','paypal','bank','giftcard')`.             |
| `status`     | `text`        | `CHECK IN ('authorized','captured','refunded','failed')`.   |
| `paid_at`    | `timestamptz` | When processed.                                             |

**Visible sample (10 rows)**

| id | order_id | amount   | method   | status     | paid_at (UTC)          |
|----|----------|----------|----------|------------|------------------------|
| 1  | 101      | 1418.99  | card     | captured   | 2023-02-01 10:01:00+00 |
| 2  | 102      |  120.00  | paypal   | captured   | 2023-03-15 12:31:00+00 |
| 3  | 103      | 1858.00  | card     | captured   | 2024-01-10 09:02:00+00 |
| 4  | 104      |  999.00  | bank     | authorized | 2024-02-20 15:46:00+00 |
| 5  | 105      |   89.99  | card     | failed     | 2024-03-01 18:01:00+00 |
| 6  | 106      |  149.49  | card     | captured   | 2024-03-05 08:16:00+00 |
| 7  | 106      | -149.49  | card     | refunded   | 2024-03-06 10:00:00+00 |
| 8  | 107      |  104.50  | giftcard | captured   | 2024-04-01 11:01:00+00 |
| 9  | 109      |   45.00  | paypal   | captured   | 2024-07-04 07:01:00+00 |
| 10 | 110      |   30.00  | card     | captured   | 2024-09-01 00:31:00+00 |

**Why these rows exist:**
- **Order 106 has a charge (row 6) AND a refund (row 7)** → net-amount `SUM`, `FILTER`,
  and "why `SUM(amount)` per order is not `orders.total`" reconciliation lessons.
- **Order 110 paid 30.00 but total is 59.00** → partial/split payment; deliberate mismatch
  for "orders not fully paid" queries (a `HAVING SUM(amount) < total` exercise).
- **Row 5 `failed`** → filtering by payment status; skew for partial-index lessons.
- **Negative amounts** → `CHECK` semantics, `SUM` with mixed signs, and the trap of
  forgetting refunds in revenue.

---

## 8. `reviews`

**Column dictionary**

| Column        | Type          | Meaning / constraints                                       |
|---------------|---------------|-------------------------------------------------------------|
| `id`          | `bigint`      | PK, identity.                                               |
| `product_id`  | `bigint`      | FK → `products.id`.                                         |
| `user_id`     | `bigint`      | FK → `users.id`.                                            |
| `rating`      | `smallint`    | `CHECK (rating BETWEEN 1 AND 5)`.                          |
| `body`        | `text`        | Free text (full-text-search + trigram target). Nullable.   |
| `created_at`  | `timestamptz` | When posted.                                               |
| *unique*      |               | `UNIQUE (product_id, user_id)` — one review per user/product. |

**Visible sample (10 rows)**

| id | product_id | user_id | rating | body                                   | created_at (UTC)       |
|----|------------|---------|--------|----------------------------------------|------------------------|
| 1  | 1          | 1       | 5      | Fantastic laptop, fast and light.      | 2023-02-10 09:00:00+00 |
| 2  | 1          | 2       | 4      | Great but pricey.                      | 2023-02-12 14:00:00+00 |
| 3  | 4          | 1       | 5      | Best keyboard I have owned.            | 2023-03-20 10:00:00+00 |
| 4  | 4          | 3       | 2      | Keys feel mushy.                       | 2023-04-01 08:00:00+00 |
| 5  | 2          | 2       | 5      | Worth every penny for the RAM.         | 2024-01-15 12:00:00+00 |
| 6  | 6          | 7       | 3      | *NULL*                                 | 2024-04-05 11:00:00+00 |
| 7  | 8          | 5       | 5      | The definitive Postgres deep dive.     | 2024-02-01 16:00:00+00 |
| 8  | 3          | 3       | 1      | Arrived damaged, would not recommend.  | 2024-02-25 15:00:00+00 |
| 9  | 1          | 7       | 4      | Solid, but battery could be better.    | 2024-03-10 09:30:00+00 |
| 10 | 5          | 2       | 4      | Compact and clicky.                    | 2024-05-01 10:00:00+00 |

**Why these rows exist:**
- **Product 1 has 3 reviews** (rows 1, 2, 9) → `AVG(rating)` per product, window ranking of
  reviewers, correlated subquery "products rated above their category average."
- **Row 6 `body NULL` but rating present** → full-text-search over nullable text, `COUNT(body)`
  vs `COUNT(*)`, `ts_rank` on NULL.
- **`UNIQUE (product_id, user_id)`** → `ON CONFLICT (product_id, user_id) DO UPDATE`
  upsert lessons (Curriculum 2.10), and the "conflict needs a real unique constraint" note.
- **Rating spread 1–5** → `GROUPING SETS`, histograms, `percentile_cont` ordered-set aggregate.

---

## 9. `inventory`

**Column dictionary**

| Column          | Type          | Meaning / constraints                                     |
|-----------------|---------------|-----------------------------------------------------------|
| `product_id`    | `bigint`      | PK **and** FK → `products.id` (1-to-1).                   |
| `stock`         | `int`         | Units on hand. `CHECK (stock >= 0)`.                      |
| `reorder_level` | `int`         | Reorder threshold.                                        |
| `updated_at`    | `timestamptz` | Last stock change (high-churn column — bloat lesson).    |

**Visible sample (10 rows)**

| product_id | stock | reorder_level | updated_at (UTC)       |
|------------|-------|---------------|------------------------|
| 1          | 42    | 10            | 2024-09-01 08:00:00+00 |
| 2          | 8     | 10            | 2024-09-02 09:00:00+00 |
| 3          | 0     | 5             | 2024-08-15 12:00:00+00 |
| 4          | 150   | 20            | 2024-09-03 10:00:00+00 |
| 5          | 75    | 20            | 2024-09-03 10:05:00+00 |
| 6          | 3     | 15            | 2024-09-04 14:00:00+00 |
| 7          | 500   | 50            | 2024-07-01 08:00:00+00 |
| 8          | 12    | 5             | 2024-09-05 16:00:00+00 |
| 9          | 1     | 0             | 2024-09-06 03:00:00+00 |
| 10         | 25    | 10            | 2024-09-07 11:00:00+00 |

**Why these rows exist:**
- **Products 2, 3, 6 are at/below reorder level** (8≤10, 0<5, 3<15) → `WHERE stock <=
  reorder_level` join-back to products, a realistic "what to reorder" query.
- **Product 3 `stock = 0`** → the concurrent-decrement / oversell race (`UPDATE ... WHERE
  stock > 0`) from [[MASTERY-INSIGHTS.md]] 6.1, and `SELECT ... FOR UPDATE` / `SKIP LOCKED`.
- **`updated_at` is the high-churn column** → the MVCC bloat lesson (5.1): frequent stock
  updates create dead tuples; whether to index this column is a deliberate tradeoff.

---

## Bonus: bookings (for range types & EXCLUDE constraints)

> Not part of the core store, but seeded so range-type and no-overlap lessons have real
> data. Include when teaching Curriculum 3.3 (`EXCLUDE`) / 3.4 (range/multirange types).

**Column dictionary**

| Column       | Type        | Meaning / constraints                                              |
|--------------|-------------|-------------------------------------------------------------------|
| `id`         | `bigint`    | PK, identity.                                                     |
| `room_id`    | `int`       | Which resource is booked.                                         |
| `during`     | `tstzrange` | The reservation window.                                          |
| *exclude*    |             | `EXCLUDE USING gist (room_id WITH =, during WITH &&)` — no overlap. |

**Visible sample (10 rows)**

| id | room_id | during (tstzrange)                              |
|----|---------|-------------------------------------------------|
| 1  | 1       | [2024-06-01 09:00, 2024-06-01 11:00)            |
| 2  | 1       | [2024-06-01 11:00, 2024-06-01 12:00)            |
| 3  | 1       | [2024-06-01 14:00, 2024-06-01 15:00)            |
| 4  | 2       | [2024-06-01 09:00, 2024-06-01 17:00)            |
| 5  | 2       | [2024-06-02 09:00, 2024-06-02 10:00)            |
| 6  | 3       | [2024-06-01 10:00, 2024-06-01 10:30)            |
| 7  | 3       | [2024-06-01 10:30, 2024-06-01 11:00)            |
| 8  | 1       | [2024-06-02 09:00, 2024-06-02 12:00)            |
| 9  | 2       | [2024-06-03 13:00, 2024-06-03 14:00)            |
| 10 | 3       | [2024-06-01 15:00, 2024-06-01 16:00)            |

**Why these rows exist:**
- **Room 1 has adjacent-but-not-overlapping bookings** (rows 1→2 touch at 11:00 with the
  half-open `[)` bound) → the `[)` vs `[]` range-boundary lesson and why half-open ranges
  compose cleanly. An `INSERT` overlapping any of these must be *rejected* by the `EXCLUDE`
  constraint — the live demo of that error is the lesson.
- **Room 2 row 4** is an all-day block → overlap-detection questions.

---

## How the app should render this

- **Always-visible data panel.** When a lesson or question references a table, show its
  10-row sample as a grid *beside or above* the SQL editor — the learner never has to run
  `SELECT * ` just to remember the columns. NULLs shown explicitly (e.g. a greyed `NULL`
  chip), not blank cells (blank vs NULL is itself a concept).
- **Styled like a real result grid.** Monospace, zebra rows, type-aware alignment (numbers
  right-aligned), a header row with column names *and* types on hover — modeled on `psql`
  `\x`-off output / a pgAdmin result grid so it feels like production.
- **Live results use the same rendering.** When the learner runs a query, the result set
  renders in the identical grid so the sample panel and the query output look consistent.
- **Scale on demand, edge cases always present.** For performance lessons the app inflates
  each table to millions of rows programmatically, but the **visible 10** remain this curated
  set so the traps are always reproducible.

---

*Maintenance note: every row above is chosen to trigger a specific lesson or trap in
[[CURRICULUM.md]] / [[MASTERY-INSIGHTS.md]]. If a new lesson needs a new edge case, add the
row here (and note why) rather than inventing data ad hoc in the app — this file is the seed
of record.*
