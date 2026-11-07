// ebb for pi: the card above the editor, graded with shortcuts, and the /ebb command.
// The session itself is `core/ebb.ts`, shared with the Claude Code mod.

import { homedir } from 'node:os'

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { type KeyId, MouseRegion, matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import {
  type BandView,
  candidateLine,
  createSession,
  dataDir,
  type Host,
  type NewDeck,
  tickedCount,
  toggleCandidate,
  type View,
} from '../core/ebb'
import type { Deck } from '../core/model'
import { fileHost } from './host'

const WIDGET = 'ebb'

// Modified keys, so the editor keeps every key it types. On a Mac, Option works as Alt only when the
// terminal sends it so; the band also takes clicks. `cmd` digits switch the terminal's tabs.
const KEYS = { forgot: 'alt+1', got: 'alt+2', skip: 'alt+3', toggle: 'alt+h' } as const satisfies Record<string, KeyId>

type Action = 'forgot' | 'got' | 'skip' | 'next'

/** A piece of the band line; a piece with an action is a button that a click presses. */
type Part = { text: string; action?: Action }

const files = fileHost(homedir(), dataDir(homedir(), process.env.XDG_DATA_HOME))
// Whether the person hid the band; kept beside the data, so it stays hidden in new sessions.
const SETTINGS = `${files.dir}/pi.json`

const textOf = (content: { type: string; text?: string }[]) =>
  content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('')

/** The pieces of the band; none while it is paused or without a card. */
const bandParts = (v: BandView, theme: Theme): Part[] | undefined => {
  if (v.kind === 'error') return [{ text: theme.fg('error', `ebb: cannot read the data: ${v.error}`) }]
  if (v.kind === 'no-deck')
    return [{ text: theme.fg('dim', 'ebb: /ebb add <topic> or /ebb install <file or URL> to get cards') }]
  if (v.kind === 'none') return undefined

  const f = v.face
  const bar = { text: `  ${theme.fg('dim', '│')}  ` }
  const button = (key: KeyId, label: string, action: Action): Part => ({
    text: `${theme.fg('accent', key)} ${label}`,
    action,
  })
  const gap = { text: '  ' }
  if (v.isRevealed) {
    const hint = f.hint ? theme.fg('dim', ` (${f.hint})`) : ''
    return [{ text: `${theme.bold(f.ask)} — ${f.answer}${hint}` }, bar, button(KEYS.forgot, 'Next', 'next')]
  }

  return [
    { text: theme.bold(f.ask) },
    bar,
    button(KEYS.forgot, 'Forgot', 'forgot'),
    gap,
    button(KEYS.got, 'Got it', 'got'),
    gap,
    button(KEYS.skip, 'Skip', 'skip'),
  ]
}

/**
 * The band as one line, indented as pi indents a widget, with the columns of its buttons. pi passes a
 * click only in its fullscreen mode, so every button also has a key.
 */
const bandWidget = (parts: Part[], press: (action: Action) => void) => (_tui: unknown, _theme: Theme) => {
  let buttons: { from: number; to: number; action: Action }[] = []
  const line = {
    render: (width: number) => {
      let column = 1
      buttons = []
      for (const part of parts) {
        const partWidth = visibleWidth(part.text)
        if (part.action) buttons.push({ from: column, to: column + partWidth, action: part.action })
        column += partWidth
      }
      return [truncateToWidth(` ${parts.map(p => p.text).join('')}`, width)]
    },
    invalidate: () => undefined,
  }

  return new MouseRegion(line, event => {
    const hit = buttons.find(b => event.x >= b.from && event.x < b.to)
    if (event.type !== 'click' || event.button !== 'left' || !hit) return undefined
    press(hit.action)
    return { handled: true }
  })
}

export default function ebb(pi: ExtensionAPI) {
  const session = createSession()
  let ctx: ExtensionContext | undefined
  let isHidden = false

  const draw = async () => {
    if (!ctx?.hasUI) return
    const ui = ctx.ui
    const parts = isHidden ? undefined : bandParts(await session.bandView(host), ui.theme)
    ui.setWidget(WIDGET, parts && bandWidget(parts, action => void press(action)))
  }

  const host: Host = {
    ...files,
    complete: async ({ system, prompt, maxTokens, timeoutMs }) => {
      const model = ctx?.model
      if (!ctx || !model) return { error: 'no model is selected' }
      const reply = await ctx.modelRegistry.complete(
        model,
        {
          systemPrompt: system,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
        },
        { maxTokens, signal: AbortSignal.timeout(timeoutMs) },
      )
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted')
        return { error: reply.errorMessage ?? reply.stopReason }

      return { text: textOf(reply.content) }
    },
    showBand: draw,
  }

  const notify = (text: string, level: 'info' | 'error' = 'info') => ctx?.ui.notify(text, level)

  /** Runs a shortcut; a failure says what went wrong. */
  const act = (work: () => Promise<unknown>) => async (shortcutCtx: ExtensionContext) => {
    ctx = shortcutCtx
    try {
      await work()
    } catch (error) {
      notify(`ebb: ${String(error)}`, 'error')
    }
  }

  /** What a button of the band does, from its key or a click; only on a card the band shows. */
  const run = async (action: Action) => {
    const v = await session.bandView(host)
    if (isHidden || v.kind !== 'card') return
    if (v.isRevealed) {
      if (action === 'forgot' || action === 'next') await session.next(host)
      return
    }
    if (action === 'forgot') await session.gradeCard(host, 1)
    if (action === 'got') await session.gradeCard(host, 3)
    if (action === 'skip') await session.skip(host)
  }

  const press = async (action: Action) => {
    try {
      await run(action)
    } catch (error) {
      notify(`ebb: ${String(error)}`, 'error')
    }
  }

  const showNextCard = async () => {
    const error = await session.showNextCard(host)
    if (error) notify(`ebb: ${error}`, 'error')
  }

  /** `/ebb add`: the deck, its languages, then the list of new notes to tick. */
  const add = async (command: ExtensionContext, args: string): Promise<string> => {
    if (command.mode !== 'tui') return '/ebb add needs the interactive mode'
    const plan = await session.planAdd(host, args)
    if ('text' in plan) return plan.text

    let view = plan.view
    let deck: Deck | NewDeck | undefined = plan.deck
    if (!deck) {
      command.ui.setStatus(WIDGET, 'ebb: reading the request…')
      const newDeck = await session
        .askDeck(host, args, plan.named)
        .finally(() => command.ui.setStatus(WIDGET, undefined))
      if (newDeck.learn && !newDeck.native) {
        const native = (
          await command.ui.input(`Translate ${newDeck.learn} into which language?`, 'for example: English')
        )?.trim()
        if (!native) return 'Nothing added.'
        newDeck.native = native
      }
      view = { ...view, deck: newDeck.id, newDeck }
      deck = newDeck
    }
    const drafted = deck

    const chosen = await command.ui.custom<View | undefined>((tui, theme, _keys, done) => {
      let current = view
      const redraw = async (change: Partial<View>) => {
        current = { ...current, ...change }
        tui.requestRender()
      }
      void session
        .draftNotes(host, drafted, current.topic, status => redraw({ status }))
        .then(redraw, (error: unknown) => redraw({ status: `Error: ${String(error)}` }))

      return {
        render: (width: number) => {
          const rows = current.candidates.map((c, i) => `${theme.fg('accent', String(i + 1))} ${candidateLine(c)}`)
          const actions = current.candidates.length
            ? `${theme.fg('accent', 'a')} add ticked (${tickedCount(current)})  ${theme.fg('accent', 'x')} cancel`
            : `${theme.fg('accent', 'x')} cancel`
          const lines = [
            theme.bold(`New notes: ${current.topic}`),
            ...(current.status ? [theme.fg('dim', current.status)] : []),
            ...rows,
            actions,
          ]
          return lines.map(line => truncateToWidth(line, width))
        },
        handleInput: (data: string) => {
          const digit = Number(data)
          if (Number.isInteger(digit) && digit >= 1 && digit <= current.candidates.length) {
            current = toggleCandidate(current, digit - 1)
            tui.requestRender()
            return
          }
          if (data === 'a' && current.candidates.length) done(current)
          if (data === 'x' || matchesKey(data, 'escape')) done(undefined)
        },
        invalidate: () => undefined,
      }
    })
    if (!chosen) return 'Nothing added.'

    return `ebb: notes added: ${await session.commitAdd(host, chosen)}`
  }

  pi.on('session_start', async (_event, startCtx) => {
    ctx = startCtx
    const settings = await files.read(SETTINGS).catch(() => '{}')
    try {
      isHidden = (JSON.parse(settings) as { hidden?: boolean }).hidden === true
    } catch {
      isHidden = false
    }
    await showNextCard()
  })

  pi.on('input', (event, inputCtx) => {
    ctx = inputCtx
    if (event.source === 'interactive') session.notePrompt(event.text)
  })

  // A card may have come due while the agent worked; an open answer stays as it is.
  pi.on('agent_end', async (_event, endCtx) => {
    ctx = endCtx
    await session.endTurn(host)
  })

  pi.registerCommand('ebb', {
    description: 'Spaced repetition above the editor: add, install, decks, pause, stats',
    handler: async (args, command) => {
      ctx = command
      const text = await session
        .runCommand(host, args, tail => add(command, tail))
        .catch((error: unknown) => `ebb: ${String(error)}`)
      notify(text)
    },
  })

  pi.registerShortcut(KEYS.forgot, {
    description: 'ebb: Forgot, or Next after the answer',
    handler: act(() => run('forgot')),
  })
  pi.registerShortcut(KEYS.got, {
    description: 'ebb: Got it',
    handler: act(() => run('got')),
  })
  pi.registerShortcut(KEYS.skip, {
    description: 'ebb: skip the card',
    handler: act(() => run('skip')),
  })
  pi.registerShortcut(KEYS.toggle, {
    description: 'ebb: hide or show the card above the editor',
    handler: act(async () => {
      isHidden = !isHidden
      await files.write(SETTINGS, JSON.stringify({ hidden: isHidden }))
      await draw()
    }),
  })
}
