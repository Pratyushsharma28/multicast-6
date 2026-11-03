import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const electronApp = resolve(desktop, 'node_modules/electron/dist/Electron.app')
const outputDir = resolve(root, 'outputs')
const appName = 'MultiCast 6.app'
const dmgPath = resolve(outputDir, 'MultiCast-6-arm64.dmg')
const stage = await mkdtemp(resolve(tmpdir(), 'multicast-dmg-'))
const stagedApp = resolve(stage, appName)
const resources = resolve(stagedApp, 'Contents/Resources')
const packagedApp = resolve(resources, 'app')

try {
  const architecture = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim()
  if (architecture !== 'arm64') throw new Error(`Build this installer on Apple Silicon; current architecture is ${architecture}.`)
  await mkdir(outputDir, { recursive: true })
  await cp(electronApp, stagedApp, { recursive: true })
  await rm(resolve(resources, 'default_app.asar'), { force: true })
  await mkdir(packagedApp, { recursive: true })
  await cp(resolve(desktop, 'electron'), resolve(packagedApp, 'electron'), { recursive: true, filter: (source) => !source.endsWith('package-macos.js') && !source.endsWith('.test.js') && !source.endsWith('build-capture.js') })
  await cp(resolve(desktop, 'dist'), resolve(packagedApp, 'dist'), { recursive: true })
  await mkdir(resolve(resources, 'native/macos-capture-probe/build'), { recursive: true })
  await cp(resolve(root, 'native/macos-capture-probe/build/multicast-capture'), resolve(resources, 'native/macos-capture-probe/build/multicast-capture'))
  await writeFile(resolve(packagedApp, 'package.json'), JSON.stringify({ name: 'multicast-6', version: '1.0.0', main: 'electron/main.js' }, null, 2))

  const plist = resolve(stagedApp, 'Contents/Info.plist')
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName "MultiCast 6"', plist])
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName "MultiCast 6"', plist])
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier com.multicast6.desktop', plist])
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleVersion 1.0.0', plist])
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleShortVersionString 1.0.0', plist])
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSScreenCaptureUsageDescription string "MultiCast 6 captures the display you select after you start sharing."', plist])
  await rm(dmgPath, { force: true })
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'MultiCast 6', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmgPath], { stdio: 'inherit' })
  execFileSync('/usr/bin/hdiutil', ['verify', dmgPath], { stdio: 'inherit' })
  console.log(`Created ${dmgPath}`)
} finally {
  await rm(stage, { recursive: true, force: true })
}
