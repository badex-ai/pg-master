/**
 * Fidelity + invariants test for the curated seed data — the product's core asset.
 *
 * DATASET.md is the source of record: every lesson trap depends on exact values
 * (the one NULL user_id, the order-101 fan-out, the 59.00-vs-59.50 snapshot price).
 * This test fails if the seed drifts from DATASET.md in EITHER direction, and if the
 * seed/reset behavioral invariants regress. It uses node:test (zero deps); PGlite
 * runs headlessly in Node.
 *
 * Run: node --test src/lib/db/seed.test.mjs
 *
 * The SQL modules are TypeScript (string exports), and this Node version predates
 * native type-stripping, so the SQL is extracted from source by anchoring on the
 * exact `export const NAME = /* sql *\/ \`...\`` shape (asserted non-empty).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function extractSql(file, name) {
  const src = readFileSync(join(HERE, file), 'utf8');
  const re = new RegExp(`export const ${name}\\s*=\\s*/\\* sql \\*/\\s*\`([\\s\\S]*?)\``);
  const m = src.match(re);
  assert.ok(m, `could not extract ${name} from ${file}`);
  assert.ok(m[1].trim().length > 0, `${name} is empty`);
  return m[1];
}

const SCHEMA = extractSql('schema.sql.ts', 'SCHEMA_SQL');
const SEED = extractSql('seed.sql.ts', 'SEED_SQL');
const FIXUP = extractSql('seed.sql.ts', 'SEQUENCE_FIXUP_SQL');
const FULL = `${SCHEMA}\n${SEED}\n${FIXUP}`;

async function freshSeeded() {
  const db = await PGlite.create({ extensions: { citext, btree_gist } });
  await db.exec(FULL);
  return db;
}

// ── DATASET.md markdown parsing ───────────────────────────────────────────────
const MD = readFileSync(join(ROOT, 'DATASET.md'), 'utf8');

// Extract the "Visible sample" markdown table under a section heading.
function sampleTable(heading) {
  const at = MD.indexOf(heading);
  assert.ok(at >= 0, `heading not found: ${heading}`);
  const sampleAt = MD.indexOf('Visible sample', at);
  assert.ok(sampleAt >= 0, `no sample after: ${heading}`);
  const rows = [];
  let started = false;
  for (const line of MD.slice(sampleAt).split('\n')) {
    const t = line.trim();
    if (t.startsWith('|') && t.endsWith('|')) {
      started = true;
      const cells = t.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row
      rows.push(cells);
    } else if (started) break;
  }
  return { header: rows[0], data: rows.slice(1) };
}

const mdNull = (v) => (v === '*NULL*' ? null : v);
function dbText(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00`;
  }
  return String(v);
}
const sortKeys = (o) =>
  Array.isArray(o) ? o.map(sortKeys)
    : o && typeof o === 'object'
      ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]))
      : o;

// Default cell comparison: numbers by value, everything else by text.
function cellEq(mdText, dbVal) {
  const dbt = dbText(dbVal);
  if (mdText !== null && dbt !== null && /^-?\d+(\.\d+)?$/.test(mdText) && /^-?\d+(\.\d+)?$/.test(dbt)) {
    return Number(mdText) === Number(dbt);
  }
  return mdText === dbt;
}
function jsonEq(mdText, dbVal) {
  if (mdText === null) return dbVal === null;
  try { return JSON.stringify(sortKeys(JSON.parse(mdText))) === JSON.stringify(sortKeys(dbVal)); }
  catch { return false; }
}

// Table specs: [dbTable, heading, dbColumns (matching md header order), orderBy, perColumnCmp]
const SPECS = [
  ['users', '## 1. `users`', ['id', 'email', 'full_name', 'country', 'city', 'status', 'created_at', 'preferences'], 'id', { preferences: jsonEq }],
  ['categories', '## 2. `categories`', ['id', 'name', 'parent_id', 'slug'], 'id', {}],
  ['products', '## 3. `products`', ['id', 'sku', 'name', 'category_id', 'price', 'attributes', 'created_at'], 'id', { attributes: jsonEq }],
  ['orders', '## 4. `orders`', ['id', 'user_id', 'status', 'total', 'placed_at', 'shipped_at'], 'id', {}],
  ['order_items', '## 5. `order_items`', ['id', 'order_id', 'product_id', 'quantity', 'unit_price'], 'id', {}],
  ['shipments', '## 6. `shipments`', ['id', 'order_id', 'carrier', 'tracking_no', 'shipped_at'], 'id', {}],
  ['payments', '## 7. `payments`', ['id', 'order_id', 'amount', 'method', 'status', 'paid_at'], 'id', {}],
  ['reviews', '## 8. `reviews`', ['id', 'product_id', 'user_id', 'rating', 'body', 'created_at'], 'id', {}],
  ['inventory', '## 9. `inventory`', ['product_id', 'stock', 'reorder_level', 'updated_at'], 'product_id', {}],
];

for (const [table, heading, cols, orderBy, cmp] of SPECS) {
  test(`seed matches DATASET.md cell-for-cell: ${table}`, async () => {
    const db = await freshSeeded();
    const { data } = sampleTable(heading);
    const res = await db.query(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY ${orderBy}`);
    assert.equal(res.rows.length, data.length, `${table} row count`);
    for (let i = 0; i < data.length; i++) {
      for (let c = 0; c < cols.length; c++) {
        const expected = mdNull(data[i][c]);
        const eq = (cmp[cols[c]] || cellEq)(expected, res.rows[i][cols[c]]);
        assert.ok(eq, `${table} row ${i + 1} col "${cols[c]}": md=${JSON.stringify(expected)} db=${JSON.stringify(dbText(res.rows[i][cols[c]]) ?? res.rows[i][cols[c]])}`);
      }
    }
    await db.close();
  });
}

test('bookings match DATASET.md values and half-open [) bounds', async () => {
  const db = await freshSeeded();
  const spec = [
    [1, 1, '06-01 09:00', '06-01 11:00'], [2, 1, '06-01 11:00', '06-01 12:00'],
    [3, 1, '06-01 14:00', '06-01 15:00'], [4, 2, '06-01 09:00', '06-01 17:00'],
    [5, 2, '06-02 09:00', '06-02 10:00'], [6, 3, '06-01 10:00', '06-01 10:30'],
    [7, 3, '06-01 10:30', '06-01 11:00'], [8, 1, '06-02 09:00', '06-02 12:00'],
    [9, 2, '06-03 13:00', '06-03 14:00'], [10, 3, '06-01 15:00', '06-01 16:00'],
  ];
  const r = await db.query(`SELECT id, room_id, lower(during) lo, upper(during) hi, lower_inc(during) li, upper_inc(during) ui FROM bookings ORDER BY id`);
  const f = (d) => { const i = d.toISOString(); return `${i.slice(5, 10)} ${i.slice(11, 16)}`; };
  assert.equal(r.rows.length, 10);
  spec.forEach(([id, room, lo, hi], k) => {
    const row = r.rows[k];
    assert.equal(row.id, id);
    assert.equal(row.room_id, room);
    assert.equal(f(row.lo), lo);
    assert.equal(f(row.hi), hi);
    assert.equal(row.li, true, `booking ${id} lower-inclusive`);
    assert.equal(row.ui, false, `booking ${id} upper-exclusive`);
  });
  await db.close();
});

// ── behavioral invariants ─────────────────────────────────────────────────────
test('all ten tables seed exactly ten rows', async () => {
  const db = await freshSeeded();
  for (const t of ['categories', 'users', 'products', 'orders', 'order_items', 'shipments', 'payments', 'reviews', 'inventory', 'bookings']) {
    const c = (await db.query(`SELECT count(*)::int c FROM ${t}`)).rows[0].c;
    assert.equal(c, 10, `${t} row count`);
  }
  await db.close();
});

test('the teaching edge cases are present', async () => {
  const db = await freshSeeded();
  const guest = await db.query(`SELECT id FROM orders WHERE user_id IS NULL`);
  assert.equal(guest.rows.length, 1);
  assert.equal(guest.rows[0].id, 105, 'the guest order (NULL user_id) is 105');
  assert.equal((await db.query(`SELECT count(*)::int c FROM order_items WHERE order_id=101`)).rows[0].c, 2, 'order 101 fan-out: 2 items');
  assert.equal((await db.query(`SELECT count(*)::int c FROM shipments WHERE order_id=101`)).rows[0].c, 3, 'order 101 fan-out: 3 shipments');
  assert.equal((await db.query(`SELECT count(*)::int c FROM payments WHERE order_id=106 AND amount<0`)).rows[0].c, 1, 'order 106 refund');
  assert.equal((await db.query(`SELECT count(*)::int c FROM reviews WHERE body IS NULL`)).rows[0].c, 1, 'one NULL-body review');
  assert.equal(Number((await db.query(`SELECT stock FROM inventory WHERE product_id=3`)).rows[0].stock), 0, 'product 3 zero stock');
  assert.equal((await db.query(`SELECT count(*)::int c FROM products WHERE category_id IS NULL`)).rows[0].c, 1, 'one uncategorized product');
  await db.close();
});

test('sequence fixup: next id-less insert continues past the seeded max', async () => {
  const db = await freshSeeded();
  assert.equal(Number((await db.query(`INSERT INTO users (email,status,created_at) VALUES ('n@x.com','active',now()) RETURNING id`)).rows[0].id), 11);
  assert.equal(Number((await db.query(`INSERT INTO orders (user_id,status,total,placed_at) VALUES (1,'pending',1,now()) RETURNING id`)).rows[0].id), 111);
  await db.close();
});

test('citext enforces case-insensitive email uniqueness against seeded data', async () => {
  const db = await freshSeeded();
  await assert.rejects(
    db.exec(`INSERT INTO users (email,status,created_at) VALUES ('ADA@example.com','active',now())`),
    'ADA@example.com must collide with seeded ada@example.com',
  );
  await db.close();
});

test('EXCLUDE rejects an overlapping booking but allows an adjacent one', async () => {
  const db = await freshSeeded();
  // overlaps seeded room-1 [09:00,11:00)
  await assert.rejects(
    db.exec(`INSERT INTO bookings (room_id,during) VALUES (1, tstzrange('2024-06-01 09:30+00','2024-06-01 10:00+00','[)'))`),
    'overlap must be rejected',
  );
  // adjacent, non-overlapping (12:00-13:00, after seeded 11:00-12:00)
  await db.exec(`INSERT INTO bookings (room_id,during) VALUES (1, tstzrange('2024-06-01 12:00+00','2024-06-01 13:00+00','[)'))`);
  await db.close();
});

test('seed is idempotent when guarded by schema presence', async () => {
  const db = await PGlite.create({ extensions: { citext, btree_gist } });
  const isSeeded = async () => (await db.query(`SELECT to_regclass('public.users') IS NOT NULL AS p`)).rows[0].p;
  if (!(await isSeeded())) await db.exec(FULL);
  assert.equal(await isSeeded(), true);
  // second guarded seed must not run again (would throw "already exists")
  if (!(await isSeeded())) await db.exec(FULL);
  assert.equal((await db.query(`SELECT count(*)::int c FROM users`)).rows[0].c, 10);
  await db.close();
});

test('reset (DROP SCHEMA + rebuild) restores seed and removes learner-created objects', async () => {
  const db = await freshSeeded();
  const reset = () => db.exec(`DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n${FULL}`);
  await db.exec(`CREATE TABLE learner_scratch (id int); CREATE INDEX learner_idx ON users(country); DELETE FROM reviews;`);
  assert.equal((await db.query(`SELECT to_regclass('public.learner_scratch') IS NOT NULL t`)).rows[0].t, true);
  await reset();
  assert.equal((await db.query(`SELECT to_regclass('public.learner_scratch') IS NOT NULL t`)).rows[0].t, false, 'learner table dropped');
  assert.equal((await db.query(`SELECT count(*)::int c FROM pg_indexes WHERE indexname='learner_idx'`)).rows[0].c, 0, 'learner index dropped');
  assert.equal((await db.query(`SELECT count(*)::int c FROM reviews`)).rows[0].c, 10, 'seeded rows restored');
  await db.close();
});
