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

/** What the pane of `/ebb add` shows. */
export type View = {
  deck: string
  topic: string
  candidates: Candidate[]
  status?: string
  newDeck?: NewDeck
}

/** The card the band above the prompt shows. */
export type Band = { cardId: string | null; isRevealed: boolean; shownAt: number }

declare module 'claude-code' {
  interface PluginState {
    ebb: { view: Shaped<View | null>; band: Shaped<Band>; hidden: Shaped<boolean> }
  }
}
