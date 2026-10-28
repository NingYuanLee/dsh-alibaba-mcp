import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_COMMAND, buildLaunch } from '../src/launch.js'
import { DEFAULT_MODULES, MODULE_NAMES, knownTools, resolveModules, unwrapVolatile } from '../src/modules.js'

const toolCount = (modules) => {
  const resolved = resolveModules(modules)
  assert.equal(resolved.ok, true)
  return resolved.crop ? resolved.visibleTools.length : 40
}

test('volatile refs are unwrapped before they reach buildLaunch', () => {
  // `.volatile()` resolves to createVolatile(value), so `config.modules` is a
  // ref object. Passing it through unwrapped made resolveModules see an empty
  // value and the server silently ran with all 40 tools and no --visible-tools.
  assert.equal(unwrapVolatile('core,api'), 'core,api')
  assert.equal(unwrapVolatile(undefined), undefined)
  assert.equal(unwrapVolatile({ get: () => 'core,api,deploy' }), 'core,api,deploy')
  assert.equal(unwrapVolatile({ get: () => { throw new Error('disposed') } }), undefined)

  const ref = { get: () => 'core,api,deploy' }
  const launch = buildLaunch({ command: DEFAULT_COMMAND, modules: unwrapVolatile(ref) })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.cropped, true)
  assert.deepEqual(launch.modules, ['core', 'api', 'deploy'])
  assert.equal(launch.visibleTools.length, 34)
  assert.equal(launch.args.includes('--visible-tools'), true)
  assert.equal(launch.args.includes('--services'), true)

  // The regression this guards: an unwrapped ref must never degrade to "all".
  const broken = buildLaunch({ command: DEFAULT_COMMAND, modules: ref })
  assert.equal(broken.ok, true)
  if (!broken.ok) return
  assert.equal(broken.cropped, false)
  assert.equal(broken.args.includes('--visible-tools'), false)
})

test('empty and all keep the server default surface', () => {
  for (const value of ['', '   ', 'all', 'ALL', undefined, null, 42]) {
    const resolved = resolveModules(value)
    assert.equal(resolved.ok, true)
    assert.equal(resolved.crop, false)
    assert.deepEqual(resolved.modules, ['all'])
    assert.deepEqual(resolved.visibleTools, [])
    assert.equal(resolved.services, '')
  }
})

test('static and common modules match the measured tool counts', () => {
  assert.equal(toolCount('oss'), 4)
  assert.equal(toolCount('oos'), 13)
  assert.equal(toolCount('cms'), 9)
  assert.equal(toolCount('local'), 3)
  assert.equal(toolCount('core'), 29)
  assert.equal(toolCount('api'), 4)
  assert.equal(toolCount('deploy'), 7)
  assert.equal(toolCount('core,api'), 33)
  assert.equal(toolCount('ecs'), 8)
  assert.equal(toolCount('vpc'), 2)
  assert.equal(toolCount('rds'), 1)
  assert.equal(toolCount('core,api,ecs,vpc,rds'), 44)
})

test('module names are trimmed, case-insensitive, and deduplicated', () => {
  const resolved = resolveModules(' OSS , oss ,\tcms ')
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.modules, ['oss', 'cms'])
  assert.equal(resolved.visibleTools.length, 13)
})

test('the api module asks the server for its default service list', () => {
  const resolved = resolveModules('api')
  assert.equal(resolved.ok, true)
  assert.equal(resolved.services, 'ecs,vpc,rds')

  const staticOnly = resolveModules('core')
  assert.equal(staticOnly.services, '')
})

test('unknown modules are rejected instead of reaching the server', () => {
  const resolved = resolveModules('oss,bogus')
  assert.equal(resolved.ok, false)
  assert.equal(resolved.reason, 'unknown-module')
  assert.equal(resolved.module, 'bogus')
})

test('every advertised module resolves to known tools', () => {
  const known = knownTools()
  for (const name of MODULE_NAMES) {
    const resolved = resolveModules(name)
    assert.equal(resolved.ok, true, `${name} resolves`)
    for (const tool of resolved.visibleTools) {
      assert.ok(known.has(tool), `${tool} is a known tool`)
    }
  }
})

test('code deploy keeps the dedicated flag and stays exclusive with modules', () => {
  const deploy = buildLaunch({ command: DEFAULT_COMMAND, codeDeploy: true })
  assert.equal(deploy.ok, true)
  if (!deploy.ok) return
  assert.deepEqual(deploy.args, ['--transport', 'stdio', '--code-deploy'])
  assert.equal(deploy.cropped, false)

  const viaModule = buildLaunch({ command: DEFAULT_COMMAND, modules: 'deploy' })
  assert.equal(viaModule.ok, true)
  if (!viaModule.ok) return
  assert.equal(viaModule.visibleTools.length, 7)
  assert.equal(viaModule.args.includes('--code-deploy'), false)

  assert.deepEqual(
    buildLaunch({ command: DEFAULT_COMMAND, codeDeploy: true, modules: 'core' }),
    { ok: false, reason: 'exclusive' },
  )
})

test('modules and an explicit visibleTools list are exclusive', () => {
  assert.deepEqual(
    buildLaunch({ command: DEFAULT_COMMAND, modules: 'core', visibleTools: 'OSS_ListBuckets' }),
    { ok: false, reason: 'exclusive' },
  )
  const explicitOnly = buildLaunch({ command: DEFAULT_COMMAND, visibleTools: 'OSS_ListBuckets' })
  assert.equal(explicitOnly.ok, true)
  if (!explicitOnly.ok) return
  assert.deepEqual(explicitOnly.args, ['--transport', 'stdio', '--visible-tools', 'OSS_ListBuckets'])
})

test('an explicit services value overrides the api module default', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, modules: 'api', services: 'oss' })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.deepEqual(launch.args, [
    '--transport', 'stdio',
    '--services', 'oss',
    '--visible-tools', 'PromptUnderstanding,ListAPIs,GetAPIInfo,CommonAPICaller',
  ])
})

test('a cropped launch reports what it asked the server for', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, modules: 'core,api' })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.cropped, true)
  assert.deepEqual(launch.modules, ['core', 'api'])
  assert.equal(launch.visibleTools.length, 33)
  assert.equal(launch.args.includes('--visible-tools'), true)
  assert.equal(launch.args.includes('--services'), true)
})

test('an unknown module aborts the launch with a machine-readable reason', () => {
  const launch = buildLaunch({ command: DEFAULT_COMMAND, modules: 'oss,nope' })
  assert.equal(launch.ok, false)
  if (launch.ok) return
  assert.equal(launch.reason, 'unknown-module')
  assert.equal(launch.module, 'nope')
})

test('the default modules value is the network-free surface', () => {
  assert.equal(DEFAULT_MODULES, 'core,api,deploy')

  const resolved = resolveModules(DEFAULT_MODULES)
  assert.equal(resolved.ok, true)
  assert.equal(resolved.crop, true)
  assert.equal(resolved.visibleTools.length, 34)
  assert.equal(resolved.services, 'ecs,vpc,rds')

  const launch = buildLaunch({ command: DEFAULT_COMMAND, modules: DEFAULT_MODULES })
  assert.equal(launch.ok, true)
  if (!launch.ok) return
  assert.equal(launch.cropped, true)
  assert.deepEqual(launch.modules, ['core', 'api', 'deploy'])
  assert.equal(launch.visibleTools.length, 34)
  // No dynamic ECS/VPC/RDS module is selected, so no startup schema fetch.
  assert.equal(launch.visibleTools.some((tool) => tool.startsWith('VPC_') || tool.startsWith('RDS_')), false)
  assert.equal(launch.visibleTools.includes('ECS_DescribeInstances'), true)
})
