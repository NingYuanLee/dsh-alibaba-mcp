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

test('ships a web client entry for the module picker', () => {
  assert.equal(pkg.exports?.['./client'], './lib/client.js')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  for (const dep of ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-plugin-manager', '@deepseek-ai/dsh-api-settings-controller']) {
    assert.ok(pkg.dsh.client.inject.includes(dep), `client inject includes ${dep}`)
  }
  assert.ok(pkg.files.includes('lib'), 'files includes lib')
  assert.ok(pkg.files.includes('scripts/build-client.mjs'), 'files includes the build script')

  // The built file is what the web client evaluates; a stale or unbundled copy
  // would leave the detail page without the picker.
  const built = read('lib/client.js')
  assert.match(built, /window\.__ModuleLoader__\.load\(/)
  assert.match(built, /id:\s*'dsh-alibaba-mcp'/)
  assert.match(built, /createClient\(\{ React: require\('react'\) \}\)/)
  assert.doesNotMatch(built, /^\s*export\b/mu)
})

test('client entry exports the cordis service list the web boot needs', () => {
  // Without this export the host never injects ctx.slots/ctx.locale, apply()
  // throws, and the whole web boot fails with "1 entry did not activate".
  const source = read('src/client.js')
  assert.match(source, /^export const inject = \[[^\]]*'slots'/mu)
  assert.match(source, /^export const inject = \[[^\]]*'locale'/mu)
  // The build must carry it onto the module exports, not just the source.
  assert.match(read('lib/client.js'), /Object\.assign\(createClient\(\{ React: require\('react'\) \}\), \{ inject \}\)/)
})

test('the modules field is volatile so the GUI settings form can render it', () => {
  // volatileForm() in @deepseek-ai/dsh-settings only projects volatile fields;
  // without it the plugin has no settings namespace and the picker is read-only.
  const source = read('src/index.js')
  assert.match(source, /modules: z\.string\(\)\.default\(DEFAULT_MODULES\)\.volatile\(\)/u)
  assert.match(source, /ctx\.on\('loader\/volatile-update'/u)
})
