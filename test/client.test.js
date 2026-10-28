import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MODULE_CATALOG,
  MODULE_IDS,
  PKG_NAME,
  SETTINGS_NS,
  createClient,
  estimate,
  readNamespace,
  selectionToValue,
  valueToSelection,
} from '../src/client.js'
import { DEFAULT_MODULES, MODULE_NAMES, resolveModules } from '../src/modules.js'

test('every module the picker offers is a host module name', () => {
  for (const id of MODULE_IDS) {
    assert.ok(MODULE_NAMES.includes(id), `${id} is a host module name`)
    assert.equal(resolveModules(id).ok, true, `${id} resolves`)
  }
})

test('the picker offers every measured module once', () => {
  assert.equal(new Set(MODULE_IDS).size, MODULE_IDS.length)
  assert.deepEqual(MODULE_IDS, MODULE_CATALOG.map((item) => item.id))
  for (const item of MODULE_CATALOG) {
    assert.ok(item.tools > 0, `${item.id} has tools`)
    assert.ok(item.group === 'fast' || item.group === 'slow', `${item.id} has a group`)
  }
})

test('a stored value round-trips through the checkboxes', () => {
  assert.deepEqual(valueToSelection(DEFAULT_MODULES), ['core', 'api', 'deploy'])
  assert.equal(selectionToValue(['core', 'api', 'deploy']), DEFAULT_MODULES)
  assert.deepEqual(valueToSelection(' ecs , vpc '), ['ecs', 'vpc'])
  assert.equal(selectionToValue(['vpc', 'ecs']), 'ecs,vpc')
})

test('empty, all, and unknown-only values mean the full surface', () => {
  for (const value of ['', '   ', 'all', 'ALL', 'core,all', 'bogus', undefined, null, 42]) {
    assert.equal(valueToSelection(value), 'all', `${String(value)} means all`)
  }
  assert.equal(selectionToValue('all'), 'all')
  assert.equal(selectionToValue([]), 'all')
  // Ticking every module means the same thing as `all`, so store the short form.
  assert.equal(selectionToValue(MODULE_IDS), 'all')
  assert.equal(selectionToValue(MODULE_IDS.filter((id) => id !== 'rds')), 'core,api,deploy,oss,oos,cms,local,ecs,vpc')
})

test('unknown names are dropped instead of reaching the server', () => {
  assert.deepEqual(valueToSelection('ecs,bogus,core'), ['core', 'ecs'])
})

test('estimate separates fast tools from slow startup cost', () => {
  const fast = estimate(['core', 'api'])
  assert.equal(fast.fastTools, 33)
  assert.equal(fast.slowTools, 0)

  const slow = estimate(['core', 'ecs', 'vpc'])
  assert.equal(slow.fastTools, 29)
  assert.equal(slow.slowTools, 10)
  assert.ok(Math.abs(slow.slowSeconds - 12.3) < 1e-9, `slow seconds ${slow.slowSeconds}`)
})

test('readNamespace accepts both describe shapes', () => {
  const listed = readNamespace({
    ok: true,
    value: { namespaces: [{ ns: SETTINGS_NS, value: { modules: 'core' }, revision: 7 }] },
  })
  assert.deepEqual(listed, { value: { modules: 'core' }, revision: 7 })

  const keyed = readNamespace({
    namespaces: { [SETTINGS_NS]: { value: { modules: 'all' }, revision: 3 } },
  })
  assert.deepEqual(keyed, { value: { modules: 'all' }, revision: 3 })

  assert.equal(readNamespace({ namespaces: [] }), null)
  assert.equal(readNamespace({}), null)
})

test('createClient refuses to build without React', () => {
  assert.throws(() => createClient({}), /needs React/u)
})

test('apply registers the picker on the component row, not the package page', () => {
  const registered = []
  const injected = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {} },
    slots: {
      inject: (name, factory) => { injected.push(name); factory() },
      register: (options, component) => { registered.push({ options, component }); return component },
    },
  }
  const client = createClient({ React: { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} } })
  client.apply(ctx)

  // The picker lives on the package detail page; `modules` is a volatile host
  // field, which is what exposes the namespace through the settings remote.
  assert.deepEqual(injected, ['plugins.bundle.config'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'plugins.bundle.config')
  assert.equal(registered[0].options.key, PKG_NAME)
  assert.equal(registered[0].options.locale, 'alibabaMcp')
  assert.equal(typeof registered[0].component, 'function')
})
