/**
 * @module dsh-alibaba-mcp/modules
 *
 * Module catalog for the Alibaba Cloud Ops MCP server.
 *
 * The server publishes 40 tools by default. Building that list is expensive:
 * the 11 "dynamic API" tools (ECS/VPC/RDS) each fetch their schema over HTTPS
 * from api.aliyun.com, which costs about 11 seconds of startup on a warm cache.
 * The static tool modules (OOS/CMS/OSS/LOCAL) and the four common-API tools
 * need no network at all.
 *
 * Measured against `alibaba-cloud-ops-mcp-server` 0.9.27 on this machine
 * (initialize + tools/list over stdio):
 *
 *   all (default)               40 tools   14.30s
 *   core (static only)          29 tools    3.11s
 *   core + api (common tools)   33 tools    2.92s
 *   api only                     4 tools    2.96s
 *   ecs (dynamic)                8 tools   10.27s
 *   code deploy                  7 tools    3.06s
 *
 * So a module selection is expressed as a `--visible-tools` whitelist. Tool
 * names must match the server exactly: the server treats an unknown `X_Y` name
 * as a dynamic API, asks api.aliyun.com about it, and aborts startup when the
 * API does not exist. Resolve names here, never from free-form user input.
 */

/** Static tools: registered from local Python modules, no network at startup. */
const STATIC_TOOLS = {
  oss: [
    'OSS_DeleteBucket',
    'OSS_ListBuckets',
    'OSS_ListObjects',
    'OSS_PutBucket',
  ],
  oos: [
    'OOS_CodeDeploy',
    'OOS_GetDeployStatus',
    'OOS_GetLastDeploymentInfo',
    'OOS_RebootInstances',
    'OOS_RebootRDSInstances',
    'OOS_ReplaceSystemDisk',
    'OOS_ResetPassword',
    'OOS_RunCommand',
    'OOS_RunInstances',
    'OOS_StartInstances',
    'OOS_StartRDSInstances',
    'OOS_StopInstances',
    'OOS_StopRDSInstances',
  ],
  cms: [
    'CMS_GetCpuloadavg15mData',
    'CMS_GetCpuloadavg5mData',
    'CMS_GetCpuLoadavgData',
    'CMS_GetCpuUsageData',
    'CMS_GetDiskTotalData',
    'CMS_GetDiskUsageData',
    'CMS_GetDiskUsedData',
    'CMS_GetMemUsageData',
    'CMS_GetMemUsedData',
  ],
  local: [
    'LOCAL_AnalyzeDeployStack',
    'LOCAL_ListDirectory',
    'LOCAL_RunShellScript',
  ],
}

/**
 * Dynamic tools: the server fetches each schema over HTTPS at startup.
 * Selecting one of these modules pays roughly one second per tool.
 */
const DYNAMIC_TOOLS = {
  ecs: [
    'ECS_DeleteInstances',
    'ECS_DescribeAccountAttributes',
    'ECS_DescribeAvailableResource',
    'ECS_DescribeImages',
    'ECS_DescribeInstances',
    'ECS_DescribeRegions',
    'ECS_DescribeSecurityGroups',
    'ECS_DescribeZones',
  ],
  vpc: [
    'VPC_DescribeVpcs',
    'VPC_DescribeVSwitches',
  ],
  rds: [
    'RDS_DescribeDBInstances',
  ],
}

/**
 * The four common-API tools. They are registered from static Python code and
 * only require `--services` so the server can list supported services. They
 * reach every Alibaba Cloud API through `CommonAPICaller` without paying the
 * per-API schema fetch at startup.
 */
const COMMON_TOOLS = [
  'PromptUnderstanding',
  'ListAPIs',
  'GetAPIInfo',
  'CommonAPICaller',
]

/** The six deploy tools plus `ECS_DescribeInstances`, all served from static code. */
const DEPLOY_TOOLS = [
  'OOS_CodeDeploy',
  'OOS_GetDeployStatus',
  'OOS_GetLastDeploymentInfo',
  'ECS_DescribeInstances',
  'LOCAL_ListDirectory',
  'LOCAL_RunShellScript',
  'LOCAL_AnalyzeDeployStack',
]

/** Modules that only need static Python code. */
export const STATIC_MODULES = [...Object.keys(STATIC_TOOLS), 'deploy']

/** Modules that fetch schemas over the network at startup. */
export const DYNAMIC_MODULES = Object.keys(DYNAMIC_TOOLS)

/**
 * Default `modules` value. It keeps every tool that needs no network at startup
 * (34 tools, measured 3.09s) while dropping the dynamic ECS/VPC/RDS tools that
 * cost about a second each. Set `modules: all` to restore the full 40-tool
 * surface, or add `ecs`, `vpc`, `rds` for the concrete tools.
 */
export const DEFAULT_MODULES = 'core,api,deploy'

/** Every module name a user may put in `modules`. */
export const MODULE_NAMES = [
  ...Object.keys(STATIC_TOOLS),
  ...DYNAMIC_MODULES,
  'local',
  'deploy',
  'api',
  'core',
  'all',
]

const TOOLS_BY_MODULE = {
  ...STATIC_TOOLS,
  ...DYNAMIC_TOOLS,
  deploy: DEPLOY_TOOLS,
  api: COMMON_TOOLS,
  core: [
    ...STATIC_TOOLS.oss,
    ...STATIC_TOOLS.oos,
    ...STATIC_TOOLS.cms,
    ...STATIC_TOOLS.local,
  ],
}

/** Services passed to `--services` so the common-API tools can list them. */
export const DEFAULT_COMMON_SERVICES = 'ecs,vpc,rds'

/**
 * Resolve a `modules` setting into server flags.
 *
 * An empty string, `all`, or a missing value keeps the server's default 40-tool
 * surface. Any other value crops the surface down to the listed modules.
 *
 * @param {unknown} modules comma-separated module names
 * @returns {{ ok: true, crop: boolean, modules: string[], visibleTools: string[], services: string }
 *   | { ok: false, reason: 'unknown-module', module: string }}
 */
export function resolveModules(modules) {
  const raw = typeof modules === 'string' ? modules.trim() : ''
  if (!raw) return untrimmed()

  const requested = raw
    .split(/[\s,]+/u)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (requested.length === 0) return untrimmed()

  if (requested.includes('all')) {
    if (requested.length > 1) {
      // `all` wins; the rest would only widen an already-complete surface.
    }
    return untrimmed()
  }

  const unknown = requested.find((item) => !MODULE_NAMES.includes(item))
  if (unknown) return { ok: false, reason: 'unknown-module', module: unknown }

  const ordered = []
  for (const item of requested) {
    if (!ordered.includes(item)) ordered.push(item)
  }

  const visibleTools = []
  for (const item of ordered) {
    for (const tool of TOOLS_BY_MODULE[item]) {
      if (!visibleTools.includes(tool)) visibleTools.push(tool)
    }
  }

  return {
    ok: true,
    crop: true,
    modules: ordered,
    visibleTools,
    services: ordered.includes('api') ? DEFAULT_COMMON_SERVICES : '',
  }
}

function untrimmed() {
  return { ok: true, crop: false, modules: ['all'], visibleTools: [], services: '' }
}

/**
 * Tools this catalog knows by name. `buildLaunch` rejects anything else so an
 * unknown name can never reach the server and abort its startup.
 * @returns {Set<string>}
 */
export function knownTools() {
  return new Set(Object.values(TOOLS_BY_MODULE).flat())
}

/**
 * Unwrap a `.volatile()` config value.
 *
 * schemastery resolves a volatile field to the ref object `createVolatile()`
 * returns, not to the raw value (`Schema.resolve`, volatile branch). Reading it
 * as a plain string therefore fails: `typeof ref !== 'string'`, `resolveModules`
 * sees an empty value, and the plugin silently falls back to the server's full
 * 40-tool surface with no `--visible-tools` on the command line.
 *
 * The ref is also what makes a hot update visible: `loader/volatile-update`
 * calls `updateVolatile(ref, source)`, so reading `ref.get()` at connect time
 * always picks up the current GUI value.
 *
 * @param {unknown} value raw config value or volatile ref
 * @returns {unknown} the underlying value, or the input when it is not a ref
 */
export function unwrapVolatile(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}
