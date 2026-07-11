'use client';

import { useMemo, useRef } from 'react';
// Import keymap/Prec/EditorView from the wrapper (it re-exports @codemirror/view and
// @codemirror/state), so we always use the wrapper's own instances — CodeMirror's
// facet/extension identity is instance-based, and a second copy of @codemirror/state
// would silently break keybindings.
import CodeMirror, { keymap, Prec, EditorView } from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';

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
  // Latest-ref for the run handler: the keymap always calls the current onRun without
  // the handler's identity being a dependency of `extensions`. This lets `extensions`
  // be built exactly once — a changing extensions array makes the wrapper dispatch a
  // full reconfigure (rebuilding the language/autocompletion state), which would tear
  // down the schema autocomplete on every keystroke if a consumer passes an inline onRun.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: SCHEMA, upperCaseKeywords: true }),
      // Cmd/Ctrl+Enter runs the query. Prec.highest beats the default Mod-Enter binding
      // (insertBlankLine). Reads the live document so it always runs what's on screen.
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: (view) => {
              onRunRef.current(view.state.doc.toString());
              return true;
            },
          },
        ]),
      ),
      // The wrapper spreads unknown props onto its outer div, so an `aria-label` prop
      // never reaches the editable element; set it on the content DOM directly.
      EditorView.contentAttributes.of({ 'aria-label': 'SQL editor' }),
    ],
    [],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: true }}
      className="overflow-hidden rounded border border-neutral-300 text-sm"
    />
  );
}
