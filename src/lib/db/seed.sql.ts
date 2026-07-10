/**
 * Curated seed data — the exact 10 rows per table from DATASET.md.
 *
 * Every row is chosen to trigger a specific lesson/trap (NULL user_id guest order,
 * the order-101 fan-out, citext duplicates, refunds, zero-stock, adjacent bookings),
 * so the values here match DATASET.md exactly — do not "tidy" them.
 *
 * The tables use `GENERATED ALWAYS AS IDENTITY`, but the dataset has meaningful ids
 * (orders 101..110, category ids used as FK targets), so inserts use
 * `OVERRIDING SYSTEM VALUE`. After seeding, each identity sequence is advanced past
 * the highest inserted id so subsequent app inserts don't collide (see SEQUENCE_FIXUP_SQL).
 */
export const SEED_SQL = /* sql */ `
-- categories (self-referencing tree) — parents before children within one INSERT is fine.
INSERT INTO categories (id, name, parent_id, slug) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Electronics', NULL, 'electronics'),
  (2, 'Computers',   1,    'computers'),
  (3, 'Laptops',     2,    'laptops'),
  (4, 'Desktops',    2,    'desktops'),
  (5, 'Peripherals', 1,    'peripherals'),
  (6, 'Keyboards',   5,    'keyboards'),
  (7, 'Mice',        5,    'mice'),
  (8, 'Books',       NULL, 'books'),
  (9, 'Programming', 8,    'programming'),
  (10,'Databases',   9,    'databases');

-- users (row 4: NULL full_name + NULL preferences; row 8: NULL preferences)
INSERT INTO users (id, email, full_name, country, city, status, created_at, preferences) OVERRIDING SYSTEM VALUE VALUES
  (1,  'ada@example.com',       'Ada Lovelace',      'UK',          'London',       'active',   '2022-01-05 09:12:00+00', '{"theme":"dark","newsletter":true}'),
  (2,  'grace@example.com',     'Grace Hopper',      'USA',         'New York',     'active',   '2022-03-18 14:02:00+00', '{"theme":"light"}'),
  (3,  'linus@example.com',     'Linus Torvalds',    'Finland',     'Helsinki',     'active',   '2022-06-30 23:59:00+00', '{}'),
  (4,  'anon4@example.com',     NULL,                'USA',         'Austin',       'inactive', '2023-02-11 06:45:00+00', NULL),
  (5,  'margaret@example.com',  'Margaret Hamilton', 'USA',         'Boston',       'active',   '2023-05-22 11:30:00+00', '{"theme":"dark","beta":true}'),
  (6,  'edsger@example.com',    'Edsger Dijkstra',   'Netherlands', 'Amsterdam',    'banned',   '2023-08-01 08:00:00+00', '{"newsletter":false}'),
  (7,  'katherine@example.com', 'Katherine Johnson', 'USA',         'Newport News', 'active',   '2023-11-19 17:15:00+00', '{"theme":"light","newsletter":true}'),
  (8,  'alan@example.com',      'Alan Turing',       'UK',          'London',       'active',   '2024-01-02 00:01:00+00', NULL),
  (9,  'barbara@example.com',   'Barbara Liskov',    'USA',         'New York',     'inactive', '2024-04-14 13:20:00+00', '{"theme":"dark"}'),
  (10, 'dennis@example.com',    'Dennis Ritchie',    'USA',         'Murray Hill',  'active',   '2024-09-09 09:09:00+00', '{"newsletter":true}');

-- products (row 9: NULL category_id, empty-object attributes)
INSERT INTO products (id, sku, name, category_id, price, attributes, created_at) OVERRIDING SYSTEM VALUE VALUES
  (1,  'LAP-001',  'UltraBook 14',           3,    1299.00, '{"ram_gb":16,"cpu":"i7","touch":false}',                    '2022-02-01 10:00:00+00'),
  (2,  'LAP-002',  'UltraBook 14 Pro',       3,    1799.00, '{"ram_gb":32,"cpu":"i9","touch":true}',                     '2022-02-01 10:05:00+00'),
  (3,  'DSK-001',  'TowerPro Desktop',       4,     999.00, '{"ram_gb":64,"gpu":"RTX4070"}',                             '2022-04-10 12:00:00+00'),
  (4,  'KEY-001',  'Mechanical Keyboard',    6,     120.00, '{"switch":"brown","layout":"US","wireless":true}',          '2022-05-15 09:30:00+00'),
  (5,  'KEY-002',  'Compact 60% Keyboard',   6,      89.99, '{"switch":"red","layout":"US"}',                            '2022-05-15 09:31:00+00'),
  (6,  'MOU-001',  'Ergonomic Mouse',        7,      59.50, '{"dpi":16000,"wireless":true}',                             '2022-07-20 14:00:00+00'),
  (7,  'BOK-001',  'The C Programming Lang', 9,      45.00, '{"pages":272,"format":"paperback"}',                        '2022-09-01 08:00:00+00'),
  (8,  'BOK-002',  'PostgreSQL Internals',   10,     59.00, '{"pages":540,"format":"ebook","drm":false}',                '2023-01-12 16:00:00+00'),
  (9,  'MISC-001', 'Mystery Gadget',         NULL,   19.99, '{}',                                                        '2023-03-03 03:03:00+00'),
  (10, 'LAP-003',  'Budget Laptop 13',       3,     549.00, '{"ram_gb":8,"cpu":"i3","touch":false,"refurb":true}',       '2024-06-01 11:11:00+00');

-- orders (row 105: NULL user_id — the guest order, the single most important row)
INSERT INTO orders (id, user_id, status, total, placed_at, shipped_at) OVERRIDING SYSTEM VALUE VALUES
  (101, 1,    'delivered', 1418.99, '2023-02-01 10:00:00+00', '2023-02-02 08:00:00+00'),
  (102, 1,    'delivered',  120.00, '2023-03-15 12:30:00+00', '2023-03-16 09:00:00+00'),
  (103, 2,    'shipped',   1858.00, '2024-01-10 09:00:00+00', '2024-01-11 07:30:00+00'),
  (104, 3,    'paid',       999.00, '2024-02-20 15:45:00+00', NULL),
  (105, NULL, 'pending',     89.99, '2024-03-01 18:00:00+00', NULL),
  (106, 5,    'cancelled',  149.49, '2024-03-05 08:15:00+00', NULL),
  (107, 7,    'delivered',  104.50, '2024-04-01 11:00:00+00', '2024-04-03 10:00:00+00'),
  (108, 1,    'paid',       549.00, '2024-06-10 20:00:00+00', NULL),
  (109, 9,    'delivered',   45.00, '2024-07-04 07:00:00+00', '2024-07-05 12:00:00+00'),
  (110, 2,    'shipped',     59.00, '2024-09-01 00:30:00+00', '2024-09-01 23:59:00+00');

-- order_items (order 101 has 2 items — the fan-out multiplier)
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) OVERRIDING SYSTEM VALUE VALUES
  (1,  101, 1, 1, 1299.00),
  (2,  101, 4, 1,  120.00),
  (3,  102, 4, 1,  120.00),
  (4,  103, 2, 1, 1799.00),
  (5,  103, 6, 1,   59.00),
  (6,  104, 3, 1,  999.00),
  (7,  105, 5, 1,   89.99),
  (8,  106, 4, 1,  120.00),
  (9,  106, 6, 1,   29.50),
  (10, 107, 6, 1,   59.50);

-- shipments (order 101 has 3 shipments; orders 104,105,106,108 have zero — LEFT JOIN NULLs)
INSERT INTO shipments (id, order_id, carrier, tracking_no, shipped_at) OVERRIDING SYSTEM VALUE VALUES
  (1,  101, 'DHL',   'DH1001', '2023-02-02 08:00:00+00'),
  (2,  101, 'DHL',   'DH1002', '2023-02-02 08:05:00+00'),
  (3,  102, 'UPS',   'UP2001', '2023-03-16 09:00:00+00'),
  (4,  103, 'FedEx', 'FX3001', '2024-01-11 07:30:00+00'),
  (5,  107, 'DHL',   'DH1003', '2024-04-03 10:00:00+00'),
  (6,  109, 'UPS',   NULL,     '2024-07-05 12:00:00+00'),
  (7,  110, 'FedEx', 'FX3002', '2024-09-01 23:59:00+00'),
  (8,  103, 'FedEx', 'FX3003', '2024-01-12 06:00:00+00'),
  (9,  101, 'DHL',   NULL,     '2023-02-02 08:10:00+00'),
  (10, 107, 'UPS',   'UP2002', '2024-04-03 11:00:00+00');

-- payments (order 106: charge + refund; order 110: partial payment 30.00 vs total 59.00)
INSERT INTO payments (id, order_id, amount, method, status, paid_at) OVERRIDING SYSTEM VALUE VALUES
  (1,  101, 1418.99, 'card',     'captured',   '2023-02-01 10:01:00+00'),
  (2,  102,  120.00, 'paypal',   'captured',   '2023-03-15 12:31:00+00'),
  (3,  103, 1858.00, 'card',     'captured',   '2024-01-10 09:02:00+00'),
  (4,  104,  999.00, 'bank',     'authorized', '2024-02-20 15:46:00+00'),
  (5,  105,   89.99, 'card',     'failed',     '2024-03-01 18:01:00+00'),
  (6,  106,  149.49, 'card',     'captured',   '2024-03-05 08:16:00+00'),
  (7,  106, -149.49, 'card',     'refunded',   '2024-03-06 10:00:00+00'),
  (8,  107,  104.50, 'giftcard', 'captured',   '2024-04-01 11:01:00+00'),
  (9,  109,   45.00, 'paypal',   'captured',   '2024-07-04 07:01:00+00'),
  (10, 110,   30.00, 'card',     'captured',   '2024-09-01 00:31:00+00');

-- reviews (product 1 has 3 reviews; row 6 has NULL body; UNIQUE (product_id, user_id))
INSERT INTO reviews (id, product_id, user_id, rating, body, created_at) OVERRIDING SYSTEM VALUE VALUES
  (1,  1, 1, 5, 'Fantastic laptop, fast and light.',     '2023-02-10 09:00:00+00'),
  (2,  1, 2, 4, 'Great but pricey.',                      '2023-02-12 14:00:00+00'),
  (3,  4, 1, 5, 'Best keyboard I have owned.',            '2023-03-20 10:00:00+00'),
  (4,  4, 3, 2, 'Keys feel mushy.',                       '2023-04-01 08:00:00+00'),
  (5,  2, 2, 5, 'Worth every penny for the RAM.',         '2024-01-15 12:00:00+00'),
  (6,  6, 7, 3, NULL,                                     '2024-04-05 11:00:00+00'),
  (7,  8, 5, 5, 'The definitive Postgres deep dive.',     '2024-02-01 16:00:00+00'),
  (8,  3, 3, 1, 'Arrived damaged, would not recommend.',  '2024-02-25 15:00:00+00'),
  (9,  1, 7, 4, 'Solid, but battery could be better.',    '2024-03-10 09:30:00+00'),
  (10, 5, 2, 4, 'Compact and clicky.',                    '2024-05-01 10:00:00+00');

-- inventory (1-to-1 with products; product 3 stock 0; products 2,3,6 at/below reorder)
INSERT INTO inventory (product_id, stock, reorder_level, updated_at) VALUES
  (1,  42,  10, '2024-09-01 08:00:00+00'),
  (2,  8,   10, '2024-09-02 09:00:00+00'),
  (3,  0,   5,  '2024-08-15 12:00:00+00'),
  (4,  150, 20, '2024-09-03 10:00:00+00'),
  (5,  75,  20, '2024-09-03 10:05:00+00'),
  (6,  3,   15, '2024-09-04 14:00:00+00'),
  (7,  500, 50, '2024-07-01 08:00:00+00'),
  (8,  12,  5,  '2024-09-05 16:00:00+00'),
  (9,  1,   0,  '2024-09-06 03:00:00+00'),
  (10, 25,  10, '2024-09-07 11:00:00+00');

-- bookings (room 1 adjacent-but-not-overlapping; half-open [) bounds)
INSERT INTO bookings (id, room_id, during) OVERRIDING SYSTEM VALUE VALUES
  (1,  1, tstzrange('2024-06-01 09:00+00', '2024-06-01 11:00+00', '[)')),
  (2,  1, tstzrange('2024-06-01 11:00+00', '2024-06-01 12:00+00', '[)')),
  (3,  1, tstzrange('2024-06-01 14:00+00', '2024-06-01 15:00+00', '[)')),
  (4,  2, tstzrange('2024-06-01 09:00+00', '2024-06-01 17:00+00', '[)')),
  (5,  2, tstzrange('2024-06-02 09:00+00', '2024-06-02 10:00+00', '[)')),
  (6,  3, tstzrange('2024-06-01 10:00+00', '2024-06-01 10:30+00', '[)')),
  (7,  3, tstzrange('2024-06-01 10:30+00', '2024-06-01 11:00+00', '[)')),
  (8,  1, tstzrange('2024-06-02 09:00+00', '2024-06-02 12:00+00', '[)')),
  (9,  2, tstzrange('2024-06-03 13:00+00', '2024-06-03 14:00+00', '[)')),
  (10, 3, tstzrange('2024-06-01 15:00+00', '2024-06-01 16:00+00', '[)'));
`;

/**
 * After seeding with explicit ids via OVERRIDING SYSTEM VALUE, the identity sequences
 * still point at 1. Advance each to just past the max seeded id so the app's later
 * inserts (which omit id) don't collide with the curated rows. inventory has no
 * identity column (product_id is a plain FK PK), so it is excluded.
 */
export const SEQUENCE_FIXUP_SQL = /* sql */ `
SELECT setval(pg_get_serial_sequence('categories',  'id'), (SELECT max(id) FROM categories));
SELECT setval(pg_get_serial_sequence('users',       'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('products',    'id'), (SELECT max(id) FROM products));
SELECT setval(pg_get_serial_sequence('orders',      'id'), (SELECT max(id) FROM orders));
SELECT setval(pg_get_serial_sequence('order_items', 'id'), (SELECT max(id) FROM order_items));
SELECT setval(pg_get_serial_sequence('shipments',   'id'), (SELECT max(id) FROM shipments));
SELECT setval(pg_get_serial_sequence('payments',    'id'), (SELECT max(id) FROM payments));
SELECT setval(pg_get_serial_sequence('reviews',     'id'), (SELECT max(id) FROM reviews));
SELECT setval(pg_get_serial_sequence('bookings',    'id'), (SELECT max(id) FROM bookings));
`;
