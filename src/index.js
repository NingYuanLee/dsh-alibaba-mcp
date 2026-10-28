/**
 * @module dsh-alibaba-mcp
 *
 * Host bundle for the local Alibaba Cloud Ops MCP server
 * (alibaba-cloud-ops-mcp-server, stdio).
 *
 * Access keys never live in cordis.patch.yml. Ambient KEY/SECRET/TOKEN
 * variables are scrubbed before the child starts, so this plugin resolves the
 * credential store itself and passes the values in the child env. A later
 * credential write disposes the client and connects again.
 */
import { access } from 'node:fs/promises'
import { apply as connectMcp, Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_COMMAND, TOOL_CALL_TIMEOUT_MS, buildLaunch, isFileCommand, redactSecrets } from './launch.js'
import { DEFAULT_MODULES, MODULE_NAMES, unwrapVolatile } from './modules.js'

export { DEFAULT_COMMAND, TOOL_CALL_TIMEOUT_MS, buildLaunch, redactSecrets, MODULE_NAMES, DEFAULT_MODULES }
export { resolveModules, unwrapVolatile } from './modules.js'

export const name = 'alibaba-mcp'
export const inject = ['credentials', 'tools']

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

export const Config = z.object({
  accessKeyIdEnv: z.string().role('credential-ref').default('ALIBABA_CLOUD_ACCESS_KEY_ID'),
  accessKeySecretEnv: z.string().role('credential-ref').default('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
  securityTokenEnv: z.string().role('credential-ref').default('ALIBABA_CLOUD_SECURITY_TOKEN'),
  regionEnv: z.string().role('credential-ref').default('ALIBABA_CLOUD_REGION_ID'),
  command: z.string().default(DEFAULT_COMMAND),
  cwd: z.string().default(''),
  serverName: z.string().pattern(SERVER_NAME).default('alibaba'),
  services: z.string().default(''),
  // `volatile()` is what makes a field show up in the GUI settings form: the
  // settings service only projects volatile fields (see volatileForm() in
  // @deepseek-ai/dsh-settings). It also means a change hot-updates this plugin
  // instead of reloading it, so apply() listens for loader/volatile-update.
  modules: z.string().default(DEFAULT_MODULES).volatile(),
  cloudEnv: z.union([z.const('domestic'), z.const('international')]).default('domestic'),
  extraConfig: z.string().default(''),
  visibleTools: z.string().default(''),
  codeDeploy: z.boolean().default(false),
  toolCallTimeoutMs: z.number().min(1).default(TOOL_CALL_TIMEOUT_MS),
})

const mcpPlugin = {
  name: 'alibaba-mcp-connection',
  inject: ['tools'],
  Config: McpConfig,
  apply: connectMcp,
}

export async function apply(ctx, config) {
  let generation = 0
  let fiber
  let queue = Promise.resolve()
  let pending

  const stop = () => {
    generation += 1
    if (pending !== undefined) {
      clearTimeout(pending)
      pending = undefined
    }
    fiber?.dispose()
    fiber = undefined
  }

  const watched = new Set([
    config.accessKeyIdEnv,
    config.accessKeySecretEnv,
    config.securityTokenEnv,
    config.regionEnv,
  ].filter((item) => typeof item === 'string' && item.trim() !== ''))

  async function readCredential(refName) {
    const name = refName?.trim()
    if (!name) return ''
    const hit = await ctx.credentials.resolve(credentialRef(name))
    return hit?.value?.trim() ?? ''
  }

  async function connect(token) {
    fiber?.dispose()
    fiber = undefined
    if (token !== generation) return
    const startedAt = Date.now()

    let accessKeyId = ''
    let accessKeySecret = ''
    let securityToken = ''
    let region = ''
    try {
      accessKeyId = await readCredential(config.accessKeyIdEnv)
      accessKeySecret = await readCredential(config.accessKeySecretEnv)
      securityToken = await readCredential(config.securityTokenEnv)
      region = await readCredential(config.regionEnv)
    } catch (error) {
      ctx.logger.error('阿里云 MCP 未连接：凭据名无法解析。密钥本身不会写在这条日志里。')
      ctx.logger.error(error)
      return
    }
    if (token !== generation) return

    // `modules` is a volatile field, so the config holds a ref object rather
    // than a string. Unwrap it here: passing the ref to buildLaunch would read
    // as an empty value and silently restore the full 40-tool surface.
    const modulesValue = unwrapVolatile(config.modules)
    const launch = buildLaunch({
      command: config.command,
      cwd: config.cwd,
      accessKeyId,
      accessKeySecret,
      securityToken,
      region,
      services: config.services,
      cloudEnv: config.cloudEnv,
      extraConfig: config.extraConfig,
      visibleTools: config.visibleTools,
      codeDeploy: config.codeDeploy,
      // codeDeploy picks its own seven-tool surface, so it must not collide
      // with the default modules value. An explicit modules choice other than
      // the default still wins and is reported as a conflict below.
      modules: config.codeDeploy && modulesValue === DEFAULT_MODULES ? 'all' : modulesValue,
    })
    if (!launch.ok) {
      if (launch.reason === 'partial') {
        ctx.logger.error('阿里云 MCP 未连接：AccessKey ID 与 Secret 必须成对配置。只保存了其中一个，或只配置了 SecurityToken。')
      } else if (launch.reason === 'exclusive') {
        ctx.logger.error('阿里云 MCP 未连接：codeDeploy、visibleTools、modules 三者互斥，只能选一种裁剪方式。')
      } else if (launch.reason === 'unknown-module') {
        ctx.logger.error(`阿里云 MCP 未连接：未知模块 ${launch.module}。可用模块：${MODULE_NAMES.join(', ')}。`)
      } else {
        ctx.logger.error('阿里云 MCP 未连接：command 为空或含有换行。')
      }
      return
    }
    if (token !== generation) return

    if (isFileCommand(launch.command)) {
      try {
        await access(launch.command)
      } catch {
        ctx.logger.error(`阿里云 MCP 未连接：找不到启动程序 ${launch.command}`)
        return
      }
    }
    if (token !== generation) return

    if (launch.mode === 'chain') {
      ctx.logger.warn('阿里云 MCP 未读到成对的 AccessKey。本地服务仍会启动，并使用它自己的凭据链。进程环境里匹配 KEY、SECRET 或 TOKEN 的变量会被清掉；若密钥在环境变量中，请存成同名凭据后再连接。')
    } else {
      ctx.logger.info('阿里云 MCP 使用凭据库中的 AccessKey 连接。密钥不会写在这条日志里。')
    }

    const next = ctx.plugin(mcpPlugin, {
      transport: 'stdio',
      serverName: config.serverName,
      command: launch.command,
      args: launch.args,
      env: launch.env,
      cwd: launch.cwd,
      toolCallTimeoutMs: config.toolCallTimeoutMs,
      failOnStartupError: false,
    })
    if (token !== generation) {
      next.dispose()
      return
    }
    fiber = next
    const surface = launch.cropped
      ? `模块 ${launch.modules.join(',')}，${launch.visibleTools.length} 个工具`
      : '全量工具'
    try {
      await next
      if (token !== generation) return
      ctx.logger.info(`阿里云 MCP 已连接：${surface}，耗时 ${elapsedSeconds(startedAt)}s。`)
    } catch (error) {
      if (token !== generation) return
      ctx.logger.error('阿里云 MCP 连接失败。请检查 command 和凭据。密钥不会写在这条日志里。')
      ctx.logger.error(redactSecrets(error, launch.secrets))
    }
  }

  function elapsedSeconds(startedAt) {
    return ((Date.now() - startedAt) / 1000).toFixed(1)
  }

  function scheduleNow() {
    const token = ++generation
    const run = queue.then(() => connect(token))
    queue = run.then(() => {}, () => {})
    return run
  }

  // One save can emit several config events in a burst, and each one used to
  // start another MCP child. Collapse the burst into one reconnect. The first
  // connect stays immediate so apply() still reports readiness synchronously.
  function scheduleDebounced() {
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      void scheduleNow()
    }, 500)
  }

  ctx.on('credentials/reference-updated', (ref) => {
    if (!watched.has(String(ref))) return
    scheduleDebounced()
  })
  // A volatile field changed (the GUI saved `modules`): reconnect with the new
  // tool whitelist instead of waiting for a restart.
  ctx.on('loader/volatile-update', () => { scheduleDebounced() })
  ctx.effect(() => stop)

  await scheduleNow()
}
