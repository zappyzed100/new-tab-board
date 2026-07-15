---
name: verify
description: Project-specific recipes for driving real surfaces in new-tab-board (built Chrome extension + native-host Python subprocess) instead of import-and-call testing.
---

# new-tab-board — verify recipes

This repo has two runtime surfaces that unit tests and Playwright's own
fixtures don't reach on their own: the `native-host/` Python subprocess
(a native-messaging host, spawned by Chrome — never imported directly by
the extension) and the built extension's UI when it depends on that host's
responses (Drive/NAS features). Both are drivable without installing
anything into the OS.

## Build first

```bash
npm run build   # writes dist/ (Manifest V3 unpacked extension)
```

## Recipe 1: drive native-host/nas_bridge.py as a real subprocess

`nas_bridge.py` speaks native messaging framing (4-byte little-endian
length prefix + UTF-8 JSON) on stdin/stdout — that's the real interface,
not the `handle()` Python function (importing and calling `handle()` is
what `test_nas_bridge.py` already does; verification needs to go one
level further, through the actual process boundary).

```python
import json, struct, subprocess, sys

def send(proc, message):
    data = json.dumps(message).encode("utf-8")
    proc.stdin.write(struct.pack("@I", len(data)))
    proc.stdin.write(data)
    proc.stdin.flush()

def recv(proc):
    raw_length = proc.stdout.read(4)
    length = struct.unpack("@I", raw_length)[0]
    return json.loads(proc.stdout.read(length).decode("utf-8"))

proc = subprocess.Popen(
    [sys.executable, r"native-host\nas_bridge.py"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env=dict(os.environ, PYTHONIOENCODING="utf-8"),
)
send(proc, {"type": "rebuild-index", "path": nas_folder})
print(recv(proc))
```

Run via `uv run --directory native-host python <script>` (or `uv run
python <script>` from inside `native-host/`) so the interpreter matches
the one `test_nas_bridge.py` uses.

Gotcha: printed Japanese text renders as mojibake in the Windows
terminal (console codepage), but the underlying UTF-8 data is correct —
don't chase this as a bug; assert on the actual string values instead of
eyeballing printed output.

Use a fresh `tempfile.mkdtemp()` per run and `shutil.rmtree` it in a
`finally`; write fixture `.md` files with real front matter (see
`native-host/test_nas_bridge.py`'s `_seed_notes_for_search` /
`_write_date_note` helpers for the exact format: `active/<id>.md` for
current notes, `YYYY/M/D/<id>.md` for date-archive copies).

## Recipe 2: drive the real extension UI with a faked native-messaging port

For UI (e.g. `TagSearchPanel.tsx`) that depends on `chrome.runtime.connectNative`
responses, don't install `native-host/` into the OS registry just to
verify a UI change — instead launch the real built extension via
Playwright (same pattern as `e2e/fixtures.ts`) and monkey-patch
`chrome.runtime.connectNative` from `page.evaluate` before triggering the
flow. This still drives the real DOM (real clicks, real React
reconciliation, real console-error capture) — only the native-messaging
transport is faked at the boundary:

```js
import { chromium } from "playwright";
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
// gotcha: chrome_url_overrides.newtab means Chrome auto-opens a "ghost tab"
// running its own App.tsx instance on launch. Navigate any pre-existing
// pages to about:blank before opening your own page, or its background
// writes can race with what you're testing (see e2e/fixtures.ts comment).
for (const p of context.pages()) await p.goto("about:blank").catch(() => {});

const page = await context.newPage();
await page.goto(newTabUrl);
await page.evaluate(() => {
  window.chrome.runtime.connectNative = (_name) => {
    const listeners = [];
    return {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      onDisconnect: { addListener: () => {} },
      postMessage: (msg) => queueMicrotask(() => {
        const response = /* branch on msg.type, mirror native-host's real response shape */;
        listeners.forEach((fn) => fn(response));
      }),
      disconnect: () => {},
    };
  };
});
```

Then drive the real UI: click `data-set-nas-folder`, fill
`data-nas-path-input`, click `data-save-nas-path` (this round-trips a
`probe` message through your fake port), then interact with whatever
panel you're checking. Capture `page.on("console", ...)` for
`type() === "error"` and `page.on("pageerror", ...)` — a clean run with
zero entries is real evidence, not just "it didn't throw."

Write the driver script into the repo root temporarily (Node needs repo
`node_modules` on the resolution path for `playwright`) or the scratchpad
dir + `cp` it in; delete it after (`rm -f` — it's untracked, nothing to
restore).

## What each recipe caught in practice

Recipe 1 confirmed `rebuild-index` populates both `notes` and
`date_notes` tables and that `search-notes` with a date range now UNIONs
both tables (a prior fix had added the `date_notes` table but never
wired a query against it — Recipe 1 is what would have caught that gap
immediately instead of it surviving a full pytest run unnoticed, since
`handle()`-level tests only exercise what the test author thought to
call).

Recipe 2 confirmed `TagSearchPanel.tsx`'s `resultRowKey` composite key
(`note_id` + `archived_date`) actually produces distinct
`data-testid`s and independent checkbox state for rows sharing the same
`note_id` (live + archived duplicates) — a concern that's easy to reason
about correctly in the diff but only real DOM rendering proves.
