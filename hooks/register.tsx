import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { Band, Candidate, NewDeck, View } from '../types'
import { parseDeckFile } from './decks'
import { formatDelay, type Rating, scheduler } from './fsrs'
import {
  backTranslationPrompt,
  deckPrompt,
  flagMismatches,
  generationPrompt,
  parseDeckReply,
  parseNotes,
} from './generate'
import {
  addNotes,
  counts,
  type Data,
  type Deck,
  emptyData,
  ensureDeck,
  face,
  grade,
  type MonthLog,
  monthKey,
  nextCard,
  parseDuration,
  upgrade,
} from './model'

type $ = EngineInterface

const PANE = 'ebb'
const MODEL = 'sonnet'

// The pane of `/ebb add`; null while it shows nothing.
const view = atom({ plugin: 'ebb', key: 'view' } as const, null as View | null, { shape: 'view-2' })

// The card above the prompt; a state value, so a change redraws the band.
const band = atom({ plugin: 'ebb', key: 'band' } as const, { cardId: null, isRevealed: false, shownAt: 0 } as Band, {
  shape: 'band-1',
})

// Whether the person hid the band with the footer button; kept in `$.store` across sessions.
const isHidden = atom({ plugin: 'ebb', key: 'hidden' } as const, false, { shape: 'hidden-1' })
const HIDDEN_KEY = 'hidden'

const toggleBand = async ($: $) => {
  const hidden = !(await read($, isHidden))
  await update($, isHidden, () => hidden)
  await $.store.set(HIDDEN_KEY, hidden)
}

// One id per loaded module: this session's own log file, which no other session writes.
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// ---------- files ----------

let home: string | undefined
const homeDir = async ($: $) => {
  home ??= await $.env.get('HOME')
  if (!home) throw new Error('HOME не задан')
  return home
}
const dir = async ($: $) => `${await homeDir($)}/.claude/ebb`
const dataPath = async ($: $) => `${await dir($)}/data.json`

let cache: { data: Data; mtimeMs: number } | undefined

/** The data as on disk, read again only when another session changed the file. */
const load = async ($: $): Promise<Data> => {
  const path = await dataPath($)
  if (!(await $.fs.exists(path))) {
    cache = { data: emptyData(), mtimeMs: 0 }
    return cache.data
  }
  const { mtimeMs } = await $.fs.stat(path)
  if (cache && cache.mtimeMs === mtimeMs) return cache.data
  const data = upgrade(JSON.parse(await $.fs.read(path)) as Data)
  cache = { data, mtimeMs }
  return data
}

const LOCK_STALE_MS = 10_000

/**
 * Runs `work` under the lock of `~/.claude/ebb`, so two sessions never lose each other's writes.
 * `mkdir` takes the lock atomically and an owner file inside names who holds it.
 * A lock older than 10 s is taken as left by a dead session: it is renamed away first,
 * so only one waiter removes it.
 */
const withLock = async <T,>($: $, work: () => Promise<T>): Promise<T> => {
  const root = await dir($)
  const lock = `${root}/lock`
  const token = `${sessionId}-${Math.random().toString(36).slice(2, 8)}`
  await $.process.run(['/bin/mkdir', '-p', root])
  for (let waited = 0; ; waited += 100) {
    if ((await $.process.run(['/bin/mkdir', lock])).exitCode === 0) break
    const held = await $.fs.stat(lock).catch(() => undefined)
    if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
      const aside = `${lock}.stale-${token}`
      if ((await $.process.run(['/bin/mv', lock, aside])).exitCode === 0) await $.process.run(['/bin/rm', '-rf', aside])
      continue
    }
    if (waited > LOCK_STALE_MS + 2_000) throw new Error('данные заняты другой сессией, попробуйте ещё раз')
    await $.clock.sleep(100)
  }
  await $.fs.write(`${lock}/owner`, token)
  try {
    return await work()
  } finally {
    const owner = await $.fs.read(`${lock}/owner`).catch(() => undefined)
    if (owner === token) await $.process.run(['/bin/rm', '-rf', lock])
  }
}

/** Replaces a file by an atomic rename, so a reader never sees half of it. */
const replaceFile = async ($: $, path: string, text: string) => {
  await $.fs.write(`${path}.tmp`, text)
  const moved = await $.process.run(['/bin/mv', `${path}.tmp`, path])
  if (moved.exitCode !== 0) throw new Error(`не удалось сохранить ${path}: ${moved.stderr}`)
}

/** Changes `data.json` under the lock, on a copy read again inside it. */
const mutate = <T,>($: $, change: (data: Data) => T): Promise<T> =>
  withLock($, async () => {
    try {
      cache = undefined
      const data = await load($)
      const result = change(data)
      const path = await dataPath($)
      await replaceFile($, path, JSON.stringify(data))
      cache = { data, mtimeMs: (await $.fs.stat(path)).mtimeMs }
      return result
    } catch (error) {
      cache = undefined
      throw error
    }
  })

let log: { key: string; value: MonthLog } | undefined
let logWrite: Promise<void> = Promise.resolve()

/** Appends a review to this session's own log for the month. */
const appendLog = async ($: $, review: MonthLog['reviews'][number]) => {
  const path = `${await dir($)}/log/${monthKey(review.ts)}/${sessionId}.json`
  if (log?.key !== path) log = { key: path, value: { reviews: [] } }
  log.value.reviews.push(review)
  const text = JSON.stringify(log.value)
  // Writes go one after another, so an older snapshot never lands after a newer one.
  logWrite = logWrite.catch(() => undefined).then(() => $.fs.write(path, text))
  await logWrite
}

// ---------- decks ----------

/**
 * `/ebb install <path or URL>`: adds a deck file. Installing it again adds the notes that are
 * new and the meanings that are new; cards keep their schedule.
 */
const installDeck = async ($: $, where: string): Promise<string> => {
  if (!where) return 'Name a deck file or URL: /ebb install ~/decks/spanish.json'
  let source: string
  if (/^https?:\/\//.test(where)) {
    const r = await $.http.fetch(where)
    if (!r.ok) return `Could not download the deck: HTTP ${r.status}`
    source = r.text
  } else {
    const path = where.startsWith('~/') ? `${await homeDir($)}${where.slice(1)}` : where
    if (!(await $.fs.exists(path))) return `No file ${path}`
    source = await $.fs.read(path)
  }
  const file = parseDeckFile(source)
  if ('error' in file) return `Not a deck: ${file.error}`
  const added = await mutate($, d => {
    ensureDeck(d, file.deck)
    return addNotes(d, file.deck.id, file.notes, `install: ${where}`, Date.now(), true)
  })
  await showNextCard($)
  return `Installed ${file.deck.name}: ${added} new notes. Its cards show above the prompt.`
}

const listDecks = async ($: $): Promise<string> => {
  const data = await load($)
  const now = Date.now()
  const rows = Object.values(data.decks).map(d => {
    const cards = Object.values(data.cards).filter(c => data.notes[c.note]?.deck === d.id)
    const due = cards.filter(c => c.state !== 0 && c.due <= now).length
    const fresh = cards.filter(c => c.state === 0).length
    return `${d.id} — ${d.name}: ${cards.length} cards, ${due} due, ${fresh} new`
  })
  return [
    ...(rows.length ? rows : ['No deck yet.']),
    '',
    'Make one: /ebb add <topic>. Install one: /ebb install <file or URL>.',
  ].join('\n')
}

// ---------- the band above the prompt ----------

// Cards skipped in this session; they come back when nothing else is left.
const skipped = new Set<string>()

// New and due cards take turns (`nextCard`). `chosenWith` is the turn of the card in the band,
// `wasNew` whether that card was new: the next pick takes the other turn.
let chosenWith = false
let wasNew = false

/**
 * Puts the next card in the band, with its answer hidden. `previous`, the card just graded or
 * skipped, never comes straight back while another card is left. `isRepick` chooses again for
 * the same turn, so a card that came due can take the band's place without moving the turns.
 */
const showNextCard = async ($: $, previous?: string, isRepick = false) => {
  try {
    const data = await load($)
    const now = Date.now()
    const avoid = previous ? [previous] : []
    const isNewTurn = isRepick ? chosenWith : !wasNew
    let card = nextCard(data, now, new Set([...skipped, ...avoid]), isNewTurn)
    if (!card) {
      skipped.clear()
      card = nextCard(data, now, new Set(avoid), isNewTurn) ?? nextCard(data, now)
    }
    chosenWith = isNewTurn
    wasNew = card?.state === 0
    await update($, band, (): Band => ({ cardId: card?.id ?? null, isRevealed: false, shownAt: now }))
  } catch (error) {
    await update($, band, (): Band => ({ cardId: null, isRevealed: false, shownAt: 0 }))
    $.ui.log(`ebb: ${String(error)}`, { to: 'debug' })
  }
}

const reveal = ($: $) => update($, band, old => ({ ...old, isRevealed: true }))

const skip = async ($: $) => {
  const { cardId } = await read($, band)
  if (cardId) skipped.add(cardId)
  await showNextCard($, cardId ?? undefined)
}

let isGrading = false

const gradeCurrent = async ($: $, rating: Rating) => {
  const b = await read($, band)
  if (isGrading || !b.cardId || !b.isRevealed) return
  isGrading = true // a second press while this one saves is ignored
  const cardId = b.cardId
  try {
    const graded = await mutate($, data => grade(data, cardId, rating, Date.now(), Math.random, Date.now() - b.shownAt))
    await appendLog($, graded.log)
    skipped.delete(cardId)
    await showNextCard($, cardId)
  } catch (error) {
    $.ui.toast(`ebb: the grade was not saved: ${String(error)}`)
  } finally {
    isGrading = false
  }
}

// Two grades, Again and Good: whether the person recalled the card is what FSRS needs most.
// Letters, not digits: a bare digit in an empty prompt presses a band Button, and the band never takes the prompt's keys.
const GRADES: Partial<Record<Rating, { hotkey: string; label: string }>> = {
  1: { hotkey: 'f', label: 'Forgot' },
  3: { hotkey: 'g', label: 'Got it' },
}

/** The card in the band, or nothing while the cards are paused or none is chosen. */
const cardTree = async ($: $, { Box, Text, Button }: ReturnType<$['ui']['resolve']>) => {
  let data: Data
  try {
    data = await load($)
  } catch (error) {
    return <Text color="red">ebb: cannot read the data: {String(error)}</Text>
  }
  if (!Object.keys(data.decks).length)
    return <Text dimColor>ebb: /ebb add &lt;topic&gt; or /ebb install &lt;file or URL&gt; to get cards</Text>

  const now = Date.now()
  const b = await read($, band)
  const card = b.cardId ? data.cards[b.cardId] : undefined
  const f = card && face(data, card)
  if ((data.meta.pausedUntil ?? 0) > now || !f) return undefined

  if (!b.isRevealed)
    return (
      <Box gap={2} flexWrap="wrap">
        <Text bold>{f.ask}</Text>
        <Text dimColor>│</Text>
        <Button key="show" hotkey="r" plain variant="primary" label="Show" onPress={() => void reveal($)} />
        <Button key="skip" hotkey="s" plain label="Skip" onPress={() => void skip($)} />
      </Box>
    )

  const intervals = scheduler().preview(f.card, now)
  return (
    <Box gap={2} flexWrap="wrap">
      <Text>
        <Text bold>{f.ask}</Text> — {f.answer}
        {f.hint && <Text dimColor> ({f.hint})</Text>}
      </Text>
      <Text dimColor>│</Text>
      {intervals.map(({ rating, due }) => {
        const grade = GRADES[rating]
        return (
          grade && (
            <Button
              key={`g${rating}`}
              hotkey={grade.hotkey}
              plain
              label={`${grade.label} ${formatDelay(due - now)}`}
              onPress={() => void gradeCurrent($, rating)}
            />
          )
        )
      })}
    </Box>
  )
}

// ---------- adding notes ----------

// The person's last prompts: `/ebb add` reads their own language from them.
const recentPrompts: string[] = []

const setAdd = ($: $, change: Partial<View>) => update($, view, old => (old ? { ...old, ...change } : old))

/** The deck a new deck becomes: a language deck asks both ways, a deck of facts one way. */
const deckFrom = (d: NewDeck): Partial<Deck> & { id: string; name: string } =>
  d.learn ? { ...d, kinds: ['recognition', 'production'] } : { id: d.id, name: d.name, kinds: ['recognition'] }

const generate = async ($: $, deck: Deck | NewDeck, topic: string) => {
  const data = await load($)
  await setAdd($, { status: 'Writing notes…' })
  const existing = Object.values(data.notes)
    .filter(n => n.deck === deck.id)
    .map(n => n.front)
  const asDeck = { ...deckFrom(deck), ...deck } as Deck
  const made = await $.model.complete({
    model: MODEL,
    ...generationPrompt(asDeck, topic, existing),
    maxTokens: 3000,
    timeoutMs: 120_000,
  })
  if (!made.isAnswered) return setAdd($, { status: `The model did not answer: ${made.reason}` })
  const parsed = parseNotes(made.text)
  if ('error' in parsed) return setAdd($, { status: parsed.error })
  const notes = parsed.notes.slice(0, 9)
  const known = new Set(existing.map(f => f.toLowerCase()))
  let candidates = notes.map(n => ({ ...n, isChecked: true }))
  let status: string | undefined
  if (deck.learn) {
    await setAdd($, { status: 'Checking by back-translation…' })
    const checked = await $.model.complete({
      model: MODEL,
      ...backTranslationPrompt(asDeck, notes),
      maxTokens: 1500,
      timeoutMs: 60_000,
    })
    candidates = flagMismatches(notes, checked.isAnswered ? checked.text : '')
    if (!checked.isAnswered) {
      // Without a back-translation nothing is checked: every note starts unticked, and the status says why.
      candidates = candidates.map(c => ({ ...c, isChecked: false }))
      status = 'The back-translation failed: check the notes yourself and tick the good ones'
    }
  }
  candidates = candidates.map(c =>
    known.has(c.front.toLowerCase()) ? { ...c, isDuplicate: true, isChecked: false } : c,
  )
  await setAdd($, { candidates, status })
}

/**
 * `/ebb add [@deck] <topic>`. An existing deck is used as it is. A new deck gets its languages
 * from the request and the person's recent messages; when their own language is unclear, the
 * pane asks for it once. The new deck is saved with its first notes, so a cancel leaves nothing.
 */
const startAdd = async ($: $, args: string) => {
  const named = /^@([\w-]+)\s+(.+)$/u.exec(args)
  const topic = named ? named[2]! : args
  const data = await load($)
  const decks = Object.values(data.decks)
  const onlyDeck = decks.length === 1 ? decks[0] : undefined
  const existing = named ? data.decks[named[1]!] : onlyDeck
  if (!named && decks.length > 1)
    return `Name the deck: /ebb add @<deck> ${topic}. Decks: ${decks.map(d => d.id).join(', ')}.`
  await update(
    $,
    view,
    (): View => ({
      deck: existing?.id ?? named?.[1] ?? '',
      topic,
      candidates: [],
      status: 'Reading the request…',
    }),
  )
  await $.ui.open({ id: PANE, title: 'ebb · new notes', focus: true, closeOnEscape: true })
  void (async () => {
    if (existing) return generate($, existing, topic)
    const r = await $.model.complete({
      model: MODEL,
      ...deckPrompt(args, recentPrompts),
      maxTokens: 300,
      timeoutMs: 60_000,
    })
    const reply = r.isAnswered ? parseDeckReply(r.text) : undefined
    const newDeck: NewDeck = {
      id: named?.[1] ?? reply?.id ?? 'notes',
      name: reply?.name ?? named?.[1] ?? 'Notes',
      learn: reply?.learn ?? undefined,
      native: reply?.native ?? undefined,
    }
    await setAdd($, { deck: newDeck.id, newDeck, status: undefined })
    if (newDeck.learn && !newDeck.native) return void (await $.ui.focus({ requestId: PANE, key: 'native' }))
    await generate($, newDeck, topic)
  })().catch(error => setAdd($, { status: `Error: ${String(error)}` }))
  return `Writing notes for "${topic}". They open in the ebb pane.`
}

const setNative = async ($: $, native: string) => {
  const v = await read($, view)
  if (!v?.newDeck || !native.trim()) return
  const newDeck = { ...v.newDeck, native: native.trim() }
  await setAdd($, { newDeck })
  await generate($, newDeck, v.topic)
}

const commitAdd = async ($: $) => {
  const v = await read($, view)
  if (!v) return
  const chosen = v.candidates.filter(c => c.isChecked && !c.isDuplicate)
  const added = await mutate($, data => {
    if (v.newDeck) ensureDeck(data, deckFrom(v.newDeck))
    return addNotes(data, v.deck, chosen, `ebb add: ${v.topic}`, Date.now())
  })
  await $.ui.close({ id: PANE })
  await update($, view, () => null)
  await showNextCard($)
  $.ui.toast(`ebb: notes added: ${added}`)
}

// ---------- commands ----------

/** The mark of a candidate in the list of `/ebb add`. */
const checkbox = (c: Candidate) => {
  if (c.isDuplicate) return '[have]'

  return c.isChecked ? '[x]' : '[ ]'
}

const HELP = `/ebb decks — your decks
/ebb install <file or URL> — add a deck file
/ebb add [@deck] <topic or word list> — write new notes with Claude; a new @deck is made on first use
/ebb pause [1h|30m|2d|off] — no card above the prompt for a while
/ebb stats — notes, due cards and new cards`

const stats = async ($: $) => {
  const data = await load($)
  const c = counts(data, Date.now())
  const paused = (data.meta.pausedUntil ?? 0) > Date.now() ? ' · paused' : ''

  return `Notes: ${Object.keys(data.notes).length} · due: ${c.due} · new: ${c.new}${paused}`
}

const pause = async ($: $, tail: string) => {
  if (tail === 'off') {
    await mutate($, data => void delete data.meta.pausedUntil)
    return 'Cards are back above the prompt.'
  }
  const ms = tail ? parseDuration(tail) : 3_600_000
  if (!ms) return 'Use /ebb pause 1h, 30m, 2d or off'

  const until = Date.now() + ms
  await mutate($, data => {
    data.meta.pausedUntil = until
  })

  return `Paused until ${new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
}

const runCommand = async ($: $, args: string): Promise<string> => {
  const [sub = '', ...rest] = args.trim().split(/\s+/)
  const tail = rest.join(' ')
  switch (sub) {
    case 'decks':
      return listDecks($)
    case 'install':
      return installDeck($, tail)
    case 'add':
      return tail ? startAdd($, tail) : 'Name a topic: /ebb add ordering at a bar'
    case 'pause':
      return pause($, tail)
    case 'stats':
      return stats($)
    default:
      return `${await stats($)}\n\n${HELP}`
  }
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const hidden = (await $.store.get(HIDDEN_KEY)) === true
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
    const text = await runCommand($, e.args).catch(error => `ebb: ${String(error)}`)
    return { text }
  })

  on('prompt.submit', async (_, e, next) => {
    if (!e.command && !e.text.trimStart().startsWith('/')) {
      recentPrompts.push(e.text.slice(0, 300))
      if (recentPrompts.length > 3) recentPrompts.shift()
    }
    return next(e)
  })

  // A card may have come due while Claude worked; an open answer stays as it is.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && !(await read($, band)).isRevealed) await showNextCard($, undefined, true)
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
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const rest = await next(e)
    const card = await cardTree($, $.ui.resolve(e))
    if (!card) return rest

    const { Box } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rest}
        {card}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const v = await read($, view)
    if (!v) return <Text dimColor>Nothing to add. Use /ebb add &lt;topic&gt;.</Text>

    const toggle = (i: number) =>
      void update($, view, old =>
        old
          ? {
              ...old,
              candidates: old.candidates.map((c, j) =>
                j === i && !c.isDuplicate ? { ...c, isChecked: !c.isChecked } : c,
              ),
            }
          : old,
      )
    const chosen = v.candidates.filter(c => c.isChecked && !c.isDuplicate).length
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
              {checkbox(c)} {c.front} — {c.back}
              {c.hint ? ` (${c.hint})` : ''}
              {c.flag ? ` ⚠ ${c.flag}` : ''}
            </Button>
          ))}
        </Box>
        {v.candidates.length > 0 && (
          <Box gap={2}>
            <Button key="add" hotkey="a" variant="primary" onPress={() => void commitAdd($)}>
              Add ticked ({chosen})
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
