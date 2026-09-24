// electron-builder `beforePack` hook: refuses to package an app without bay's own ffmpeg for the
// platform and arch being packed — or with binaries that are not the ones BUILDINFO describes.
//
// The binaries are gitignored (vendor/ffmpeg/README.md says why); `script/build-ffmpeg.sh <arch>`
// makes them. Without this gate a release built on a machine that never ran it would ship an
// app with no ffmpeg at all, which falls back to whatever is on the user's PATH — or to nothing —
// and nobody would find out until an export failed on someone else's Mac.
//
// CommonJS because package.json says "type": "module" and electron-builder `require`s hooks.
const { execFileSync } = require('node:child_process')
const { accessSync, constants, readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')

// electron-builder's Arch enum (builder-util): the numbers are what `context.arch` carries.
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
const LIPO = { x64: 'x86_64', arm64: 'arm64' }

exports.default = async function checkFfmpegVendor(context) {
  const platform = context.electronPlatformName
  const arch = ARCH[context.arch] ?? String(context.arch)
  const root = join(__dirname, '..')
  const dir = join(root, 'vendor', 'ffmpeg', `${platform}-${arch}`)
  const fail = (why) => {
    const fix =
      platform === 'darwin'
        ? `Run script/build-ffmpeg.sh ${arch} first.`
        : 'script/build-ffmpeg.sh builds macOS only; this platform needs its own LGPL build first (vendor/ffmpeg/README.md).'
    throw new Error(`bay cannot be packaged for ${platform}-${arch}: ${why}. ${fix}`)
  }
  const exe = platform === 'win32' ? '.exe' : ''
  let buildinfo
  try {
    buildinfo = readFileSync(join(dir, 'BUILDINFO'), 'utf8')
  } catch {
    fail(`there is no ${join('vendor', 'ffmpeg', `${platform}-${arch}`, 'BUILDINFO')}`)
  }
  for (const name of ['ffmpeg', 'ffprobe']) {
    const path = join(dir, name + exe)
    try {
      accessSync(path, constants.X_OK)
    } catch {
      fail(`${path} is missing or not executable`)
    }
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (!buildinfo.includes(`${sha}  ${name}`)) fail(`${name} is not the binary BUILDINFO records (sha256 ${sha})`)
    if (platform === 'darwin') {
      const archs = execFileSync('lipo', ['-archs', path], { encoding: 'utf8' }).trim()
      if (archs !== LIPO[arch]) fail(`${name} is built for ${archs}, not ${LIPO[arch] ?? arch}`)
    }
  }
}
