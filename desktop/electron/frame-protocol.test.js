import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecordParser } from './frame-protocol.js'

function record(type, payload) {
  const header = Buffer.alloc(5)
  header[0] = type
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

test('parses records split across chunks and multiple records in one chunk', () => {
  const parsed = []
  const push = createRecordParser((type, data) => parsed.push([type, data.toString()]))
  const first = record(2, Buffer.from('{"type":"started"}'))
  const second = record(1, Buffer.from('jpeg'))
  push(first.subarray(0, 3))
  push(Buffer.concat([first.subarray(3), second]))
  assert.deepEqual(parsed, [[2, '{"type":"started"}'], [1, 'jpeg']])
})

test('rejects oversized native records', () => {
  const push = createRecordParser(() => {}, 8)
  const header = Buffer.alloc(5)
  header.writeUInt32BE(9, 1)
  assert.throws(() => push(header), /exceeds 8 bytes/)
})
