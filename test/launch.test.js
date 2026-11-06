import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COMMAND,
  DEFAULT_PYTHON,
  SERVER_DISTRIBUTION,
  SERVER_EXECUTABLE,
  UV_PREFIX_ARGS,
  buildLaunch,
  isFileCommand,
  redactSecrets,
  usesUv,
} from '../src/launch.js'

const KEYS = {
  accessKeyId: 'LTAI-test-id-value',
  accessKeySecret: 'secret-test-value',
}

test('default command is uv, resolved on PATH', () => {
  assert.equal(DEFAULT_COMMAND, 'uv')
  // A bare name is looked up on PATH, so it is not an absolute path.
  assert.equal(isFileCommand(DEFAULT_COMMAND), false)
  assert.equal(isFileCommand('alibaba-cloud-ops-mcp-server'), false)
  assert.equal(usesUv(DEFAULT_COMMAND), true)
  assert.equal(usesUv('C:\\tools\\uv.exe'), true)
  assert.equal(usesUv('C:\\tools\\python\\python.exe'), false)
})

test('pins the interpreter, because uv would otherwise pick an unsupported one', () => {
  // pydantic-core builds fail on CPython 3.14, so the version is pinned.
  assert.equal(DEFAULT_PYTHON, '3.12')
  const launch = buildLaunch({ command: DEFAULT_COMMAND, ...KEYS })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.deepEqual(launch.args.slice(0, 6), ['tool', 'run', '--python', '3.12', '--from', SERVER_DISTRIBUTION])
  assert.equal(launch.args[6], SERVER_EXECUTABLE)
  assert.equal(launch.args[7], '--transport')
})

test('an explicit python version replaces the pinned one', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, ...KEYS, python: '3.13' })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.deepEqual(launch.args.slice(0, 4), ['tool', 'run', '--python', '3.13'])
})

test('a custom command takes no distribution prefix', () => {
  const custom = 'C:\\tools\\mcp\\vendor\\alibaba\\.venv\\Scripts\\alibaba-cloud-ops-mcp-server.exe'
  const launch = buildLaunch({ command: custom, ...KEYS })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.args[0], '--transport')
  assert.equal(launch.args.includes('--from'), false)
  assert.equal(launch.cwd, 'C:\\tools\\mcp\\vendor\\alibaba\\.venv\\Scripts')
})

test('the path checks do not depend on the host platform', () => {
  // node:path follows the host platform, so a Windows path would read as
  // relative on Linux. The plugin has to answer the same on every host.
  assert.equal(isFileCommand('C:\\tools\\server.exe'), true)
  assert.equal(isFileCommand('/usr/local/bin/server'), true)
  assert.equal(isFileCommand('\\\\server\\share\\server.exe'), true)
  assert.equal(isFileCommand('server'), false)
  assert.equal(isFileCommand('uv'), false)
})

test('passes both keys only in env and keeps them out of argv', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, ...KEYS, region: 'cn-hangzhou' })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.mode, 'keys')
  assert.equal(launch.env.ALIBABA_CLOUD_ACCESS_KEY_ID, KEYS.accessKeyId)
  assert.equal(launch.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET, KEYS.accessKeySecret)
  assert.equal(launch.env.ALIBABA_CLOUD_REGION_ID, 'cn-hangzhou')
  assert.equal(launch.env.ALIBABA_CLOUD_SECURITY_TOKEN, undefined)
  assert.equal(launch.env.PYTHONUTF8, '1')
  assert.equal(launch.args.includes('--transport'), true)
  assert.equal(launch.args.includes('stdio'), true)
  assert.equal(launch.args.includes('--from'), true)
  assert.equal(launch.args.includes(SERVER_DISTRIBUTION), true)
  const argv = launch.args.join('\n')
  assert.equal(argv.includes(KEYS.accessKeyId), false)
  assert.equal(argv.includes(KEYS.accessKeySecret), false)
})

test('adds the token only together with a key pair', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, ...KEYS, securityToken: '  sts-token-value  ' })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.env.ALIBABA_CLOUD_SECURITY_TOKEN, 'sts-token-value')
  assert.ok(launch.secrets.includes('sts-token-value'))
})

test('starts with the server credential chain when no keys are set', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, region: 'cn-beijing' })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.mode, 'chain')
  assert.equal(launch.env.ALIBABA_CLOUD_ACCESS_KEY_ID, undefined)
  assert.equal(launch.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET, undefined)
  assert.equal(launch.env.ALIBABA_CLOUD_REGION_ID, 'cn-beijing')
  assert.deepEqual(launch.secrets, [])
})

test('refuses a half-set key pair or a token without keys', () => {
  assert.deepEqual(buildLaunch({ command: DEFAULT_COMMAND, accessKeyId: 'only-id-value' }), { ok: false, reason: 'partial' })
  assert.deepEqual(buildLaunch({ command: DEFAULT_COMMAND, accessKeySecret: 'only-secret-value' }), { ok: false, reason: 'partial' })
  assert.deepEqual(buildLaunch({ command: DEFAULT_COMMAND, securityToken: 'only-token-value' }), { ok: false, reason: 'partial' })
})

test('builds server flags and rejects the exclusive pair', () => {
  const launch = buildLaunch({
    command: DEFAULT_COMMAND,
    services: ' ecs, vpc ',
    cloudEnv: 'international',
    extraConfig: '{"sls":["GetProject"]}',
    visibleTools: 'OSS_ListBuckets',
    cwd: 'D:\\work\\app',
  })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.deepEqual(launch.args.slice(UV_PREFIX_ARGS.length), [
    '--transport', 'stdio',
    '--services', 'ecs, vpc',
    '--env', 'international',
    '--extra-config', '{"sls":["GetProject"]}',
    '--visible-tools', 'OSS_ListBuckets',
  ])
  assert.equal(launch.cwd, 'D:\\work\\app')
  assert.equal(launch.args.includes('domestic'), false)

  const deploy = buildLaunch({ command: DEFAULT_COMMAND, codeDeploy: true })
  assert.equal(deploy.ok, true)
  if (!deploy.ok) return
  assert.equal(deploy.args.includes('--code-deploy'), true)
  assert.deepEqual(
    buildLaunch({ command: DEFAULT_COMMAND, codeDeploy: true, visibleTools: 'OSS_ListBuckets' }),
    { ok: false, reason: 'exclusive' },
  )
})

test('rejects an empty or broken command', () => {
  assert.deepEqual(buildLaunch({ command: '   ' }), { ok: false, reason: 'command' })
  assert.deepEqual(buildLaunch({ command: 'C:\\mcp\\server.exe\n--help' }), { ok: false, reason: 'command' })
})

test('redacts longer secrets before shorter ones', () => {
  const text = redactSecrets('id=LTAI-test-id-value secret=secret-test-value', ['secret-test', 'secret-test-value', 'x'])
  assert.equal(text.includes('secret-test'), false)
  assert.equal(text.includes('LTAI-test-id-value'), true)
  assert.match(text, /secret=\[redacted\]/)
})
