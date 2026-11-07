/** A note the model proposed in `/ebb add`, before the user approves it. */
export type Candidate = {
  front: string
  back: string
  hint?: string
  tags?: string[]
  flag?: string
  isDuplicate?: boolean
  isChecked: boolean
}

/** What the study pane shows. */
export type View =
  | { mode: 'study'; cardId: string | null; isRevealed: boolean; shownAt: number; isAsking: boolean; reply?: string; note?: string }
  | { mode: 'add'; deck: string; topic: string; candidates: Candidate[]; status?: string }

declare module 'claude-code' {
  interface PluginState {
    ebb: { view: Shaped<View>; spinner: Shaped<string | null> }
  }
}
