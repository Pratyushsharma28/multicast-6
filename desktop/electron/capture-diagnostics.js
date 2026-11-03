// Tracks frames delivered from the native helper to the renderer.
export function createFrameDiagnostics({ now = () => Date.now(), windowMs = 1000 } = {}) {
  let count = 0
  let timestamps = []

  return {
    reset() {
      count = 0
      timestamps = []
    },
    record() {
      const time = now()
      count += 1
      timestamps.push(time)
      timestamps = timestamps.filter((stamp) => time - stamp < windowMs)
      const elapsed = timestamps.length > 1 ? time - timestamps[0] : 0
      const fps = elapsed > 0 ? ((timestamps.length - 1) * 1000) / elapsed : 0
      return { count, fps: Math.round(fps * 10) / 10 }
    },
  }
}

export function describeCaptureError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown capture error')
  if (/permission|screen recording|not authorized|denied/i.test(message)) {
    return `Screen Recording access is unavailable. In System Settings → Privacy & Security → Screen Recording, allow the app identity shown by macOS, restart MultiCast 6, then try again. Details: ${message}`
  }
  if (/enoent|not found|could not start native capture helper/i.test(message)) {
    return `The native capture helper could not start. Rebuild it from desktop/ with “npm run build:capture”, then restart the app. Details: ${message}`
  }
  return `Native capture reported an error. Stop capture, refresh displays, and try again. Details: ${message}`
}
