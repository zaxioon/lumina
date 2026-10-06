import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
let packageDir = dirname(require.resolve('@tauri-apps/cli'))
while (!existsSync(join(packageDir, 'package.json'))) {
  const parent = dirname(packageDir)
  if (parent === packageDir) throw new Error('Unable to locate the installed Tauri CLI package.')
  packageDir = parent
}
const metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.tauri
const cargoHome = process.env.CARGO_HOME || join(root, '.cache', 'cargo')
const tempDir = join(root, '.cache', 'tmp')
mkdirSync(cargoHome, { recursive: true })
mkdirSync(tempDir, { recursive: true })
const child = spawn(process.execPath, [join(packageDir, bin), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CARGO_HOME: cargoHome, TMP: tempDir, TEMP: tempDir, TMPDIR: tempDir },
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
