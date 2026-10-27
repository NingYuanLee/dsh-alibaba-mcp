import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { DEFAULT_COMMAND, buildLaunch, isFileCommand, redactSecrets } from '../src/launch.js'

const KEYS = {
  accessKeyId: 'LTAI-test-id-value',
  accessKeySecret: 'secret-test-value',
}

test('default command is the local venv script', () => {
  assert.equal(DEFAULT_COMMAND, 'D:\\tools\\mcp\\vendor\\alibaba\\.venv\\Scripts\\alibaba-cloud-ops-mcp-server.exe')
  assert.equal(isFileCommand(DEFAULT_COMMAND), true)
  assert.equal(isFileCommand('alibaba-cloud-ops-mcp-server'), false)
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
  assert.deepEqual(launch.args, ['--transport', 'stdio'])
  const argv = launch.args.join('\n')
  assert.equal(argv.includes(KEYS.accessKeyId), false)
  assert.equal(argv.includes(KEYS.accessKeySecret), false)
  assert.equal(launch.cwd, dirname(DEFAULT_COMMAND))
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
  assert.deepEqual(launch.args, [
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
  assert.deepEqual(deploy.args, ['--transport', 'stdio', '--code-deploy'])
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
