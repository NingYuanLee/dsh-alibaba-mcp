/**
 * Build the stdio launch plan for the Alibaba Cloud Ops MCP server.
 * Pure: no credentials service, no process spawn, no logging.
 *
 * The server ships as a Python distribution on PyPI, so it is started through
 * uv rather than from a path baked into this package. That keeps the plugin
 * portable: nothing depends on a particular machine's directory layout.
 *
 * Access keys are returned only inside `env` and `secrets`. Callers must not
 * write either value to logs, config, or argv.
 */
import { resolveModules } from './modules.js'

/**
 * uv runs the server from the PyPI distribution.
 *
 * The Python version is pinned to 3.12 on purpose. uv otherwise picks the
 * newest interpreter it can find, and on a machine with Python 3.14 the build
 * of pydantic-core fails: its PyO3 bindings support at most CPython 3.13.
 */
/**
 * The launcher. `uv tool run` is what puts uv's own options in front of the
 * executable; `uvx` is its alias and takes the same options, but the long form
 * is used here because `uv` itself rejects them.
 */
export const DEFAULT_COMMAND = 'uv'
export const UV_RUNNER = 'tool'
export const DEFAULT_PYTHON = '3.12'
export const SERVER_DISTRIBUTION = 'alibaba-cloud-ops-mcp-server==0.9.27'
export const SERVER_EXECUTABLE = 'alibaba-cloud-ops-mcp-server'

/** Official marketplace configs use a 600s call budget. Cloud ops calls can be slow. */
export const TOOL_CALL_TIMEOUT_MS = 600_000

/**
 * Arguments that place uv in front of the server.
 *
 * `--from <distribution>` names the PyPI project, and the executable after it
 * is the console script that project installs. The order matters: uv treats
 * everything before the executable as its own options.
 */
export const UV_PREFIX_ARGS = [UV_RUNNER, 'run', '--python', DEFAULT_PYTHON, '--from', SERVER_DISTRIBUTION, SERVER_EXECUTABLE]

/**
 * @param {object} options
 * @param {string} [options.command]
 * @param {string} [options.cwd]
 * @param {string} [options.accessKeyId]
 * @param {string} [options.accessKeySecret]
 * @param {string} [options.securityToken]
 * @param {string} [options.region]
 * @param {string} [options.services]
 * @param {'domestic' | 'international'} [options.cloudEnv]
 * @param {string} [options.extraConfig]
 * @param {string} [options.visibleTools]
 * @param {boolean} [options.codeDeploy]
 * @param {string} [options.modules]
 * @param {string} [options.python]
 * @returns {{ ok: true, mode: 'keys' | 'chain', command: string, args: string[], env: Record<string, string>, cwd: string, secrets: string[], modules: string[], cropped: boolean, visibleTools: string[] } | { ok: false, reason: 'command' | 'partial' | 'exclusive' | 'unknown-module', module?: string }}
 */
export function buildLaunch(options) {
  const command = clean(options.command)
  if (!command || /[\r\n\0]/u.test(command)) return { ok: false, reason: 'command' }

  const accessKeyId = clean(options.accessKeyId)
  const accessKeySecret = clean(options.accessKeySecret)
  const securityToken = clean(options.securityToken)
  if (Boolean(accessKeyId) !== Boolean(accessKeySecret)) return { ok: false, reason: 'partial' }
  if (securityToken && !accessKeyId) return { ok: false, reason: 'partial' }

  const codeDeploy = options.codeDeploy === true
  const visibleTools = clean(options.visibleTools)
  if (codeDeploy && visibleTools) return { ok: false, reason: 'exclusive' }

  const selected = resolveModules(options.modules)
  if (!selected.ok) return selected
  if (selected.crop && visibleTools) return { ok: false, reason: 'exclusive' }
  if (selected.crop && codeDeploy) return { ok: false, reason: 'exclusive' }

  const args = []
  // A uv command takes the interpreter and the distribution before the
  // executable; a custom command is a ready-made executable and takes neither.
  if (usesUv(command)) {
    const python = clean(options.python) || DEFAULT_PYTHON
    args.push(UV_RUNNER, 'run', '--python', python, '--from', SERVER_DISTRIBUTION, SERVER_EXECUTABLE)
  }
  args.push('--transport', 'stdio')
  const services = clean(options.services) || selected.services
  if (services) args.push('--services', services)
  if (options.cloudEnv === 'international') args.push('--env', 'international')
  const extraConfig = clean(options.extraConfig)
  if (extraConfig) args.push('--extra-config', extraConfig)
  const cropped = selected.visibleTools.join(',')
  const effectiveVisible = codeDeploy ? '' : visibleTools || cropped
  if (codeDeploy) args.push('--code-deploy')
  else if (effectiveVisible) args.push('--visible-tools', effectiveVisible)

  /** @type {Record<string, string>} */
  const env = {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
  /** @type {string[]} */
  const secrets = []
  if (accessKeyId && accessKeySecret) {
    env.ALIBABA_CLOUD_ACCESS_KEY_ID = accessKeyId
    env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = accessKeySecret
    secrets.push(accessKeyId, accessKeySecret)
  }
  if (securityToken) {
    env.ALIBABA_CLOUD_SECURITY_TOKEN = securityToken
    secrets.push(securityToken)
  }
  const region = clean(options.region)
  if (region) env.ALIBABA_CLOUD_REGION_ID = region

  return {
    ok: true,
    mode: accessKeyId ? 'keys' : 'chain',
    command,
    args,
    env,
    cwd: clean(options.cwd) || (usesUv(command) ? '' : parentDirectory(command)),
    secrets,
    modules: selected.modules,
    cropped: selected.crop,
    visibleTools: splitList(effectiveVisible),
  }
}

/**
 * Whether the command is uv, and so needs the distribution prefix.
 * @param {string} command
 */
export function usesUv(command) {
  const base = command.split(/[\\/]/u).pop() ?? ''
  return base.toLowerCase().replace(/\.exe$/u, '') === 'uv'
}

/**
 * Absolute commands can be stat'ed. Bare names are left to PATH lookup.
 *
 * The check is deliberately not `path.isAbsolute`: that one follows the host
 * platform, so a Windows path would read as relative on Linux and the two
 * hosts would disagree about the same setting. Both separators are accepted
 * here, so the answer depends on the value alone.
 *
 * @param {string} command
 */
export function isFileCommand(command) {
  if (typeof command !== 'string') return false
  if (command.startsWith('/')) return true
  return /^[A-Za-z]:[\\/]/u.test(command) || command.startsWith('\\\\')
}

/**
 * Replace known secret values in a client error. Short strings are kept so a
 * 1–3 character value cannot blank out ordinary text.
 * @param {unknown} text
 * @param {readonly string[]} secrets
 */
export function redactSecrets(text, secrets) {
  let out = String(text)
  const unique = [...new Set(secrets.filter((item) => typeof item === 'string' && item.length >= 4))]
  unique.sort((left, right) => right.length - left.length)
  for (const value of unique) out = out.split(value).join('[redacted]')
  return out
}

/**
 * The directory that holds the executable.
 *
 * Written out rather than taken from `path.dirname`, whose separator depends
 * on the host platform: the same configured path must resolve the same way on
 * every host.
 *
 * @param {string} command
 */
function parentDirectory(command) {
  const separator = Math.max(command.lastIndexOf('\\'), command.lastIndexOf('/'))
  if (separator < 0) return ''
  return command.slice(0, separator)
}

/** @param {unknown} value */
function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** @param {string} value */
function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
