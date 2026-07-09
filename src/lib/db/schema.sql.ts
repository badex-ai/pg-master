/**
 * E-commerce practice schema — the DDL that realizes DATASET.md.
 * Every table, type, key, and constraint matches the dataset spec exactly.
 * Pinned to PostgreSQL 18 semantics; runs in PGlite.
 *
 * Exported as a string so the app can execute it against the in-browser PGlite
 * instance on init (see seed.ts). `citext` and `btree_gist` are enabled for the
 * case-insensitive email/username and the no-overlap booking constraint.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. categories (self-referencing tree) — created before products (FK target).
CREATE TABLE categories (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  parent_id  int REFERENCES categories (id),
  slug       text NOT NULL UNIQUE
);

-- 1. users
CREATE TABLE users (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        citext NOT NULL UNIQUE,
  full_name    text,
  country      text,
  city         text,
  status       text NOT NULL CHECK (status IN ('active', 'inactive', 'banned')),
  created_at   timestamptz NOT NULL,
  preferences  jsonb
);

-- 3. products
CREATE TABLE products (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku          text NOT NULL UNIQUE,
  name         text NOT NULL,
  category_id  int REFERENCES categories (id),
  price        numeric(10, 2) NOT NULL,
  attributes   jsonb,
  created_at   timestamptz NOT NULL
);

-- 4. orders (user_id nullable — guest checkout)
CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint REFERENCES users (id),
  status      text NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
  total       numeric(10, 2) NOT NULL,
  placed_at   timestamptz NOT NULL,
  shipped_at  timestamptz
);

-- 5. order_items (the fan-out multiplier)
CREATE TABLE order_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  product_id  bigint NOT NULL REFERENCES products (id),
  quantity    int NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10, 2) NOT NULL
);

-- 6. shipments (the other fan-out source; 0..many per order)
CREATE TABLE shipments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders (id),
  carrier      text NOT NULL,
  tracking_no  text,
  shipped_at   timestamptz NOT NULL
);

-- 7. payments (positive = charge, negative = refund)
CREATE TABLE payments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint NOT NULL REFERENCES orders (id),
  amount     numeric(10, 2) NOT NULL,
  method     text NOT NULL CHECK (method IN ('card', 'paypal', 'bank', 'giftcard')),
  status     text NOT NULL CHECK (status IN ('authorized', 'captured', 'refunded', 'failed')),
  paid_at    timestamptz NOT NULL
);

-- 8. reviews (one review per user per product)
CREATE TABLE reviews (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products (id),
  user_id     bigint NOT NULL REFERENCES users (id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text,
  created_at  timestamptz NOT NULL,
  UNIQUE (product_id, user_id)
);

-- 9. inventory (1-to-1 with products)
CREATE TABLE inventory (
  product_id     bigint PRIMARY KEY REFERENCES products (id),
  stock          int NOT NULL CHECK (stock >= 0),
  reorder_level  int NOT NULL,
  updated_at     timestamptz NOT NULL
);

-- Bonus: bookings (range types + no-overlap EXCLUDE constraint)
CREATE TABLE bookings (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id  int NOT NULL,
  during   tstzrange NOT NULL,
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
);
`;
