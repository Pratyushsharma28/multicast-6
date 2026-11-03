import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const electronApp = resolve(desktop, 'node_modules/electron/dist/Electron.app')
const outputDir = resolve(root, 'outputs')
const appName = 'MultiCast 6.app'
const appPath = resolve(outputDir, appName)
const zipPath = resolve(outputDir, 'MultiCast-6-arm64.zip')
const resources = resolve(appPath, 'Contents/Resources')
const packagedApp = resolve(resources, 'app')

const architecture = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim()
if (architecture !== 'arm64') throw new Error(`Build this app on Apple Silicon; current architecture is ${architecture}.`)

await mkdir(outputDir, { recursive: true })
await rm(appPath, { recursive: true, force: true })
await rm(zipPath, { force: true })
await cp(electronApp, appPath, { recursive: true })
await rm(resolve(resources, 'default_app.asar'), { force: true })
await mkdir(packagedApp, { recursive: true })
await cp(resolve(desktop, 'electron'), resolve(packagedApp, 'electron'), {
  recursive: true,
  filter: (source) => !source.endsWith('package-macos.js') && !source.endsWith('package-macos-zip.js') && !source.endsWith('.test.js') && !source.endsWith('build-capture.js'),
})
await cp(resolve(desktop, 'dist'), resolve(packagedApp, 'dist'), { recursive: true })
await mkdir(resolve(resources, 'native/macos-capture-probe/build'), { recursive: true })
await cp(
  resolve(root, 'native/macos-capture-probe/build/multicast-capture'),
  resolve(resources, 'native/macos-capture-probe/build/multicast-capture'),
)
await writeFile(resolve(packagedApp, 'package.json'), JSON.stringify({ name: 'multicast-6', version: '1.0.0', main: 'electron/main.js' }, null, 2))

const plist = resolve(appPath, 'Contents/Info.plist')
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName "MultiCast 6"', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName "MultiCast 6"', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier com.multicast6.desktop', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleVersion 1.0.0', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleShortVersionString 1.0.0', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSScreenCaptureUsageDescription string "MultiCast 6 captures the display you select after you start sharing."', plist])
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :ElectronAsarIntegrity', plist])
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])
console.log(`Created ${appPath}`)
console.log(`Created ${zipPath}`)
