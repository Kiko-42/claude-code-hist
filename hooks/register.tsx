// prompt-jump: lists the prompts you typed in this session, newest first; picking one
// (1) scrolls the transcript to that row when the engine can, and otherwise
// (2) shows the prompt together with the reply it got, inside the pane.
//
// Entry points: `/hist [word]`, and the chord bound to `diff:back` (ctrl+x h, see README), which presses a small
// button the mod draws on the hint line under the prompt (no band above the prompt: it would take a row for good).
// Data: ~/.claude/projects/<cwd with non-alphanumerics replaced by ->/<sessionId>.jsonl, read through
// scripts/extract.py in a subprocess (session logs exceed the 4 MiB that $.fs.read allows).
// When that fails the list is built from $.session.messages() instead.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Index, Item, View } from '../types'

const PLUGIN = 'prompt-jump'
const PANE = 'prompt-jump'
const PANE_TITLE = 'History'
const COMMAND = 'hist'

/** The engine action whose chord presses the hint-line button: `diff:back` has no engine handler outside the diff dialog. */
const OPEN_ACTION = 'diff:back'

const EMPTY_VIEW: View = { cursor: 0, selected: null, query: '', note: '' }
/** Rows of the list header, the focus hint excluded: the title row and the button row. Used for the window offset. */
const HEADER_ROWS = 2

const index = atom({ plugin: 'prompt-jump', key: 'index' } as const, null)
const view = atom({ plugin: 'prompt-jump', key: 'view' } as const, EMPTY_VIEW)

/** Prompt rows seen drawn: text -> requestId in the transcript (a second key when the log's uuid does not resolve). */
const liveIds = new Map<string, string>()

type Engine = EngineInterface

const matches = (items: readonly Item[], query: string): Item[] => {
  const q = query.trim().toLowerCase()
  return q === '' ? [...items] : items.filter(it => it.prompt.toLowerCase().includes(q))
}

/** Flattens text to one line and cuts it to `cells` terminal cells (East Asian wide characters count 2). */
const oneLine = (text: string, cells: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  let width = 0
  let out = ''
  for (const ch of flat) {
    const w = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
    if (width + w > cells - 1) return out + '…'
    width += w
    out += ch
  }
  return out
}

const projectDirOf = (root: string): string => root.replace(/[^A-Za-z0-9]/g, '-')

/**
 * Where the session log is: ~/.claude/projects/<cwd with non-alphanumerics replaced by ->/<sessionId>.jsonl,
 * derived from the session's root; failing that, every folder under ~/.claude/projects/ is scanned for <sessionId>.jsonl.
 */
const transcriptFile = async ($: Engine, projects: string, derivedDir: string, sessionId: string): Promise<string> => {
  const derived = `${projects}/${derivedDir}/${sessionId}.jsonl`
  try {
    if (await $.fs.exists(derived)) return derived
    for (const entry of await $.fs.list(projects)) {
      if (entry.kind !== 'dir' || entry.name === derivedDir) continue
      const candidate = `${projects}/${entry.name}/${sessionId}.jsonl`
      if (await $.fs.exists(candidate)) return candidate
    }
  } catch {
    // Where the folder cannot be scanned (the test kit, a sandbox) the derived path is used as is.
  }
  return derived
}

/** jsonl -> Item[] (newest first). When extract.py cannot run, built from $.session.messages(). */
const loadIndex = async ($: Engine): Promise<Index> => {
  const sessionId = await $.session.id()
  const loadedAt = await $.clock.now()
  let error: string | null = null
  try {
    const home = await $.env.get('HOME')
    const root = await $.session.root()
    const file = await transcriptFile($, `${home}/.claude/projects`, projectDirOf(root), sessionId)
    // The engine's PATH may lack python3: prefer macOS's /usr/bin/python3 when it exists.
    const python = (await $.fs.exists('/usr/bin/python3')) ? '/usr/bin/python3' : 'python3'
    const ran = await $.process.run(
      [python, '-I', `${$.plugin.root}/scripts/extract.py`, file],
      { timeoutMs: 20000 },
    )
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim().split('\n').at(-1) ?? `exit ${ran.exitCode}`)
    if (ran.isStdoutTruncated) throw new Error('extract.py printed more than the engine passes on')
    const items = JSON.parse(ran.stdout) as Item[]
    return { sessionId, items, source: 'file', loadedAt, error }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  // Fallback: no timestamps and no row ids, but the prompts and replies are there.
  const rows = await $.session.messages()
  const items: Item[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.role !== 'user') continue
    const prompt = row.text.trim()
    if (prompt === '' || prompt.startsWith('<') || prompt.includes('Base directory for this skill')) continue
    const reply: string[] = []
    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j]
      if (!next || next.role === 'user') {
        if (next && next.text.trim() !== '') break
        continue
      }
      if (next.text.trim() !== '') reply.push(next.text)
    }
    items.push({ id: '', time: '--:--', prompt, reply: reply.join('\n\n') })
  }
  items.reverse()
  return { sessionId, items, source: 'session', loadedAt, error }
}

const paneOf = async ($: Engine) => (await $.ui.panes()).find(pane => pane.id === PANE)
const isPaneOpen = async ($: Engine) => (await paneOf($)) !== undefined

/**
 * Opens the pane and asks for the keyboard.
 * `focus` is granted only while an empty prompt holds the keys, so it is refused while `/hist` itself is still
 * in the composer; the request is repeated a few times once the command's row has gone through.
 */
const openPane = async ($: Engine) => {
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, rows: 14 })
  for (const ms of [250, 900, 2000]) {
    $.clock.after(ms, async () => {
      const pane = await paneOf($)
      if (pane === undefined) return
      if (!pane.isFocused) await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, rows: 14 })
      const now = await paneOf($)
      if (now?.isFocused) await $.ui.focus({ requestId: PANE, key: 'open' }).catch(() => undefined)
    })
  }
  return opened
}

const reload = async ($: Engine, query?: string) => {
  const loaded = await loadIndex($)
  await update($, index, () => loaded)
  await update($, view, v => ({ ...v, cursor: 0, selected: null, query: query ?? v.query, note: '' }))
  return loaded
}

/** Tries to scroll the transcript to the prompt's row. `moved` says whether it is on screen now; `note` is the reason when not. */
const jumpTo = async ($: Engine, item: Item): Promise<{ moved: boolean; note: string }> => {
  const candidates = [item.id, liveIds.get(item.prompt)].filter((id): id is string => !!id)
  if (candidates.length === 0) return { moved: false, note: 'This row has no position in the transcript; read it here.' }
  let reason = ''
  for (const requestId of candidates) {
    try {
      const moved = await $.ui.scroll({ to: { requestId }, block: 'start' })
      if (moved.deny === undefined) return { moved: true, note: '' }
      reason = moved.deny
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err)
    }
  }
  return { moved: false, note: `Could not jump to the transcript (${reason}); read it here.` }
}

/** Jumps and closes the pane (keys return to the prompt); when the jump is refused, shows the reply view instead. */
const openOrShow = async ($: Engine, items: readonly Item[], at: number) => {
  const target = items[at]
  if (target === undefined) return
  const jumped = await jumpTo($, target)
  if (jumped.moved) {
    await update($, view, cur => ({ ...cur, cursor: at, selected: null, note: '' }))
    await $.ui.close({ id: PANE })
    return
  }
  await update($, view, cur => ({ ...cur, cursor: at, selected: at, note: jumped.note }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'List the prompts you typed this session, newest first (filter by word); pick one to jump the transcript there',
      argumentHint: '[word]',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const loaded = await reload($, e.args)
    await openPane($)
    const n = matches(loaded.items, e.args).length
    const where = loaded.source === 'file' ? '' : ` (log unreadable, built from session memory: ${loaded.error ?? ''})`
    const scope = e.args.trim() === '' ? '' : `matching "${e.args.trim()}": `
    return { text: `History pane: ${scope}${n} prompt${n === 1 ? '' : 's'}${where}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { text: 'The history pane could not be opened (internal error). Run /hist again, or see claude --debug for the reason.' },
  )

  // Remember text -> requestId for every prompt row drawn (a second key for the jump).
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.props.origin.kind === 'composer') {
      liveIds.set(e.props.text.trim(), e.requestId)
    }
    return next(e)
  })

  // While the pane stays open, follow the session: refresh at the end of every turn.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && (await isPaneOpen($))) {
      const loaded = await loadIndex($)
      await update($, index, () => loaded)
    }
    return next(e)
  })

  // Ride on the dim hint line under the prompt (the `? for shortcuts` line): the engine's text stays, and a small
  // `hist` button is appended. The person's chord for `diff:back` (ctrl+x h in keybindings.json) presses it from
  // the prompt, so no extra row is drawn.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const open = async () => {
      await reload($)
      await openPane($)
    }
    return (
      <Box>
        {e.props.hint !== '' && <Text dimColor>{e.props.hint}  </Text>}
        <Button key="hist" plain dimColor action={OPEN_ACTION} onPress={open}>
          hist
        </Button>
      </Box>
    )
  })

  /** The window offset that keeps the cursor row visible: the cursor sits on the window's second row, so there is always room to scroll both ways. */
  const offsetFor = (cursor: number) => Math.max(0, HEADER_ROWS + cursor - 1)

  // In list mode the person's arrows, wheel, PageUp/PageDown and Home/End all arrive as ui.scroll; they are read as
  // cursor moves, and the window is placed where the cursor is visible (no reliance on the engine's focus ring).
  on('ui.scroll', async ($, e, next) => {
    if (e.component !== 'Pane' || e.requestId !== PANE || e.origin.kind !== 'person') return next(e)
    const v = await read($, view)
    const idx = await read($, index)
    if (v.selected !== null || idx === null) return next(e)
    const n = matches(idx.items, v.query).length
    if (n === 0 || e.by === 0) return next(e)
    const size = Math.abs(e.by)
    const step = size >= e.contentRows ? n : size >= e.bodyRows ? Math.max(1, e.bodyRows - 2) : 1
    const cursor = Math.min(n - 1, Math.max(0, v.cursor + Math.sign(e.by) * step))
    if (cursor !== v.cursor) await update($, view, cur => ({ ...cur, cursor }))
    return next({ ...e, offset: offsetFor(cursor) })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const idx = await read($, index)
    const v = await read($, view)
    const cols = Math.max(20, e.props.bodyColumns)
    const close = () => $.ui.close({ id: PANE })
    const focusHint = e.props.isFocused ? null : (
      <Text color="yellow">Keys not reaching the pane? Press ctrl+x tab to move focus here (Esc returns to the prompt)</Text>
    )

    if (idx === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Loading… if nothing appears, run /hist</Text>
        </Box>
      )
    }

    const items = matches(idx.items, v.query)
    const n = items.length
    const scope = v.query.trim() === '' ? '' : `matching "${v.query.trim()}", `

    // ---- Reply view: the prompt and the reply it got ----
    if (v.selected !== null && items[v.selected] !== undefined) {
      const i = v.selected
      const item = items[i] as Item
      const go = async (to: number) => {
        const target = items[to]
        if (target === undefined) return
        const jumped = await jumpTo($, target)
        await update($, view, cur => ({ ...cur, cursor: to, selected: to, note: jumped.moved ? 'Transcript moved there (g closes the pane)' : jumped.note }))
      }
      const back = () => update($, view, cur => ({ ...cur, selected: null, note: '' }))
      const jumpAndClose = () => openOrShow($, items, i)
      return (
        <Box flexDirection="column">
          {focusHint}
          <Box gap={2}>
            <Button key="back" plain hotkey="b" onPress={back}>
              list
            </Button>
            {i + 1 < n && (
              <Button key="older" plain hotkey="j" onPress={() => go(i + 1)}>
                older
              </Button>
            )}
            {i > 0 && (
              <Button key="newer" plain hotkey="k" onPress={() => go(i - 1)}>
                newer
              </Button>
            )}
            <Button key="jump" plain hotkey="g" onPress={jumpAndClose}>
              jump and close
            </Button>
            <Button key="close" plain hotkey="q" onPress={close}>
              close
            </Button>
          </Box>
          <Text color="yellow">{v.note}</Text>
          <Text dimColor>
            {i + 1}/{n}  {item.time}
          </Text>
          <Text bold wrap="wrap">{'> ' + item.prompt}</Text>
          <Text dimColor>{'─'.repeat(cols)}</Text>
          <Markdown key="reply" text={item.reply === '' ? '(no reply)' : item.reply} />
        </Box>
      )
    }

    // ---- List: every prompt on one row, newest first. The cursor row alone is a Button (autoFocus): Enter opens it. ----
    const cursor = Math.min(Math.max(0, v.cursor), Math.max(0, n - 1))
    const select = (at: number) => openOrShow($, items, at)
    const move = async (delta: number) => {
      if (n === 0) return
      const to = Math.min(n - 1, Math.max(0, cursor + delta))
      await update($, view, cur => ({ ...cur, cursor: to }))
      // Put the ring back on the cursor row (key: open) and bring the window there.
      $.clock.after(60, async () => {
        await $.ui.focus({ requestId: PANE, key: 'open' }).catch(() => undefined)
        await $.ui.scroll({ to: { key: 'open' }, in: PANE, block: 'center' }).catch(() => undefined)
      })
    }
    const status = idx.source === 'file' ? '' : ` (log unreadable, built from session memory: ${idx.error ?? ''})`
    const pad = Math.max(3, e.props.scroll.bodyRows)

    return (
      <Box flexDirection="column">
        {focusHint}
        <Text dimColor>
          Your prompts, {scope}{n} total, newest first{status}
        </Text>
        <Box gap={2}>
          <Button key="down" plain hotkey="j" onPress={() => move(1)}>
            down
          </Button>
          <Button key="up" plain hotkey="k" onPress={() => move(-1)}>
            up
          </Button>
          <Button key="reload" plain hotkey="r" onPress={() => reload($)}>
            reload
          </Button>
          <Button key="close" plain hotkey="q" onPress={close}>
            close
          </Button>
          <Text dimColor>↑↓ to move, Enter to open</Text>
        </Box>
        {n === 0 && <Text dimColor>No prompts match. Run /hist without a word to see all.</Text>}
        {items.map((it, i) => {
          const line = `${it.time} ${oneLine(it.prompt, cols - 10)}`
          return i === cursor ? (
            <Button key="open" plain autoFocus onPress={() => select(i)}>
              {'▶ ' + line}
            </Button>
          ) : (
            <Box key={`row:${i}`}>
              <Text>{'  ' + line}</Text>
            </Box>
          )
        })}
        {Array.from({ length: pad }, () => (
          <Text> </Text>
        ))}
      </Box>
    )
  })
}
