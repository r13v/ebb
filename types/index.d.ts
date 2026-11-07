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

/** A deck `/ebb add` makes when the person adds its first notes; `native` is asked when the request does not show it. */
export type NewDeck = { id: string; name: string; learn?: string; native?: string }

/** What the study pane shows. */
export type View =
  | {
      mode: 'study'
      cardId: string | null
      isRevealed: boolean
      shownAt: number
      isAsking: boolean
      reply?: string
      note?: string
    }
  | { mode: 'add'; deck: string; topic: string; candidates: Candidate[]; status?: string; newDeck?: NewDeck }

declare module 'claude-code' {
  interface PluginState {
    ebb: { view: Shaped<View>; spinner: Shaped<string | null> }
  }
}
