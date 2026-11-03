// Native helper records use: 1-byte type, 4-byte unsigned BE payload length, payload.
export function createRecordParser(onRecord, maxRecordBytes = 12 * 1024 * 1024) {
  let buffered = Buffer.alloc(0)

  return (chunk) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk)
    while (buffered.length >= 5) {
      const type = buffered[0]
      const length = buffered.readUInt32BE(1)
      if (length > maxRecordBytes) throw new Error(`Native capture record exceeds ${maxRecordBytes} bytes`)
      if (buffered.length < 5 + length) return
      onRecord(type, buffered.subarray(5, 5 + length))
      buffered = buffered.subarray(5 + length)
    }
  }
}
