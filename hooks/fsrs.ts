// FSRS-6 scheduler, ported from py-fsrs (MIT, open-spaced-repetition/py-fsrs)
// and checked against its test vectors in tests/fsrs.test.ts.

export type Rating = 1 | 2 | 3 | 4 // Again, Hard, Good, Easy
export type State = 0 | 1 | 2 | 3 // New, Learning, Review, Relearning

export type Schedule = {
  state: State
  step: number | null
  stability: number | null
  difficulty: number | null
  due: number // epoch ms
  lastReview: number | null // epoch ms
}

export const DEFAULT_WEIGHTS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
]

export type Options = {
  weights?: readonly number[]
  desiredRetention?: number
  learningSteps?: readonly number[] // ms
  relearningSteps?: readonly number[] // ms
  maximumInterval?: number // days
  random?: () => number // fuzz source; omit to turn fuzz off
}

const MINUTE = 60_000
const DAY = 86_400_000
const S_MIN = 0.001

export const newSchedule = (now: number): Schedule => ({
  state: 0,
  step: null,
  stability: null,
  difficulty: null,
  due: now,
  lastReview: null,
})

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function scheduler(options: Options = {}) {
  const w = options.weights ?? DEFAULT_WEIGHTS
  const retention = options.desiredRetention ?? 0.9
  const learning = options.learningSteps ?? [1 * MINUTE, 10 * MINUTE]
  const relearning = options.relearningSteps ?? [10 * MINUTE]
  const maxIvl = options.maximumInterval ?? 36500
  const decay = -w[20]!
  const factor = 0.9 ** (1 / decay) - 1

  const retrievability = (s: Schedule, now: number) => {
    if (s.lastReview === null || s.stability === null) return 0
    const days = Math.max(0, Math.floor((now - s.lastReview) / DAY))
    return (1 + (factor * days) / s.stability) ** decay
  }
  const initialStability = (r: Rating) => Math.max(w[r - 1]!, S_MIN)
  const rawInitialDifficulty = (r: Rating) => w[4]! - Math.exp(w[5]! * (r - 1)) + 1
  const initialDifficulty = (r: Rating) => clamp(rawInitialDifficulty(r), 1, 10)
  const nextDifficulty = (d: number, r: Rating) => {
    const delta = -(w[6]! * (r - 3))
    const damped = d + ((10 - d) * delta) / 9
    const reverted = w[7]! * rawInitialDifficulty(4) + (1 - w[7]!) * damped
    return clamp(reverted, 1, 10)
  }
  const shortTermStability = (s: number, r: Rating) => {
    let inc = Math.exp(w[17]! * (r - 3 + w[18]!)) * s ** -w[19]!
    if (r >= 3) inc = Math.max(inc, 1)
    return Math.max(s * inc, S_MIN)
  }
  const nextStability = (d: number, s: number, rr: number, r: Rating) => {
    if (r === 1) {
      const longTerm = w[11]! * d ** -w[12]! * ((s + 1) ** w[13]! - 1) * Math.exp((1 - rr) * w[14]!)
      const shortTerm = s / Math.exp(w[17]! * w[18]!)
      return Math.max(Math.min(longTerm, shortTerm), S_MIN)
    }
    const hard = r === 2 ? w[15]! : 1
    const easy = r === 4 ? w[16]! : 1
    const grown = s * (1 + Math.exp(w[8]!) * (11 - d) * s ** -w[9]! * (Math.exp((1 - rr) * w[10]!) - 1) * hard * easy)
    return Math.max(grown, S_MIN)
  }
  const interval = (s: number) => {
    const days = Math.round((s / factor) * (retention ** (1 / decay) - 1))
    return clamp(days, 1, maxIvl)
  }
  const fuzz = (days: number) => {
    if (!options.random || days < 2.5) return days
    const ranges: [number, number, number][] = [
      [2.5, 7, 0.15],
      [7, 20, 0.1],
      [20, Infinity, 0.05],
    ]
    let delta = 1
    for (const [lo, hi, f] of ranges) delta += f * Math.max(Math.min(days, hi) - lo, 0)
    const lo = Math.max(2, Math.round(days - delta))
    const hi = Math.min(Math.round(days + delta), maxIvl)
    return Math.min(Math.round(options.random() * (hi - lo + 1) + lo), maxIvl)
  }
  const stepDelay = (steps: readonly number[], step: number, r: Rating) => {
    if (r === 2 && step === 0) return steps.length === 1 ? steps[0]! * 1.5 : (steps[0]! + steps[1]!) / 2
    return steps[step]!
  }

  /** The schedule after grading `s` with `r` at `now`. */
  const review = (s: Schedule, r: Rating, now: number): Schedule => {
    let stability: number
    let difficulty: number
    if (s.stability === null || s.difficulty === null) {
      stability = initialStability(r)
      difficulty = initialDifficulty(r)
    } else {
      const sameDay = s.lastReview !== null && now - s.lastReview < DAY
      stability = sameDay
        ? shortTermStability(s.stability, r)
        : nextStability(s.difficulty, s.stability, retrievability(s, now), r)
      difficulty = nextDifficulty(s.difficulty, r)
    }

    let state: State = s.state === 0 ? 1 : s.state
    let step: number | null = s.state === 0 ? 0 : s.step
    let delay: number // ms, or days * DAY when graduating

    const graduate = () => {
      state = 2
      step = null
      return interval(stability) * DAY
    }

    if (state === 2) {
      if (r === 1 && relearning.length > 0) {
        state = 3
        step = 0
        delay = relearning[0]!
      } else {
        delay = graduate()
      }
    } else {
      const steps = state === 1 ? learning : relearning
      const at = step ?? 0
      if (steps.length === 0 || (at >= steps.length && r > 1)) delay = graduate()
      else if (r === 1) {
        step = 0
        delay = steps[0]!
      } else if (r === 2) delay = stepDelay(steps, at, r)
      else if (r === 3) {
        if (at + 1 >= steps.length) delay = graduate()
        else {
          step = at + 1
          delay = steps[at + 1]!
        }
      } else delay = graduate()
    }

    if (state === 2 && options.random) delay = fuzz(delay / DAY) * DAY
    return { state, step, stability, difficulty, due: now + delay, lastReview: now }
  }

  /** What each rating would give, for the labels on the grade buttons. */
  const preview = (s: Schedule, now: number) =>
    ([1, 2, 3, 4] as const).map(r => ({ rating: r, due: review(s, r, now).due }))

  return { review, preview }
}

/** `65_000` → `1м`, `3 * DAY` → `3д`. */
export const formatDelay = (ms: number): string => {
  const min = Math.round(ms / MINUTE)
  if (min < 60) return `${Math.max(1, min)}м`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `${hours}ч`
  const days = Math.round(ms / DAY)
  if (days < 31) return `${days}д`
  if (days < 365) return `${Math.round(days / 30)}мес`
  return `${(days / 365).toFixed(1).replace('.0', '')}г`
}
