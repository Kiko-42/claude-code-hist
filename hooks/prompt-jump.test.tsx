// Run by `claude plugin test <mod folder>`. extract.py's output is stubbed through process.run, and the tests
// drive /hist -> list -> pick one -> reply view on the terminal surface.
import { expect, mock, test } from 'claude-code/testing'

// A short made-up conversation, newest first
const SAMPLE = [
  { id: 'u-3', time: '14:45', prompt: 'add a flag to skip tests', reply: 'Use **--skip-tests** in the runner.' },
  { id: 'u-2', time: '14:43', prompt: 'how do I run the linter', reply: 'Run `make lint` from the repo root.' },
  { id: 'u-1', time: '14:32', prompt: 'hello', reply: 'Hi. What are we building today?' },
]

const PANE_PROPS = {
  title: 'History',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 14 },
  view: {},
}

test('/hist reads the log through extract.py, lists prompts newest first, and opens a reply', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  const ran: string[][] = []
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', () => ({ value: false }))
  on('session.root', () => ({ value: '/home/me/src/demo' }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify(SAMPLE), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: { command: 'hist' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>engine</Text>
  })
  on('ui.scroll', () => ({}))

  const answer = await $.command.run({
    command: 'hist',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(answer.text).toContain('3 prompts')
  expect(ran[0]?.[0]).toBe('python3')
  expect(ran[0]?.at(-1)).toBe('/home/me/.claude/projects/-home-me-src-demo/sess-1.jsonl')

  const pane = await $.ui.mount({ plugin: 'prompt-jump', surface: 'terminal', component: 'Pane', requestId: 'prompt-jump', props: PANE_PROPS })
  const first = await pane.find({ key: 'open' })
  expect(first?.text).toContain('add a flag to skip tests')
  const third = await pane.find({ key: 'row:2' })
  expect(third?.text).toContain('hello')

  // j twice -> the cursor is on the third prompt -> Enter (presses open)
  await pane.press({ key: 'down' })
  await pane.press({ key: 'down' })
  expect((await pane.find({ key: 'open' }))?.text).toContain('hello')
  expect((await pane.find({ key: 'row:0' }))?.text).toContain('add a flag to skip tests')
  await pane.press({ key: 'open' })
  const back = await pane.find({ key: 'back' })
  expect(back).toBeDefined()
  // Only a refused jump falls into the reply view (the kit cannot resolve transcript rows, so it always does here)
  expect(await pane.find({ text: /Could not jump to the transcript/ })).toBeDefined()
  const reply = await pane.find({ type: 'Markdown' })
  expect(reply?.props.text).toBe('Hi. What are we building today?')
})

test('/hist <word> narrows the list to prompts holding the word', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', () => ({ value: false }))
  on('session.root', () => ({ value: '/home/me/src/demo' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SAMPLE), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'hist' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>engine</Text>
  })

  const answer = await $.command.run({
    command: 'hist',
    args: 'linter',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(answer.text).toContain('1 prompt')
  const pane = await $.ui.mount({ plugin: 'prompt-jump', surface: 'terminal', component: 'Pane', requestId: 'prompt-jump', props: PANE_PROPS })
  expect((await pane.find({ key: 'open' }))?.text).toContain('how do I run the linter')
  expect(await pane.find({ key: 'row:1' })).toBeUndefined()
})

test('an arrow key (ui.scroll by 1, person) moves the cursor and keeps it in the window', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', () => ({ value: false }))
  on('session.root', () => ({ value: '/home/me/src/demo' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SAMPLE), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'hist' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>engine</Text>
  })
  const offsets: number[] = []
  on('ui.scroll', (_$, e) => {
    offsets.push(e.offset)
    return {}
  })

  await $.command.run({ command: 'hist', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  const pane = await $.ui.mount({ plugin: 'prompt-jump', surface: 'terminal', component: 'Pane', requestId: 'prompt-jump', props: PANE_PROPS })
  expect((await pane.find({ key: 'open' }))?.text).toContain('add a flag to skip tests')

  const scroll = { component: 'Pane' as const, requestId: 'prompt-jump', bodyRows: 14, contentRows: 40, origin: { kind: 'person' as const } }
  await $.ui.scroll({ ...scroll, offset: 1, by: 1 })
  expect((await pane.find({ key: 'open' }))?.text).toContain('how do I run the linter')
  await $.ui.scroll({ ...scroll, offset: 2, by: 1 })
  expect((await pane.find({ key: 'open' }))?.text).toContain('hello')
  // Down again at the end -> stays
  await $.ui.scroll({ ...scroll, offset: 3, by: 1 })
  expect((await pane.find({ key: 'open' }))?.text).toContain('hello')
  // Up moves back
  await $.ui.scroll({ ...scroll, offset: 2, by: -1 })
  expect((await pane.find({ key: 'open' }))?.text).toContain('how do I run the linter')
  // The window is placed one row above the cursor row (2 header rows + index)
  expect(offsets).toEqual([2, 3, 3, 2])
})


test('the hint line under the prompt keeps its text and carries the ctrl+x h button that opens the pane', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', () => ({ value: false }))
  on('session.root', () => ({ value: '/Users/me/Obsidian' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SAMPLE), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'hist' } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>engine</Text>
  })

  const hint = await $.ui.mount({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect((await hint.find({ type: 'Text' }))?.text).toContain('? for shortcuts')
  const button = await hint.find({ key: 'hist' })
  expect(button?.text).toBe('hist')
  expect(button?.props.action).toBe('diff:back')

  await hint.press({ key: 'hist' })
  expect(opened).toEqual(['prompt-jump'])
})
