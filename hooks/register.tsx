import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NewDeck, View } from '../types'
import { formatDelay, scheduler, type Rating } from './fsrs'
import { BUNDLED } from '../decks'
import { notesOf, type BundledDeck } from './decks'
import { backTranslationPrompt, deckPrompt, flagMismatches, generationPrompt, parseDeckReply, parseNotes, questionPrompt } from './generate'
import {
  addNotes,
  counts,
  emptyData,
  ensureDeck,
  face,
  grade,
  monthKey,
  newLeftToday,
  nextStudyCard,
  parseDuration,
  pickSpinnerCard,
  upgrade,
  passiveKey,
  type Data,
  type Passive,
  type Face,
  type MonthLog,
  type Deck,
  type NoteInput,
} from './model'

type $ = EngineInterface

const PANE = 'ebb'
const MODEL = 'sonnet'
const view = atom({ plugin: 'ebb', key: 'view' } as const, { mode: 'study', cardId: null, isRevealed: false, shownAt: 0, isAsking: false } as View, {
  shape: 'view-1',
})

// The word the spinner draws this turn; a state value, so a change redraws the spinner.
const spinnerWord = atom({ plugin: 'ebb', key: 'spinner' } as const, null as string | null, { shape: 'spinner-1' })

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
const passivePath = async ($: $) => `${await dir($)}/passive.json`

let cache: { data: Data; mtimeMs: number } | undefined

/** The data as on disk, read again only when another session changed the file. */
const load = async ($: $): Promise<Data> => {
  const path = await dataPath($)
  if (!(await $.fs.exists(path))) return (cache = { data: emptyData(), mtimeMs: 0 }).data
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

/** Counts one spinner showing in `passive.json`, a small file of its own, so a turn never rewrites `data.json`. */
const countShowing = ($: $, key: string) =>
  withLock($, async () => {
    const path = await passivePath($)
    const passive: Passive = (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {}
    passive[key] = (passive[key] ?? 0) + 1
    await replaceFile($, path, JSON.stringify(passive))
  })

let log: { key: string; value: MonthLog } | undefined
let logWrite: Promise<void> = Promise.resolve()

/** Appends to this session's own log for the month: exposures and reviews. */
const appendLog = async ($: $, entry: Partial<MonthLog>) => {
  const now = Date.now()
  const path = `${await dir($)}/log/${monthKey(now)}/${sessionId}.json`
  if (log?.key !== path) log = { key: path, value: { reviews: [], exposures: [] } }
  log.value.reviews.push(...(entry.reviews ?? []))
  log.value.exposures.push(...(entry.exposures ?? []))
  const text = JSON.stringify(log.value)
  // Writes go one after another, so an older snapshot never lands after a newer one.
  logWrite = logWrite.catch(() => undefined).then(() => $.fs.write(path, text))
  await logWrite
}

// ---------- bundled decks ----------

const deckOf = (m: BundledDeck): Partial<Deck> & { id: string; name: string } => ({
  id: m.id,
  name: m.name,
  learn: m.learn,
  native: m.native,
  guidance: m.guidance,
  isBundled: true,
  kinds: m.learn ? ['recognition', 'production'] : ['recognition'],
})

/**
 * Adds to each bundled deck the person uses the notes a newer version of ebb brings.
 * A word that is in two lists gets the meanings of both. The file is written only on a change.
 */
const syncBundled = async ($: $) => {
  const data = await load($)
  const used = BUNDLED.filter(b => data.decks[b.id]?.isBundled)
  if (!used.length) return
  const apply = (d: Data) => used.forEach(b => addNotes(d, b.id, notesOf(b), 'bundled', Date.now(), true))
  const current = JSON.stringify(data)
  const trial = JSON.parse(current) as Data
  apply(trial)
  if (JSON.stringify(trial) !== current) await mutate($, apply)
}

const deckCommand = async ($: $, id: string): Promise<string> => {
  const data = await load($)
  if (!id) {
    const rows = BUNDLED.map(b => `${data.decks[b.id] ? '✓' : ' '} ${b.id} — ${b.name}. ${b.description}`)
    const own = Object.values(data.decks)
      .filter(d => !d.isBundled)
      .map(d => `✓ ${d.id} — ${d.name}`)
    return [...rows, ...own, '', 'Add one: /ebb deck <id>. Make your own: /ebb add <topic>.'].join('\n')
  }
  const chosen = BUNDLED.find(b => b.id === id)
  if (!chosen) return `No deck "${id}". See /ebb deck.`
  const added = await mutate($, d => {
    ensureDeck(d, deckOf(chosen))
    return addNotes(d, id, notesOf(chosen), 'bundled', Date.now(), true)
  })
  return `Added ${chosen.name}: ${added} notes. Cards start showing in the spinner; review them with /ebb.`
}

// ---------- spinner and end of turn ----------

type Reveal = { face: Face; due: number } | { hint: string }
let current: Reveal | undefined
let pending: Reveal | undefined
const reveals = new Map<string, Reveal | null>()

let isChosenForTurn = false
let isTurnRunning = false
let lastShownId: string | undefined
const recentPrompts: string[] = []

/** Chooses this turn's card, logs the exposure, and keeps its reveal for the turn line. */
const showNextCard = async ($: $) => {
  try {
    const data = await load($)
    const now = Date.now()
    if (!Object.keys(data.decks).length) {
      // No deck yet: say once, on a turn line, how to get one.
      if (!(await $.store.get('hinted'))) {
        await $.store.set('hinted', true)
        pending = { hint: 'ebb: /ebb deck to pick a deck' }
      }
      return
    }
    const path = await passivePath($)
    const passive: Passive = (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {}
    const picked = pickSpinnerCard(data, passive, now, lastShownId, Math.random)
    if (picked) {
      lastShownId = picked.card.id
      await countShowing($, passiveKey(picked.card))
    }
    current = picked && { face: picked, due: counts(data, now).due }
    pending = current
    await update($, spinnerWord, () => picked?.ask ?? null)
    if (picked) await appendLog($, { exposures: [{ ts: now, card: picked.card.id }] })
  } catch (error) {
    current = pending = undefined
    await update($, spinnerWord, () => null)
    $.ui.log(`ebb: ${String(error)}`, { to: 'debug' })
  }
}

const durationText = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// ---------- study pane ----------

const openStudy = async ($: $, note?: string) => {
  const data = await load($)
  const card = nextStudyCard(data, Date.now())
  await update($, view, (): View => ({ mode: 'study', cardId: card?.id ?? null, isRevealed: false, shownAt: Date.now(), isAsking: false, note }))
  await $.ui.open({ id: PANE, title: 'ebb', focus: true, closeOnEscape: true })
}

let isGrading = false

const gradeCurrent = async ($: $, rating: Rating) => {
  const v = await read($, view)
  if (isGrading || v.mode !== 'study' || !v.cardId || !v.isRevealed) return
  isGrading = true // a second press while this one saves is ignored
  const cardId = v.cardId
  try {
    const graded = await mutate($, data => grade(data, cardId, rating, Date.now(), Math.random, Date.now() - v.shownAt))
    await appendLog($, { reviews: [graded.log] })
    const data = await load($)
    const next = nextStudyCard(data, Date.now(), cardId)
    const note = graded.unlocked ? `New reverse card: ${face(data, graded.unlocked)?.ask}` : undefined
    await update($, view, (): View => ({ mode: 'study', cardId: next?.id ?? null, isRevealed: false, shownAt: Date.now(), isAsking: false, note }))
  } catch (error) {
    await update($, view, old => (old.mode === 'study' ? { ...old, note: `The grade was not saved: ${String(error)}` } : old))
  } finally {
    isGrading = false
  }
}

const askQuestion = async ($: $, question: string) => {
  const v = await read($, view)
  if (v.mode !== 'study' || !v.cardId || !question.trim()) return
  const data = await load($)
  const card = data.cards[v.cardId]
  const f = card && face(data, card)
  if (!f) return
  await update($, view, old => (old.mode === 'study' ? { ...old, isAsking: false, reply: '…' } : old))
  const deck = data.decks[f.note.deck]!
  const r = await $.model
    .complete({ model: MODEL, ...questionPrompt(deck, f.ask, f.answer, f.hint, question), maxTokens: 600, timeoutMs: 60_000 })
    .catch((error: unknown) => ({ isAnswered: false as const, reason: String(error) }))
  const reply = r.isAnswered ? r.text.trim() : `Could not ask: ${r.reason}`
  await update($, view, old => (old.mode === 'study' && old.cardId === v.cardId ? { ...old, reply } : old))
}

/** Shows the question field and moves the keys into it, so typing never lands in the prompt. */
const startAsking = async ($: $) => {
  await update($, view, old => (old.mode === 'study' ? { ...old, isAsking: true, reply: undefined } : old))
  await $.ui.focus({ requestId: PANE, key: 'question' })
}

// ---------- adding notes ----------

const setAdd = ($: $, change: Partial<Extract<View, { mode: 'add' }>>) => update($, view, old => (old.mode === 'add' ? { ...old, ...change } : old))

/** The deck a new deck becomes: a language deck asks both ways, a deck of facts one way. */
const deckFrom = (d: NewDeck): Partial<Deck> & { id: string; name: string } =>
  d.learn ? { ...d, kinds: ['recognition', 'production'] } : { id: d.id, name: d.name, kinds: ['recognition'] }

const generate = async ($: $, deck: Deck | NewDeck, topic: string) => {
  const data = await load($)
  await setAdd($, { status: 'Writing notes…' })
  const existing = Object.values(data.notes).filter(n => n.deck === deck.id).map(n => n.front)
  const asDeck = { ...deckFrom(deck), ...deck } as Deck
  const made = await $.model.complete({ model: MODEL, ...generationPrompt(asDeck, topic, existing), maxTokens: 3000, timeoutMs: 120_000 })
  if (!made.isAnswered) return setAdd($, { status: `The model did not answer: ${made.reason}` })
  const parsed = parseNotes(made.text)
  if ('error' in parsed) return setAdd($, { status: parsed.error })
  const notes = parsed.notes.slice(0, 9)
  const known = new Set(existing.map(f => f.toLowerCase()))
  let candidates = notes.map(n => ({ ...n, isChecked: true }))
  let status: string | undefined
  if (deck.learn) {
    await setAdd($, { status: 'Checking by back-translation…' })
    const checked = await $.model.complete({ model: MODEL, ...backTranslationPrompt(asDeck, notes), maxTokens: 1500, timeoutMs: 60_000 })
    candidates = flagMismatches(notes, checked.isAnswered ? checked.text : '')
    if (!checked.isAnswered) {
      // Without a back-translation nothing is checked: every note starts unticked, and the status says why.
      candidates = candidates.map(c => ({ ...c, isChecked: false }))
      status = 'The back-translation failed: check the notes yourself and tick the good ones'
    }
  }
  candidates = candidates.map(c => (known.has(c.front.toLowerCase()) ? { ...c, isDuplicate: true, isChecked: false } : c))
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
  const existing = named ? data.decks[named[1]!] : decks.length === 1 ? decks[0] : undefined
  if (!named && decks.length > 1) return `Name the deck: /ebb add @<deck> ${topic}. Decks: ${decks.map(d => d.id).join(', ')}.`
  await update($, view, (): View => ({ mode: 'add', deck: existing?.id ?? named?.[1] ?? '', topic, candidates: [], status: 'Reading the request…' }))
  await $.ui.open({ id: PANE, title: 'ebb · new notes', focus: true, closeOnEscape: true })
  void (async () => {
    if (existing) return generate($, existing, topic)
    const r = await $.model.complete({ model: MODEL, ...deckPrompt(args, recentPrompts), maxTokens: 300, timeoutMs: 60_000 })
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
  if (v.mode !== 'add' || !v.newDeck || !native.trim()) return
  const newDeck = { ...v.newDeck, native: native.trim() }
  await setAdd($, { newDeck })
  await generate($, newDeck, v.topic)
}

const commitAdd = async ($: $) => {
  const v = await read($, view)
  if (v.mode !== 'add') return
  const chosen = v.candidates.filter(c => c.isChecked && !c.isDuplicate)
  const added = await mutate($, data => {
    if (v.newDeck) ensureDeck(data, deckFrom(v.newDeck))
    return addNotes(data, v.deck, chosen, `ebb add: ${v.topic}`, Date.now())
  })
  await openStudy($, `Notes added: ${added}`)
}

// ---------- commands ----------

const HELP = `/ebb — review cards
/ebb deck [id] — list the bundled decks, or add one
/ebb add [@deck] <topic or word list> — write new notes with Claude; a new @deck is made on first use
/ebb pause [1h|30m|2d|off] — no cards in the spinner for a while
/ebb stats — notes, due cards and new cards`

const runCommand = async ($: $, args: string): Promise<string | undefined> => {
  const [sub = '', ...rest] = args.trim().split(/\s+/)
  const tail = rest.join(' ')
  switch (sub) {
    case '':
      await openStudy($)
      return undefined
    case 'deck':
      return deckCommand($, tail)
    case 'add':
      return tail ? startAdd($, tail) : 'Name a topic: /ebb add ordering at a bar'
    case 'pause': {
      if (tail === 'off') {
        await mutate($, data => void delete data.meta.pausedUntil)
        return 'Cards are back in the spinner.'
      }
      const ms = tail ? parseDuration(tail) : 3_600_000
      if (!ms) return 'Use /ebb pause 1h, 30m, 2d or off'
      const until = Date.now() + ms
      await mutate($, data => void (data.meta.pausedUntil = until))
      return `Paused until ${new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
    }
    case 'stats': {
      const data = await load($)
      const c = counts(data, Date.now())
      const paused = (data.meta.pausedUntil ?? 0) > Date.now() ? ' · paused' : ''
      return `Notes: ${Object.keys(data.notes).length} · due: ${c.due} · new: ${c.new}${paused}`
    }
    default:
      return HELP
  }
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'ebb', description: 'Spaced repetition: review, deck, add, pause, stats', argumentHint: '[deck | add <topic> | pause 1h | stats]' })
    await syncBundled($).catch(error => $.ui.log(`ebb: deck update failed: ${String(error)}`, { to: 'debug' }))
    return started
  })

  on('command.run', { command: 'ebb' }, async ($, e) => {
    const text = await runCommand($, e.args).catch(error => `ebb: ${String(error)}`)
    return text === undefined ? {} : { text }
  })

  // The card is chosen when the prompt is sent, the start of the wait, and kept for the whole turn.
  on('prompt.submit', async ($, e, next) => {
    // A slash command starts no model turn of its own; a prompt queued during a turn keeps that turn's card.
    if (e.command || e.text.trimStart().startsWith('/') || isTurnRunning) return next(e)
    recentPrompts.push(e.text.slice(0, 300))
    if (recentPrompts.length > 3) recentPrompts.shift()
    await showNextCard($)
    isChosenForTurn = true
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (!isChosenForTurn) await showNextCard($) // a turn no prompt chose for, such as a queued prompt or a task notification
    isChosenForTurn = false
    isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = false
      current = undefined
      await update($, spinnerWord, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const word = await read($, spinnerWord)
    return word ? next({ ...e, props: { ...e.props, word } }) : next(e)
  })

  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.props.isExpanded || e.props.waitingFor) return next(e)
    if (!reveals.has(e.requestId)) {
      reveals.set(e.requestId, pending ?? null)
      pending = undefined
      if (reveals.size > 300) reveals.delete(reveals.keys().next().value!)
    }
    const reveal = reveals.get(e.requestId)
    if (!reveal) return next(e)
    const { Text } = $.ui.resolve(e)
    const line = `✻ ${e.props.word} for ${durationText(e.props.durationMs)} · `
    if ('hint' in reveal) return <Text dimColor>{line}{reveal.hint}</Text>
    const { ask, answer } = reveal.face
    return (
      <Text dimColor>
        {line}
        <Text dimColor={false}>{ask} — {answer}</Text>
        {reveal.due ? ` · ${reveal.due} due · /ebb` : ''}
      </Text>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const v = await read($, view)

    if (v.mode === 'add') {
      const toggle = (i: number) =>
        void update($, view, old =>
          old.mode === 'add' ? { ...old, candidates: old.candidates.map((c, j) => (j === i && !c.isDuplicate ? { ...c, isChecked: !c.isChecked } : c)) } : old,
        )
      const chosen = v.candidates.filter(c => c.isChecked && !c.isDuplicate).length
      const newDeck = v.newDeck
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>New notes: {v.topic}</Text>
          {v.status && <Text dimColor>{v.status}</Text>}
          {newDeck?.learn && !newDeck.native && (
            <Input key="native" label={`Translate ${newDeck.learn} into which language?`} placeholder="for example: English" autoFocus onSubmit={value => void setNative($, value)} />
          )}
          <Box flexDirection="column">
            {v.candidates.map((c, i) => (
              <Button key={`c${i}`} hotkey={String(i + 1)} onPress={() => toggle(i)}>
                {c.isDuplicate ? '[have]' : c.isChecked ? '[x]' : '[ ]'} {c.front} — {c.back}
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
    }

    let data: Data
    try {
      data = await load($)
    } catch (error) {
      return <Text color="red">ebb: cannot read the data: {String(error)}</Text>
    }
    const now = Date.now()
    const c = counts(data, now)
    const header = (
      <Text dimColor>
        due: {c.due} · new today: {Math.min(c.new, Object.values(data.decks).reduce((n, d) => n + newLeftToday(data, d, now), 0))}
        {(data.meta.pausedUntil ?? 0) > now ? ' · spinner paused' : ''}
      </Text>
    )
    if (!Object.keys(data.decks).length) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>No deck yet.</Text>
          <Text dimColor>Pick a bundled one with /ebb deck, or make your own with /ebb add &lt;topic&gt;.</Text>
        </Box>
      )
    }
    const card = v.cardId ? data.cards[v.cardId] : undefined
    const f = card && face(data, card)
    if (!f) {
      const soon = Object.values(data.cards)
        .filter(x => x.state !== 0)
        .sort((a, b) => a.due - b.due)[0]
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {v.note && <Text color="green">{v.note}</Text>}
          <Text bold>All done for now.</Text>
          {soon && <Text dimColor>Next review in {formatDelay(Math.max(0, soon.due - now))}.</Text>}
          <Text dimColor>New notes: /ebb add &lt;topic&gt;</Text>
        </Box>
      )
    }

    const deck = data.decks[f.note.deck]
    const intervals = scheduler().preview(f.card, now)
    const labels = ['Again', 'Hard', 'Good', 'Easy']
    const kind = f.card.kind === 'production' ? `say it in ${deck?.learn ?? 'the deck language'}` : deck?.learn ? 'what does it mean?' : 'recall the answer'
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {v.note && <Text color="green">{v.note}</Text>}
        <Box flexDirection="column">
          <Text dimColor>{kind}</Text>
          <Text bold>{f.ask}</Text>
          {v.isRevealed && <Text>{f.answer}</Text>}
          {v.isRevealed && f.hint && <Text dimColor>{f.hint}</Text>}
        </Box>
        {v.isAsking ? null : v.isRevealed ? (
          <Box gap={2} flexWrap="wrap">
            {intervals.map(({ rating, due }, i) => (
              <Button key={`g${rating}`} hotkey={String(rating)} autoFocus={rating === 3 ? true : undefined} onPress={() => void gradeCurrent($, rating)}>
                {labels[i]} {formatDelay(due - now)}
              </Button>
            ))}
          </Box>
        ) : (
          <Box gap={2}>
            <Button key="reveal" hotkey="r" variant="primary" autoFocus onPress={() => void update($, view, old => (old.mode === 'study' ? { ...old, isRevealed: true } : old))}>
              Show answer
            </Button>
            <Button key="ask" hotkey="q" onPress={() => void startAsking($)}>
              Ask
            </Button>
          </Box>
        )}
        {v.isRevealed && !v.isAsking && (
          <Button key="ask-after" hotkey="q" onPress={() => void startAsking($)}>
            Ask about this card
          </Button>
        )}
        {v.isAsking && <Input key="question" placeholder="A question about this card…" autoFocus onSubmit={value => void askQuestion($, value)} />}
        {v.reply && <Text>{v.reply}</Text>}
      </Box>
    )
  })
}
