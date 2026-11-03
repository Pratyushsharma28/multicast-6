import test from 'node:test'
import assert from 'node:assert/strict'
import { createFrameDiagnostics, describeCaptureError } from './capture-diagnostics.js'

test('counts delivered frames and calculates recent frame rate', () => {
  let time = 1000
  const stats = createFrameDiagnostics({ now: () => time })
  assert.deepEqual(stats.record(), { count: 1, fps: 0 })
  time += 100
  assert.deepEqual(stats.record(), { count: 2, fps: 10 })
  time += 100
  assert.deepEqual(stats.record(), { count: 3, fps: 10 })
  stats.reset()
  assert.deepEqual(stats.record(), { count: 1, fps: 0 })
})

test('drops frames outside the rolling rate window', () => {
  let time = 0
  const stats = createFrameDiagnostics({ now: () => time, windowMs: 500 })
  stats.record()
  time = 100
  stats.record()
  time = 700
  assert.deepEqual(stats.record(), { count: 3, fps: 0 })
})

test('gives specific permission and helper startup guidance', () => {
  assert.match(describeCaptureError(new Error('Screen Recording permission denied')), /System Settings/)
  assert.match(describeCaptureError(new Error('spawn failed: ENOENT')), /npm run build:capture/)
})
