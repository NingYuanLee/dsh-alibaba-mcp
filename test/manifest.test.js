import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(root, relative), 'utf8')
const readJson = (relative) => JSON.parse(read(relative))
const pkg = readJson('package.json')

test('declares an installable bundle', () => {
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org')
  assert.equal(pkg.publishConfig?.tag, 'latest')
  assert.equal(pkg.name, 'dsh-alibaba-mcp')
  assert.equal(pkg.dsh?.manifestVersion, 1)
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.repository, undefined)
  const patch = read('cordis.patch.yml')
  assert.match(patch, /id:\s*alibaba-mcp/)
  assert.match(patch, /name:\s*dsh-alibaba-mcp/)
})

test('declares the verified dsh and node ranges and peer baselines', () => {
  assert.equal(pkg.engines?.dsh, '>=0.2.1-rc.2 <0.3.0-0')
  assert.equal(pkg.engines?.node, '>=22.19.0')
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/cordis'], '~4.0.4')
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/dsh-credentials'], '>=0.2.1-0 <0.3.0')
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/dsh-mcp-client'], '>=0.2.1-0 <0.3.0')
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/schemastery'], '~3.18.4')
  assert.equal(pkg.dependencies, undefined)
})

test('publishes locale display metadata', () => {
  assert.equal(pkg.exports?.['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.exports?.['./icon'], './icon.svg')
  assert.equal(pkg.icon, './icon.svg')
  for (const lang of ['en', 'zh']) {
    const meta = readJson(`locale/${lang}.json`)
    assert.notEqual(meta.meta?.title?.trim(), '')
    assert.notEqual(meta.meta?.description?.trim(), '')
    assert.doesNotMatch(meta.meta.title, /Demo MCP/u)
  }
})

test('exports an icon within the harness size limit', () => {
  const icon = join(root, 'icon.svg')
  assert.ok(existsSync(icon))
  const size = statSync(icon).size
  assert.ok(size > 0)
  assert.ok(size <= 256 * 1024)
  assert.match(read('icon.svg'), /<svg\b/u)
})

test('lists runtime and metadata files and documents install plus uninstall', () => {
  for (const entry of ['src', 'cordis.patch.yml', 'locale', 'icon.svg', 'SECURITY.md', 'README*.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(entry), `files includes ${entry}`)
  }
  for (const name of ['README.md', 'README.zh.md']) {
    const text = read(name)
    assert.match(text, /dsh plugin --profile web add dsh-alibaba-mcp/)
    assert.match(text, /dsh plugin --profile <name> remove dsh-alibaba-mcp/)
  }
})

test('keeps matching level-2 headings in both READMEs', () => {
  const headingsOf = (text) => text.split(/\r?\n/u)
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
  const base = headingsOf(read('README.md'))
  assert.ok(base.length > 0)
  assert.deepEqual(headingsOf(read('README.zh.md')), base)
})

test('plugin source resolves credentials and does not embed a key', () => {
  const source = read('src/index.js')
  assert.match(source, /credentialRef/)
  assert.match(source, /transport: 'stdio'/)
  assert.doesNotMatch(source, /LTAI[A-Za-z0-9]{8,}/u)
  assert.doesNotMatch(read('src/launch.js'), /LTAI[A-Za-z0-9]{8,}/u)
})
