import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(root, 'native/macos-capture-probe/build/multicast-capture')
await mkdir(dirname(output), { recursive: true })
const result = spawnSync('swiftc', [
  '-O', '-parse-as-library',
  '-module-cache-path', '/tmp/multicast-swift-module-cache',
  '-framework', 'ScreenCaptureKit', '-framework', 'CoreImage',
  '-framework', 'ImageIO', '-framework', 'UniformTypeIdentifiers', '-framework', 'Foundation',
  resolve(root, 'native/macos-capture-probe/main.swift'), '-o', output,
], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Built native ScreenCaptureKit helper: ${output}`)
