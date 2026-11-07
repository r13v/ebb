import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import {
  type Band,
  candidateLine,
  createSession,
  dataDir,
  type Host,
  tickedCount,
  toggleCandidate,
  type View,
} from '../core/ebb'
import type { Rating } from '../core/fsrs'

type $ = EngineInterface

const PANE = 'ebb'
const MODEL = 'sonnet'

// The pane of `/ebb add`; null while it shows nothing.
const view = atom({ plugin: 'ebb', key: 'view' } as const, null as View | null, { shape: 'view-2' })

// The card above the prompt, as the session chose it; a state value, so a change redraws the band. The
// band draws the session's own card, not this value: `$.state` is per conversation, and a `/clear`
// starts a new one at its default with no `session.start`, while this module and its session go on.
const band = atom({ plugin: 'ebb', key: 'band' } as const, { cardId: null, isRevealed: false, shownAt: 0 } as Band, {
  shape: 'band-1',
})

// Whether the person hid the band with the footer button; kept in `$.store` across sessions. The state
// value redraws the band; the module's copy decides, for the same reason as the card.
const isHidden = atom({ plugin: 'ebb', key: 'hidden' } as const, false, { shape: 'hidden-1' })
const HIDDEN_KEY = 'hidden'
let hidden = false

const toggleBand = async ($: $) => {
  hidden = !hidden
  await update($, isHidden, () => hidden)
  await $.store.set(HIDDEN_KEY, hidden)
}

const session = createSession()

let paths: { home: string; dir: string } | undefined

/** The shared session's `Host` over `$`: files, processes, the clock, the model and the band. */
const hostOf = async ($: $): Promise<Host> => {
  if (!paths) {
    const home = await $.env.get('HOME')
    if (!home) throw new Error('HOME не задан')
    paths = { home, dir: dataDir(home, await $.env.get('XDG_DATA_HOME')) }
  }
  const run = async (...argv: string[]) => (await $.process.run(argv)).exitCode === 0

  return {
    ...paths,
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    mtimeMs: async path => (await $.fs.stat(path)).mtimeMs,
    mkdir: path => run('/bin/mkdir', path),
    mkdirp: async path => void (await run('/bin/mkdir', '-p', path)),
    rename: (from, to) => run('/bin/mv', from, to),
    remove: async path => void (await run('/bin/rm', '-rf', path)),
    sleep: ms => $.clock.sleep(ms),
    fetch: url => $.http.fetch(url),
    complete: async request => {
      const r = await $.model.complete({ model: MODEL, ...request })
      return r.isAnswered ? { text: r.text } : { error: r.reason }
    },
    showBand: async next => void (await update($, band, () => next)),
  }
}

const showNextCard = async ($: $, previous?: string, isRepick = false) => {
  const error = await session.showNextCard(await hostOf($), previous, isRepick)
  if (error) $.ui.log(`ebb: ${error}`, { to: 'debug' })
}

const gradeCurrent = async ($: $, rating: Rating) => {
  try {
    await session.gradeCard(await hostOf($), rating)
  } catch (error) {
    $.ui.toast(`ebb: the grade was not saved: ${String(error)}`)
  }
}

// Two grades, Again and Good: whether the person recalled the card is what FSRS needs most.
// Letters, not digits: a bare digit in an empty prompt presses a band Button, and the band never takes the prompt's keys.
const GRADES = [
  { rating: 1, hotkey: 'f', label: 'Forgot' },
  { rating: 3, hotkey: 'g', label: 'Got it' },
] as const

/** The card in the band, or nothing while the cards are paused or none is chosen. */
const cardTree = async ($: $, { Box, Text, Button }: ReturnType<$['ui']['resolve']>) => {
  // Reading the state value subscribes the band to it, so a new card redraws it.
  await read($, band)
  const v = await session.bandView(await hostOf($))
  if (v.kind === 'error') return <Text color="red">ebb: cannot read the data: {v.error}</Text>
  if (v.kind === 'no-deck')
    return <Text dimColor>ebb: /ebb add &lt;topic&gt; or /ebb install &lt;file or URL&gt; to get cards</Text>
  if (v.kind === 'none') return undefined

  const f = v.face
  if (v.isRevealed)
    return (
      <Box gap={2} flexWrap="wrap">
        <Text>
          <Text bold>{f.ask}</Text> — {f.answer}
          {f.hint && <Text dimColor> ({f.hint})</Text>}
        </Text>
        <Text dimColor>│</Text>
        <Button
          key="next"
          hotkey="f"
          plain
          variant="primary"
          label="Next"
          onPress={async () => session.next(await hostOf($))}
        />
      </Box>
    )

  return (
    <Box gap={2} flexWrap="wrap">
      <Text bold>{f.ask}</Text>
      <Text dimColor>│</Text>
      {GRADES.map(g => (
        <Button
          key={`g${g.rating}`}
          hotkey={g.hotkey}
          plain
          label={g.label}
          onPress={() => void gradeCurrent($, g.rating)}
        />
      ))}
      <Button key="skip" hotkey="s" plain label="Skip" onPress={async () => session.skip(await hostOf($))} />
    </Box>
  )
}

// ---------- adding notes ----------

const setAdd = ($: $, change: Partial<View>) => update($, view, old => (old ? { ...old, ...change } : old))

/**
 * `/ebb add [@deck] <topic>`. An existing deck is used as it is. A new deck gets its languages
 * from the request and the person's recent messages; when their own language is unclear, the
 * pane asks for it once. The new deck is saved with its first notes, so a cancel leaves nothing.
 */
const startAdd = async ($: $, args: string) => {
  const host = await hostOf($)
  const plan = await session.planAdd(host, args)
  if ('text' in plan) return plan.text

  await update($, view, () => plan.view)
  await $.ui.open({ id: PANE, title: 'ebb · new notes', focus: true, closeOnEscape: true })
  const onStatus = (status: string) => setAdd($, { status })
  void (async () => {
    if (plan.deck) return setAdd($, await session.draftNotes(host, plan.deck, plan.view.topic, onStatus))
    const newDeck = await session.askDeck(host, args, plan.named)
    await setAdd($, { deck: newDeck.id, newDeck, status: undefined })
    if (newDeck.learn && !newDeck.native) return void (await $.ui.focus({ requestId: PANE, key: 'native' }))
    await setAdd($, await session.draftNotes(host, newDeck, plan.view.topic, onStatus))
  })().catch(error => setAdd($, { status: `Error: ${String(error)}` }))
  return `Writing notes for "${plan.view.topic}". They open in the ebb pane.`
}

const setNative = async ($: $, native: string) => {
  const v = await read($, view)
  if (!v?.newDeck || !native.trim()) return
  const newDeck = { ...v.newDeck, native: native.trim() }
  await setAdd($, { newDeck })
  await setAdd($, await session.draftNotes(await hostOf($), newDeck, v.topic, status => setAdd($, { status })))
}

const commitAdd = async ($: $) => {
  const v = await read($, view)
  if (!v) return
  const added = await session.commitAdd(await hostOf($), v)
  await $.ui.close({ id: PANE })
  await update($, view, () => null)
  $.ui.toast(`ebb: notes added: ${added}`)
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    hidden = (await $.store.get(HIDDEN_KEY)) === true
    await update($, isHidden, () => hidden)
    await showNextCard($)
    await $.command.register({
      name: 'ebb',
      description: 'Spaced repetition above the prompt: add, install, decks, pause, stats',
      argumentHint: '[add <topic> | install <file or URL> | decks | pause 1h | stats]',
    })
    return started
  })

  on('command.run', { command: 'ebb' }, async ($, e) => {
    const run = async () => session.runCommand(await hostOf($), e.args, tail => startAdd($, tail))
    const text = await run().catch(error => `ebb: ${String(error)}`)
    return { text }
  })

  on('prompt.submit', async (_, e, next) => {
    if (!e.command) session.notePrompt(e.text)
    return next(e)
  })

  // A card may have come due while Claude worked; an open answer stays as it is.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await session.endTurn(await hostOf($))
    return next(e)
  })

  // The footer button beside the mode labels shows or hides the band.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const rest = await next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        {rest}
        <Button key="ebb-band" label="🌊 ebb" plain onPress={() => void toggleBand($)} />
      </Box>
    )
  })

  // The band is shared: what the plugins beneath draw (`next(e)`) stays, and the card goes under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, isHidden)
    if (e.props.hasSurvey || hidden) return next(e)

    const rest = await next(e)
    const card = await cardTree($, $.ui.resolve(e))
    if (!card) return rest

    const { Box } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rest}
        <Box marginTop={1}>{card}</Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const v = await read($, view)
    if (!v) return <Text dimColor>Nothing to add. Use /ebb add &lt;topic&gt;.</Text>

    const toggle = (i: number) => void update($, view, old => (old ? toggleCandidate(old, i) : old))
    const newDeck = v.newDeck
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>New notes: {v.topic}</Text>
        {v.status && <Text dimColor>{v.status}</Text>}
        {newDeck?.learn && !newDeck.native && (
          <Input
            key="native"
            label={`Translate ${newDeck.learn} into which language?`}
            placeholder="for example: English"
            autoFocus
            onSubmit={value => void setNative($, value)}
          />
        )}
        <Box flexDirection="column">
          {v.candidates.map((c, i) => (
            <Button key={`c${i}`} hotkey={String(i + 1)} onPress={() => toggle(i)}>
              {candidateLine(c)}
            </Button>
          ))}
        </Box>
        {v.candidates.length > 0 && (
          <Box gap={2}>
            <Button key="add" hotkey="a" variant="primary" onPress={() => void commitAdd($)}>
              Add ticked ({tickedCount(v)})
            </Button>
            <Button key="cancel" hotkey="x" onPress={() => void $.ui.close({ id: PANE })}>
              Cancel
            </Button>
          </Box>
        )}
      </Box>
    )
  })
}
