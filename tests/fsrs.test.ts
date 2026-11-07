import { expect, test } from 'claude-code/testing'

import { formatDelay, newSchedule, scheduler, type Rating } from '../hooks/fsrs'

const DAY = 86_400_000
const START = Date.UTC(2022, 10, 29, 12, 30)

// Vectors from py-fsrs tests/test_basic.py (FSRS-6 default weights, fuzz off).
test('intervals match py-fsrs when each review is on its due date', async () => {
  const f = scheduler()
  let now = START
  let s = newSchedule(now)
  const intervals: number[] = []
  for (const r of [3, 3, 3, 3, 3, 3, 1, 1, 3, 3, 3, 3, 3] as Rating[]) {
    s = f.review(s, r, now)
    intervals.push(Math.floor((s.due - now) / DAY))
    now = s.due
  }
  expect(intervals).toEqual([0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21])
})

test('memory state matches py-fsrs after Again then five Goods', async () => {
  const f = scheduler()
  let now = START
  let s = newSchedule(now)
  const ratings: Rating[] = [1, 3, 3, 3, 3, 3]
  const gaps = [0, 0, 1, 3, 8, 21]
  ratings.forEach((r, i) => {
    now += gaps[i]! * DAY
    s = f.review(s, r, now)
  })
  expect(Math.abs(s.stability! - 53.62691)).toBeLessThan(1e-4)
  expect(Math.abs(s.difficulty! - 6.3574867)).toBeLessThan(1e-4)
})

test('ten Easy ratings bring difficulty to its floor', async () => {
  const f = scheduler()
  let s = newSchedule(0)
  for (let i = 0; i < 10; i++) s = f.review(s, 4, s.due)
  expect(s.difficulty).toBe(1)
})

test('learning steps: Again 1m, Good 10m, then graduation', async () => {
  const f = scheduler()
  const s0 = newSchedule(0)
  expect(f.review(s0, 1, 0).due).toBe(60_000)
  const s1 = f.review(s0, 3, 0)
  expect(s1.due).toBe(600_000)
  expect(s1.state).toBe(1)
  expect(f.review(s1, 3, s1.due).state).toBe(2)
})

test('fuzz keeps a review interval near the unfuzzed one', async () => {
  const plain = scheduler().review({ ...newSchedule(0), state: 2, stability: 30, difficulty: 5, lastReview: 0 }, 3, 30 * DAY)
  const fuzzed = scheduler({ random: () => 0.99 }).review({ ...newSchedule(0), state: 2, stability: 30, difficulty: 5, lastReview: 0 }, 3, 30 * DAY)
  const gap = Math.abs(plain.due - fuzzed.due) / DAY
  expect(gap).toBeGreaterThan(0)
  expect(gap).toBeLessThan(plain.due / DAY * 0.1)
})

test('delays read short', async () => {
  expect(formatDelay(60_000)).toBe('1m')
  expect(formatDelay(6 * 3_600_000)).toBe('6h')
  expect(formatDelay(3 * DAY)).toBe('3d')
})
