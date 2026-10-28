/**
 * @module dsh-alibaba-mcp/client
 *
 * Client half of the Alibaba Cloud Ops MCP plugin.
 *
 * The host half (src/index.js) turns `config.modules` into the server's
 * `--visible-tools` whitelist. Without this file that setting can only be
 * edited in cordis.patch.yml; with it the plugin manager renders a module
 * picker on the plugin's detail page and writes the value back through the
 * settings remote.
 *
 * This module is deliberately dependency-free ESM: React arrives through
 * `createClient`, so the file type-checks with `node --check`, unit tests can
 * import it in plain Node, and scripts/build-client.mjs can wrap it into the
 * `window.__ModuleLoader__` factory the web client expects. Keep every export a
 * top-level `export function` / `export const`; the build script strips the
 * `export ` prefix.
 */

/** Settings namespace = the plugin instance id in cordis.patch.yml. */
export const SETTINGS_NS = 'alibaba-mcp'

/** Package name; the plugin manager keys the detail-page slot by it. */
export const PKG_NAME = 'dsh-alibaba-mcp'

/**
 * Cordis services this client plugin needs.
 *
 * The host only puts a service on `ctx` when the entry exports it here. Without
 * this export `ctx.slots` and `ctx.locale` are undefined, `apply()` throws, and
 * the whole web boot fails with "1 entry did not activate" instead of just
 * dropping this plugin's settings panel.
 */
export const inject = ['slots', 'remote', 'remote.settings', 'locale']

/**
 * The modules a user may pick, in display order.
 *
 * `tools` and `seconds` are the measured numbers documented in src/modules.js
 * (alibaba-cloud-ops-mcp-server 0.9.27, warm cache). `fast` modules register
 * from static Python code; `slow` ones fetch their schemas over HTTPS at
 * startup, which is why they cost about a second per tool.
 */
export const MODULE_CATALOG = [
  { id: 'core', group: 'fast', tools: 29, seconds: 3.1 },
  { id: 'api', group: 'fast', tools: 4, seconds: 0 },
  { id: 'deploy', group: 'fast', tools: 7, seconds: 0 },
  { id: 'oss', group: 'fast', tools: 4, seconds: 0 },
  { id: 'oos', group: 'fast', tools: 13, seconds: 0 },
  { id: 'cms', group: 'fast', tools: 9, seconds: 0 },
  { id: 'local', group: 'fast', tools: 3, seconds: 0 },
  { id: 'ecs', group: 'slow', tools: 8, seconds: 10.3 },
  { id: 'vpc', group: 'slow', tools: 2, seconds: 2 },
  { id: 'rds', group: 'slow', tools: 1, seconds: 1 },
]

/** Module ids in catalog order. `all` is not a checkbox; it is the fallback. */
export const MODULE_IDS = MODULE_CATALOG.map((item) => item.id)

const MODULE_BY_ID = new Map(MODULE_CATALOG.map((item) => [item.id, item]))

/**
 * Turn a stored `modules` value into the checkbox selection.
 *
 * `''` and `all` both mean "keep the server's default 40-tool surface", so they
 * map to `all`. Unknown names are dropped: they would abort server startup, and
 * the host already reports them in the log.
 *
 * @param {unknown} value stored `modules` string
 * @returns {string[] | 'all'}
 */
export function valueToSelection(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return 'all'
  const requested = raw
    .split(/[\s,]+/u)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (requested.includes('all')) return 'all'
  const picked = MODULE_IDS.filter((id) => requested.includes(id))
  return picked.length > 0 ? picked : 'all'
}

/**
 * Turn a checkbox selection back into the stored `modules` value.
 *
 * An empty selection is written as `all` rather than `''`: both mean the same
 * thing to the server, and `all` survives a round trip through the UI.
 *
 * @param {string[] | 'all'} selection
 * @returns {string}
 */
export function selectionToValue(selection) {
  if (selection === 'all') return 'all'
  const picked = MODULE_IDS.filter((id) => selection.includes(id))
  return picked.length > 0 && picked.length < MODULE_IDS.length ? picked.join(',') : 'all'
}

/**
 * Startup estimate for a selection, for the hint under the checkboxes.
 *
 * This is a rough sum, not the real tool count: `core` overlaps with
 * `oss`/`oos`/`cms`/`local` and `deploy` reuses three core tools, so the server
 * deduplicates names. Saying "about" is honest; inventing an exact total from
 * overlapping sets is not.
 *
 * @param {string[] | 'all'} selection
 * @returns {{ fastTools: number, slowTools: number, slowSeconds: number }}
 */
export function estimate(selection) {
  const picked = selection === 'all' ? MODULE_IDS.slice(0, 3) : selection
  let fastTools = 0
  let slowTools = 0
  let slowSeconds = 0
  for (const id of picked) {
    const item = MODULE_BY_ID.get(id)
    if (!item) continue
    if (item.group === 'fast') fastTools += item.tools
    else {
      slowTools += item.tools
      slowSeconds += item.seconds
    }
  }
  return { fastTools, slowTools, slowSeconds }
}

/**
 * Read one namespace out of a settings.describe() answer.
 *
 * The remote returns `{ ok, value }`, and the value holds either an array of
 * `{ ns, value, revision }` rows or an object keyed by namespace. Both shapes
 * are handled because the transport changed shape once already.
 *
 * @param {unknown} found
 * @returns {{ value: any, revision: number } | null}
 */
export function readNamespace(found) {
  const payload = found?.ok ? found.value : found
  const listed = Array.isArray(payload) ? payload : payload?.namespaces
  const entry = Array.isArray(listed)
    ? listed.find((row) => row?.ns === SETTINGS_NS)
    : listed?.[SETTINGS_NS]
  if (!entry) return null
  const section = entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)
    ? entry.value
    : entry
  return { value: section, revision: entry.revision ?? 0 }
}

/**
 * Build the client plugin.
 *
 * @param {{ React: any }} deps React from the module loader
 * @returns {{ apply: (ctx: any) => void }}
 */
export function createClient(deps) {
  const React = deps?.React
  if (!React || typeof React.createElement !== 'function') {
    throw new Error('dsh-alibaba-mcp client needs React')
  }
  const h = React.createElement

  const dict = {
    zh: {
      'modules.title': '模块',
      'modules.hint': '勾选要暴露给助手的工具模块。保存后插件会按新模块重连本地 MCP。',
      'modules.fast': '启动快（无需联网）',
      'modules.slow': '启动慢（每个工具约一秒拉取 schema）',
      'modules.coreNote': 'core 等于 oss + oos + cms + local。',
      'modules.allNote': '全部模块（40 个工具，约 14 秒）。',
      'modules.all': '全量工具',
      'modules.tools': '{count} 个工具',
      'modules.loading': '正在读取已保存的模块…',
      'modules.estimate': '预计 {fast} 个静态工具；动态模块另加约 {seconds} 秒启动。',
      'modules.estimateAll': '预计 40 个工具，约 14 秒启动。',
      'modules.save': '保存模块',
      'modules.saving': '保存中…',
      'modules.saved': '已保存。插件会按新模块重连。',
      'modules.rejected': '未保存：配置被更高优先级的层级覆盖，或另一处刚改过。',
      'modules.failed': '保存失败：{message}',
      'modules.loadFailed': '读取已保存配置失败，先按默认值显示：{message}',
      'modules.missingNamespace': '没有找到这个插件的设置命名空间，先按默认值显示。',
      'modules.unavailable': '当前页面没有配置接口，只能改 cordis.patch.yml。',
      'modules.summary': '工具模块（core, api, deploy）',
      'modules.blocked': 'codeDeploy 或 visibleTools 已占用工具裁剪，modules 暂不生效。先清掉它们再保存。',
      'modules.core': '核心工具',
      'modules.api': '通用 API',
      'modules.deploy': '部署',
      'modules.oss': 'OSS 存储',
      'modules.oos': 'OOS 运维',
      'modules.cms': 'CMS 监控',
      'modules.local': '本地命令',
      'modules.ecs': 'ECS 操作',
      'modules.vpc': 'VPC 查询',
      'modules.rds': 'RDS 查询',
    },
    en: {
      'modules.title': 'Modules',
      'modules.hint': 'Pick the tool modules the agent can see. Saving reconnects the local MCP with the new set.',
      'modules.fast': 'Fast (no network at startup)',
      'modules.slow': 'Slow (about one second per tool to fetch schemas)',
      'modules.coreNote': 'core equals oss + oos + cms + local.',
      'modules.allNote': 'Every module (40 tools, about 14 seconds).',
      'modules.all': 'All tools',
      'modules.tools': '{count} tools',
      'modules.loading': 'Reading the saved modules…',
      'modules.estimate': 'About {fast} static tools; dynamic modules add about {seconds} seconds.',
      'modules.estimateAll': 'About 40 tools, about 14 seconds to start.',
      'modules.save': 'Save modules',
      'modules.saving': 'Saving…',
      'modules.saved': 'Saved. The plugin reconnects with the new modules.',
      'modules.rejected': 'Not saved: the config is overridden by a higher layer, or another edit just landed.',
      'modules.failed': 'Save failed: {message}',
      'modules.loadFailed': 'Failed to read the saved config; showing defaults: {message}',
      'modules.missingNamespace': 'This plugin has no settings namespace here; showing defaults.',
      'modules.unavailable': 'This page has no config API; edit cordis.patch.yml instead.',
      'modules.summary': 'Tool modules (core, api, deploy)',
      'modules.blocked': 'codeDeploy or visibleTools already trims the tool surface, so modules has no effect. Clear them first.',
      'modules.core': 'Core tools',
      'modules.api': 'Common API',
      'modules.deploy': 'Deploy',
      'modules.oss': 'OSS storage',
      'modules.oos': 'OOS operations',
      'modules.cms': 'CMS monitoring',
      'modules.local': 'Local shell',
      'modules.ecs': 'ECS operations',
      'modules.vpc': 'VPC queries',
      'modules.rds': 'RDS queries',
    },
  }

  function translate(key, params) {
    const template = dict.zh[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }

  const ui = {
    card: {
      display: 'grid',
      gap: 12,
      padding: 16,
      maxWidth: 720,
      border: '0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4))',
      background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2))',
      borderRadius: 'var(--dsw-radius-xl, 20px)',
      color: 'var(--dsw-alias-label-primary)',
    },
    title: { margin: 0, fontSize: 14, fontWeight: 600 },
    hint: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 },
    group: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 600 },
    row: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 },
    meta: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
    all: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 },
    primary: {
      height: 32,
      padding: '0 14px',
      font: 'inherit',
      fontSize: 13,
      color: 'var(--dsw-alias-bg-base, #fff)',
      background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
      border: 0,
      borderRadius: 'var(--dsw-radius-sm, 8px)',
      cursor: 'pointer',
    },
    status: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
    alert: { margin: 0, color: 'var(--dsw-alias-state-error-primary, #c62828)', fontSize: 12, lineHeight: 1.5 },
  }

  function checkboxRow(id, checked, disabled, onChange, tr) {
    const item = MODULE_BY_ID.get(id)
    const isSlow = item.group === 'slow'
    return h('label', { key: id, style: ui.row },
      h('input', {
        type: 'checkbox',
        checked,
        disabled,
        'aria-label': id,
        onChange: (event) => onChange(id, event.target.checked),
      }),
      h('span', null,
        h('code', null, id),
        ' ',
        h('span', null, tr('modules.' + id)),
        h('span', { style: ui.meta },
          ' · ',
          tr('modules.tools', { count: item.tools }),
          isSlow ? ' · +' + item.seconds + 's' : '')))
  }

  /**
   * The module picker, rendered on the package detail page.
   *
   * The only config channel there is the settings remote: `modules` is declared
   * volatile on the host Config, and that is exactly what makes the plugin show
   * up as a settings namespace with a live-editable form.
   * @param {{ view?: string, remote?: any, t?: (key: string, params?: any) => string }} props
   */
  function ModuleSettings(props) {
    const tr = typeof props?.t === 'function' ? props.t : translate
    const remote = props?.remote
    const [selection, setSelection] = React.useState(null)
    const [revision, setRevision] = React.useState(0)
    const [message, setMessage] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [blocked, setBlocked] = React.useState(false)
    const [ready, setReady] = React.useState(false)

    React.useEffect(() => {
      let live = true
      const api = remote?.settings
      if (!api?.describe) {
        setSelection(valueToSelection(''))
        setReady(true)
        setMessage(tr('modules.unavailable'))
        return undefined
      }
      api.describe()
        .then((found) => {
          if (!live) return
          const entry = readNamespace(found)
          if (!entry) {
            setSelection(valueToSelection(''))
            setReady(true)
            setMessage(tr('modules.missingNamespace'))
            return
          }
          const value = entry.value || {}
          setSelection(valueToSelection(value.modules))
          setRevision(entry.revision ?? 0)
          setBlocked(value.codeDeploy === true || Boolean(typeof value.visibleTools === 'string' && value.visibleTools.trim()))
          setReady(true)
        })
        .catch((error) => {
          if (!live) return
          setSelection(valueToSelection(''))
          setReady(true)
          setMessage(tr('modules.loadFailed', { message: error?.message || String(error) }))
        })
      return () => { live = false }
    }, [])

    if (props?.view === 'summary') return h('span', null, tr('modules.summary'))
    if (!ready || selection === null) return h('p', { role: 'status' }, tr('modules.loading'))

    const isAll = selection === 'all'
    // `all` means "the server's full surface"; the checkboxes still show every
    // module so unchecking one leaves the all-mode instead of hiding the list.
    const picked = isAll ? MODULE_IDS.slice() : selection
    const hint = isAll
      ? tr('modules.estimateAll')
      : tr('modules.estimate', {
          fast: estimate(picked).fastTools,
          seconds: estimate(picked).slowSeconds,
        })

    function toggle(id, checked) {
      const base = isAll ? MODULE_IDS.slice() : picked.slice()
      const next = checked ? [...base, id] : base.filter((item) => item !== id)
      setSelection(MODULE_IDS.filter((item) => next.includes(item)))
      setMessage('')
    }

    async function save(value) {
      const api = remote?.settings
      if (typeof api?.mutate !== 'function') {
        setMessage(tr('modules.unavailable'))
        return
      }
      setBusy(true)
      setMessage('')
      try {
        const landed = await api.mutate(SETTINGS_NS, [{ op: 'set', path: ['modules'], value }], revision)
        if (landed?.ok === false) {
          setMessage(tr('modules.rejected'))
          return
        }
        const view = landed?.value
        const nextValue = view?.value || view
        if (nextValue && typeof nextValue === 'object') {
          setRevision(view?.revision ?? revision)
          setSelection(valueToSelection(nextValue.modules))
        }
        setMessage(tr('modules.saved'))
      } catch (error) {
        setMessage(tr('modules.failed', { message: error?.message || String(error) }))
      } finally {
        setBusy(false)
      }
    }

    return h('section', { style: ui.card },
      h('h3', { style: ui.title }, tr('modules.title')),
      h('p', { style: ui.hint }, tr('modules.hint')),
      h('label', { style: ui.all },
        h('input', {
          type: 'checkbox',
          checked: isAll,
          disabled: busy,
          onChange: (event) => setSelection(event.target.checked ? 'all' : MODULE_IDS.slice()),
        }),
        h('span', null, h('strong', null, tr('modules.all')), ' · ', h('span', { style: ui.meta }, tr('modules.allNote')))),
      h('div', { style: { display: 'grid', gap: 8, paddingLeft: 24 } },
        h('p', { style: ui.group }, tr('modules.fast')),
        ...MODULE_CATALOG.filter((item) => item.group === 'fast').map((item) =>
          checkboxRow(item.id, picked.includes(item.id), busy, toggle, tr)),
        h('p', { style: { ...ui.group, marginTop: 4 } }, tr('modules.slow')),
        ...MODULE_CATALOG.filter((item) => item.group === 'slow').map((item) =>
          checkboxRow(item.id, picked.includes(item.id), busy, toggle, tr))),
      h('p', { style: ui.hint }, hint),
      h('p', { style: ui.hint }, tr('modules.coreNote')),
      blocked ? h('p', { role: 'alert', style: ui.alert }, tr('modules.blocked')) : null,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        h('button', {
          type: 'button',
          disabled: busy || blocked,
          onClick: () => void save(selectionToValue(selection)),
          style: ui.primary,
        }, busy ? tr('modules.saving') : tr('modules.save'))),
      message ? h('p', { role: 'status', style: ui.status }, message) : null)
  }

  /**
   * Client entry: register the dictionaries and the detail-page slot.
   * @param {any} ctx cordis client context
   */
  function apply(ctx) {
    if (typeof ctx.locale?.register === 'function') {
      ctx.effect(() => ctx.locale.register('alibabaMcp', dict), 'dsh-alibaba-mcp: dictionaries')
    }
    const locale = typeof ctx.locale?.register === 'function' ? 'alibabaMcp' : undefined
    const options = (base) => (locale ? { ...base, locale } : base)
    // Render the picker on the package detail page; the settings remote is the
    // config channel there, backed by the volatile `modules` field on the host.
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
      options({ name: 'plugins.bundle.config', key: PKG_NAME }),
      (props) => ModuleSettings({ ...props, remote: ctx.remote })))
  }

  return { apply, ModuleSettings }
}
