'use client';

import { useState } from 'react';
import { SqlEditor } from './SqlEditor';

/**
 * Temporary harness proving the SQL editor triggers a run handler (task 2.1).
 * Replaced in task 2.2, when the editor is wired to PGlite and a result grid.
 */
export function EditorSmokeTest() {
  const [value, setValue] = useState('SELECT * FROM users;');
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);

  return (
    <div className="flex flex-col gap-2">
      <SqlEditor
        value={value}
        onChange={setValue}
        onRun={(sql) => {
          setLastRun(sql);
          setRunCount((n) => n + 1);
        }}
      />
      <p className="font-mono text-xs text-neutral-500">
        Press Cmd/Ctrl+Enter to run. Runs: <span data-testid="run-count">{runCount}</span>
      </p>
      {lastRun !== null && (
        <pre
          data-testid="last-run"
          className="overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-xs text-neutral-700"
        >
          {lastRun}
        </pre>
      )}
    </div>
  );
}
