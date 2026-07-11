'use client';

import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

/** The seeded tables/columns, for editor autocompletion — matches the DATASET.md schema. */
const SCHEMA: Record<string, string[]> = {
  users: ['id', 'email', 'full_name', 'country', 'city', 'status', 'created_at', 'preferences'],
  categories: ['id', 'name', 'parent_id', 'slug'],
  products: ['id', 'sku', 'name', 'category_id', 'price', 'attributes', 'created_at'],
  orders: ['id', 'user_id', 'status', 'total', 'placed_at', 'shipped_at'],
  order_items: ['id', 'order_id', 'product_id', 'quantity', 'unit_price'],
  shipments: ['id', 'order_id', 'carrier', 'tracking_no', 'shipped_at'],
  payments: ['id', 'order_id', 'amount', 'method', 'status', 'paid_at'],
  reviews: ['id', 'product_id', 'user_id', 'rating', 'body', 'created_at'],
  inventory: ['product_id', 'stock', 'reorder_level', 'updated_at'],
  bookings: ['id', 'room_id', 'during'],
};

type SqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called with the current SQL when the learner presses Cmd/Ctrl+Enter. */
  onRun: (sql: string) => void;
};

/**
 * A CodeMirror 6 SQL editor with PostgreSQL syntax highlighting and schema-aware
 * autocompletion. Cmd/Ctrl+Enter runs the current query via `onRun`. The parent owns
 * the SQL text (controlled `value`/`onChange`), so it can pre-load worked examples.
 */
export function SqlEditor({ value, onChange, onRun }: SqlEditorProps) {
  // Run-on-Cmd/Ctrl+Enter, at high precedence so it beats CodeMirror's default
  // Enter handling. Reads the live document so it always runs what's on screen.
  const runKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: (view) => {
              onRun(view.state.doc.toString());
              return true;
            },
          },
        ]),
      ),
    [onRun],
  );

  const extensions = useMemo(
    () => [sql({ dialect: PostgreSQL, schema: SCHEMA, upperCaseKeywords: true }), runKeymap],
    [runKeymap],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: true }}
      className="overflow-hidden rounded border border-neutral-300 text-sm"
      aria-label="SQL editor"
    />
  );
}
