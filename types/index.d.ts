/** One prompt you typed, with the reply that followed it. */
export type Item = {
  /** The row's uuid in the session log (jsonl); expected to equal the transcript row's requestId */
  id: string
  /** Display time "HH:MM" ("MM/DD HH:MM" on another day) */
  time: string
  prompt: string
  reply: string
}

export type Index = {
  sessionId: string
  /** Newest first */
  items: Item[]
  /** file: read from the jsonl through extract.py / session: built from $.session.messages() (no ids, no times) */
  source: 'file' | 'session'
  loadedAt: number
  error: string | null
}

export type View = {
  /** Cursor row of the list (index into the filtered list); moved with the arrows and j/k, opened with Enter */
  cursor: number
  /** Index into the filtered list shown in the reply view; null while the list is shown */
  selected: number | null
  /** The argument of /hist: a case-insensitive substring of the prompt text */
  query: string
  /** Outcome of the last action (whether the jump succeeded, and why not) */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-jump': { index: Index | null; view: View }
  }
}
