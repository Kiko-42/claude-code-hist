# claude-code-hist

A Claude Code mod: `/hist` lists the prompts you typed in this session, newest first, and jumps the transcript to the one you pick.

```
┌ History ──────────────────────────────────────────────┐
│ Your prompts, 12 total, newest first                   │
│ down(j)  up(k)  reload(r)  close(q)  ↑↓ to move, Enter to open │
│   15:02 add a flag to skip tests                       │
│ ▶ 14:43 how do I run the linter                        │
│   14:32 hello                                          │
│   10/11 22:10 why does the build fail on CI            │
│   ...                                                  │
└────────────────────────────────────────────────────────┘
        Enter  ──►  transcript scrolls to that prompt, pane closes
```

When the transcript row is no longer on screen (after `/compact`, or for a row the engine cannot resolve), the pane stays open and shows the prompt together with the reply it got, so you can still read it.

## Install

```
claude plugin marketplace add Kiko-42/claude-code-hist
claude plugin install prompt-jump@claude-code-hist
```

Then run `/reload-plugins` in a running session (or start a new one). The plugin id is `prompt-jump`; the command it registers is `/hist`.

Inside a session the same thing is one line: `/plugin install prompt-jump --marketplace Kiko-42/claude-code-hist`.

### Optional: a keyboard shortcut

The mod rides on the dim hint line under the prompt (the `? for shortcuts` line) with a small dim `hist` button at its end, so no extra row is drawn. To press that button from the prompt with a chord, bind a chord to an engine action the prompt never uses itself (`diff:back` only has a handler while the diff dialog is open) in `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+x h": "diff:back" } }
  ]
}
```

The chord reaches the button because a `Button` with `action` is pressed by the person's chord for that action while it is mounted and no engine handler of the action is mounted. Restart the session after creating the file.

## Usage

| Keys | What happens |
| --- | --- |
| `/hist` | open the pane listing all your prompts, newest first |
| `/hist <word>` | only prompts containing `<word>` (case-insensitive) |
| `ctrl+x h` | open the pane without typing (needs the optional keybinding above) |
| `↓` `↑` / `j` `k` | move the cursor (PageUp/PageDown and Home/End work too) |
| `Enter` | jump the transcript to that prompt and close the pane |
| `r` | reload the list |
| `q` / `Esc` | close the pane |

When a jump is not possible the pane switches to a reply view: the prompt, a rule, and the reply rendered as Markdown. There `b` goes back to the list, `j` / `k` step to the older / newer prompt, `g` tries the jump again (and closes on success), `q` closes.

If keys do not reach the pane, press `ctrl+x tab` to move focus into it (`Esc` returns to the prompt).

The list follows the session: while the pane is open it refreshes at the end of every turn.

## How it works

- `hooks/register.tsx` registers `/hist`, draws the pane, turns arrow keys / wheel into cursor moves, and redraws the hint line under the prompt with the engine's text plus the `hist` button (`action: "diff:back"`).
- `scripts/extract.py` reads the session log (`~/.claude/projects/<cwd with non-alphanumerics replaced by ->/<sessionId>.jsonl`), keeps only the prompts you typed (sub-agent rows, tool results, skill preambles and task notifications are dropped) and pairs each with the reply that followed. The log is read through a subprocess because session logs easily exceed the 4 MiB the engine lets a mod read directly.
- If the derived folder does not hold the log, every folder under `~/.claude/projects/` is scanned for `<sessionId>.jsonl`. If that fails too, the list is built from the engine's in-memory messages (no timestamps, jumps may not resolve).
- Jumping uses the prompt's row id in the transcript; the mod also remembers the ids of rows it saw drawn, as a second key.

## Requirements

- Claude Code 2.1.287 or newer, with mods (function hooks) available. The surface is early access and may change between releases.
- A terminal session. In the fullscreen layout the pane docks beside the transcript; in the inline layout it opens inline below the transcript.
- `python3` on the engine's PATH, or `/usr/bin/python3` (macOS). No third-party packages.

## Limitations

- After `/compact` the rows of older prompts are gone from the transcript, so Enter falls back to the reply view instead of jumping.
- Logs over 4 MiB are only reachable through `extract.py`; if Python is missing the mod falls back to the in-memory list.
- Remote Control, the desktop app and the IDE surfaces are untested; only the terminal surface is exercised.

## Related projects

- [nickhealthy/claude-code-prompt-jump](https://github.com/nickhealthy/claude-code-prompt-jump): `/jump`, also newest first with word search; its pane stays open after a jump, whereas `/hist` closes once the transcript has moved and only stays open when it could not.
- [felipeam86/claude-session-explorer](https://github.com/felipeam86/claude-session-explorer) (`prompt-history`): a side pane to browse, search and reuse full replies; it does not move the transcript to the prompt.
- [DazzleML/claude-bookmarks](https://github.com/DazzleML/claude-bookmarks): vim-style marks you set by hand on transcript lines and jump back to (GPL-3.0); `/hist` needs no marks, every prompt is a target.
- Upstream request: [anthropics/claude-code#70678](https://github.com/anthropics/claude-code/issues/70678), keyboard navigation between user messages. This mod is a stopgap until something like it lands in Claude Code itself.

## Development

```
claude plugin validate .
claude plugin test .
```

Type-check with `tsc -p .` once the engine has written `.claude-plugin/types/` (it does so when it loads the mod from this folder; the folder is git-ignored).

## License

MIT

---

## 日本語

Claude Code のモッドです。`/hist` で自分が打ったプロンプトを新しい順に一覧し、選ぶとトランスクリプトがその行まで移動します（移動後にパネルは自動で閉じます）。`/hist 語` で絞り込み、`↓↑` か `j` `k` で動かして `Enter`。本文へ飛べない時（`/compact` 後など）はその質問と返答をパネルに表示します。`q` か `Esc` で閉じます。

インストールは `claude plugin marketplace add Kiko-42/claude-code-hist` → `claude plugin install prompt-jump@claude-code-hist` → `/reload-plugins`。要件は Claude Code 2.1.287 以降（モッドが使える版）と `python3`。
