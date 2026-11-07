import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { formatDelay, scheduler, type Rating } from './fsrs'
import { backTranslationPrompt, flagMismatches, generationPrompt, parseNotes, questionPrompt } from './generate'
import { SPANISH_FILES, interleave, parseTips, parseWordList } from './importer'
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

// ---------- import ----------

const importSpanish = async ($: $) => {
  const src = `${await homeDir($)}/.claude/spanish`
  const lists: NoteInput[][] = []
  for (const [file, tag] of SPANISH_FILES) {
    const path = `${src}/${file}`
    if (await $.fs.exists(path)) lists.push(parseWordList(await $.fs.read(path), tag))
  }
  const tipsPath = `${src}/tips.json`
  const tips = (await $.fs.exists(tipsPath)) ? parseTips(JSON.parse(await $.fs.read(tipsPath))) : []
  if (!lists.length && !tips.length) return 0
  return mutate($, data => {
    ensureDeck(data, { id: 'es', name: 'Castellano' })
    return addNotes(data, 'es', [...interleave(lists), ...tips], 'spanish-import', Date.now(), true)
  })
}

// ---------- spinner and end of turn ----------

type Reveal = { face: Face; due: number }
let current: Reveal | undefined
let pending: Reveal | undefined
const reveals = new Map<string, Reveal | null>()

let isChosenForTurn = false
let isTurnRunning = false
let lastShownId: string | undefined

/** Chooses this turn's card, logs the exposure, and keeps its reveal for the turn line. */
const showNextCard = async ($: $) => {
  try {
    const data = await load($)
    const now = Date.now()
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
    const note = graded.unlocked ? `Открыта обратная карточка: ${face(data, graded.unlocked)?.ask}` : undefined
    await update($, view, (): View => ({ mode: 'study', cardId: next?.id ?? null, isRevealed: false, shownAt: Date.now(), isAsking: false, note }))
  } catch (error) {
    await update($, view, old => (old.mode === 'study' ? { ...old, note: `Оценка не сохранилась: ${String(error)}` } : old))
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
  const reply = r.isAnswered ? r.text.trim() : `Не получилось спросить: ${r.reason}`
  await update($, view, old => (old.mode === 'study' && old.cardId === v.cardId ? { ...old, reply } : old))
}

/** Shows the question field and moves the keys into it, so typing never lands in the prompt. */
const startAsking = async ($: $) => {
  await update($, view, old => (old.mode === 'study' ? { ...old, isAsking: true, reply: undefined } : old))
  await $.ui.focus({ requestId: PANE, key: 'question' })
}

// ---------- adding notes ----------

/** `@k8s what restarts pods` → deck `k8s`, created on first use; without `@`, the Spanish deck. */
const startAdd = async ($: $, args: string) => {
  const named = /^@([\w-]+)\s+(.+)$/u.exec(args)
  const deckId = named ? named[1]! : 'es'
  const topic = named ? named[2]! : args
  if (!(await load($)).decks[deckId]) {
    // A deck other than the Spanish one asks one way only: question → answer.
    await mutate($, d => ensureDeck(d, deckId === 'es' ? { id: 'es', name: 'Castellano' } : { id: deckId, name: deckId, kinds: ['recognition'] }))
  }
  const data = await load($)
  const deck = data.decks[deckId]!
  await update($, view, (): View => ({ mode: 'add', deck: deck.id, topic, candidates: [], status: 'Генерирую…' }))
  await $.ui.open({ id: PANE, title: 'ebb · новые записи', focus: true, closeOnEscape: true })
  void (async () => {
    const setStatus = (status: string | undefined) => update($, view, old => (old.mode === 'add' ? { ...old, status } : old))
    const existing = Object.values(data.notes).filter(n => n.deck === deck.id).map(n => n.front)
    const made = await $.model.complete({ model: MODEL, ...generationPrompt(deck, topic, existing), maxTokens: 3000, timeoutMs: 120_000 })
    if (!made.isAnswered) return setStatus(`Модель не ответила: ${made.reason}`)
    const parsed = parseNotes(made.text)
    if ('error' in parsed) return setStatus(parsed.error)
    const notes = parsed.notes.slice(0, 9)
    await setStatus('Проверяю обратным переводом…')
    const checked = await $.model.complete({ model: MODEL, ...backTranslationPrompt(deck, notes), maxTokens: 1500, timeoutMs: 60_000 })
    const known = new Set(existing.map(f => f.toLowerCase()))
    // Without a back-translation nothing is checked: every note starts unticked, and the status says why.
    const unchecked = !checked.isAnswered
    const candidates = flagMismatches(notes, checked.isAnswered ? checked.text : '').map(c =>
      known.has(c.front.toLowerCase()) ? { ...c, isDuplicate: true, isChecked: false } : unchecked ? { ...c, isChecked: false } : c,
    )
    const status = unchecked ? 'Обратный перевод не удался: проверьте записи сами и отметьте нужные' : undefined
    await update($, view, old => (old.mode === 'add' ? { ...old, candidates, status } : old))
  })().catch(error => update($, view, old => (old.mode === 'add' ? { ...old, status: `Ошибка: ${String(error)}` } : old)))
  return `Генерирую записи про «${topic}» — список откроется в панели ebb.`
}

const commitAdd = async ($: $) => {
  const v = await read($, view)
  if (v.mode !== 'add') return
  const chosen = v.candidates.filter(c => c.isChecked && !c.isDuplicate)
  const added = await mutate($, data => addNotes(data, v.deck, chosen, `ebb add: ${v.topic}`, Date.now()))
  await openStudy($, `Добавлено записей: ${added}`)
}

// ---------- commands ----------

const HELP = `/ebb — сессия повторения
/ebb add [@колода] <тема или список слов> — сгенерировать записи (новая @колода создаётся сама)
/ebb pause [1h|30m|2d|off] — не показывать карточки в спиннере
/ebb stats — сколько к повторению и новых
/ebb import — импорт из ~/.claude/spanish`

const runCommand = async ($: $, args: string): Promise<string | undefined> => {
  const [sub = '', ...rest] = args.trim().split(/\s+/)
  const tail = rest.join(' ')
  switch (sub) {
    case '':
      await openStudy($)
      return undefined
    case 'add':
      return tail ? startAdd($, tail) : 'Напишите тему: /ebb add еда в баре'
    case 'pause': {
      if (tail === 'off') {
        await mutate($, data => void delete data.meta.pausedUntil)
        return 'Карточки снова в спиннере.'
      }
      const ms = tail ? parseDuration(tail) : 3_600_000
      if (!ms) return 'Не понял длительность: /ebb pause 1h, 30m, 2d или off'
      const until = Date.now() + ms
      await mutate($, data => void (data.meta.pausedUntil = until))
      return `Пауза до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`
    }
    case 'stats': {
      const data = await load($)
      const c = counts(data, Date.now())
      const total = Object.keys(data.notes).length
      const paused = (data.meta.pausedUntil ?? 0) > Date.now() ? ' · пауза' : ''
      return `Записей: ${total} · к повторению: ${c.due} · новых: ${c.new}${paused}`
    }
    case 'import': {
      const added = await importSpanish($)
      return `Импортировано новых записей: ${added}.`
    }
    default:
      return HELP
  }
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'ebb', description: 'Интервальное повторение: сессия, add, pause, stats', argumentHint: '[add <тема> | pause 1h | stats]' })
    if (!(await $.fs.exists(await dataPath($)))) await importSpanish($).catch(error => $.ui.log(`ebb: импорт не удался: ${String(error)}`, { to: 'debug' }))
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
    const { ask, answer } = reveal.face
    const due = reveal.due ? ` · ${reveal.due} к повторению · /ebb` : ''
    return (
      <Text dimColor>
        ✻ {e.props.word} for {durationText(e.props.durationMs)} · <Text dimColor={false}>{ask} — {answer}</Text>
        {due}
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
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Новые записи: {v.topic}</Text>
          {v.status && <Text dimColor>{v.status}</Text>}
          <Box flexDirection="column">
            {v.candidates.map((c, i) => (
              <Button key={`c${i}`} hotkey={String(i + 1)} onPress={() => toggle(i)}>
                {c.isDuplicate ? '[дубль]' : c.isChecked ? '[x]' : '[ ]'} {c.front} — {c.back}
                {c.hint ? ` (${c.hint})` : ''}
                {c.flag ? ` ⚠ ${c.flag}` : ''}
              </Button>
            ))}
          </Box>
          {v.candidates.length > 0 && (
            <Box gap={2}>
              <Button key="add" hotkey="a" variant="primary" onPress={() => void commitAdd($)}>
                Добавить отмеченные ({chosen})
              </Button>
              <Button key="cancel" hotkey="x" onPress={() => void $.ui.close({ id: PANE })}>
                Отмена
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
      return <Text color="red">ebb: не удалось прочитать данные: {String(error)}</Text>
    }
    const now = Date.now()
    const c = counts(data, now)
    const header = (
      <Text dimColor>
        к повторению: {c.due} · новых сегодня: {Math.min(c.new, Object.values(data.decks).reduce((n, d) => n + newLeftToday(data, d, now), 0))}
        {(data.meta.pausedUntil ?? 0) > now ? ' · спиннер на паузе' : ''}
      </Text>
    )
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
          <Text bold>На сейчас всё.</Text>
          {soon && <Text dimColor>Следующее повторение через {formatDelay(Math.max(0, soon.due - now))}.</Text>}
          <Text dimColor>Новые записи: /ebb add &lt;тема&gt;</Text>
        </Box>
      )
    }

    const intervals = scheduler().preview(f.card, now)
    const labels = ['Снова', 'Трудно', 'Хорошо', 'Легко']
    const isSpanish = f.note.deck === 'es'
    const kind = f.card.kind === 'production' ? (isSpanish ? 'вспомните по-испански, с артиклем' : 'вспомните обратную сторону') : isSpanish ? 'что это значит?' : 'вспомните ответ'
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
              Показать ответ
            </Button>
            <Button key="ask" hotkey="q" onPress={() => void startAsking($)}>
              Спросить
            </Button>
          </Box>
        )}
        {v.isRevealed && !v.isAsking && (
          <Button key="ask-after" hotkey="q" onPress={() => void startAsking($)}>
            Спросить про карточку
          </Button>
        )}
        {v.isAsking && <Input key="question" placeholder="Вопрос про эту карточку…" autoFocus onSubmit={value => void askQuestion($, value)} />}
        {v.reply && <Text>{v.reply}</Text>}
      </Box>
    )
  })
}
