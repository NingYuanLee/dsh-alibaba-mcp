/**
 * Build the stdio launch plan for the local Alibaba Cloud Ops MCP server.
 * Pure: no credentials service, no process spawn, no logging.
 *
 * Access keys are returned only inside `env` and `secrets`. Callers must not
 * write either value to logs, config, or argv.
 */
import { dirname, isAbsolute } from 'node:path'
import { resolveModules } from './modules.js'

/** This machine's uv venv console script. Override `command` on other hosts. */
export const DEFAULT_COMMAND = 'D:\\tools\\mcp\\vendor\\alibaba\\.venv\\Scripts\\alibaba-cloud-ops-mcp-server.exe'

/** Official marketplace configs use a 600s call budget. Cloud ops calls can be slow. */
export const TOOL_CALL_TIMEOUT_MS = 600_000

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

  const args = ['--transport', 'stdio']
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
    cwd: clean(options.cwd) || dirname(command),
    secrets,
    modules: selected.modules,
    cropped: selected.crop,
    visibleTools: splitList(effectiveVisible),
  }
}

/** @param {string} value */
function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Absolute commands can be stat'ed. Bare names are left to PATH lookup. */
export function isFileCommand(command) {
  return isAbsolute(command)
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
  for (const secret of unique) out = out.split(secret).join('[redacted]')
  return out
}

/** @param {unknown} value */
function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}
