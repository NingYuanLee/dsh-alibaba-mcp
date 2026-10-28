# dsh-alibaba-mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2%20%3C0.3.0--0-6f42c1)](package.json)

> Third-party plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Not an official DeepSeek or Alibaba Cloud product. MIT licensed.

English | [中文](README.zh.md)

Connects the local [Alibaba Cloud Ops MCP server](https://github.com/aliyun/alibaba-cloud-ops-mcp-server) and registers the tools that process publishes. They show up as `mcp__alibaba__*`.

## What it does

The agent can call the Alibaba Cloud Ops server that already lives in `D:\tools\mcp\vendor\alibaba`. The plugin does not download another copy and does not run `uvx`. It starts that venv's `alibaba-cloud-ops-mcp-server.exe` over stdio and hands the connection to `@deepseek-ai/dsh-mcp-client`.

Access keys are read from the DSH credential store and passed only on the child environment. They are not stored in `cordis.patch.yml`. The MCP client scrubs ambient names that look like keys, so a value left only in the parent process environment would not reach the child.

If neither key is set, the plugin still starts the server. The server then uses its own credential chain. Saving a credential reconnects.

## How it works

1. Resolve `accessKeyIdEnv` and `accessKeySecretEnv` (defaults `ALIBABA_CLOUD_ACCESS_KEY_ID` and `ALIBABA_CLOUD_ACCESS_KEY_SECRET`) through `ctx.credentials`. The store wins over the process environment. Optional `securityTokenEnv` and `regionEnv` use the same path.
2. Refuse to spawn when only one of the key pair is set, or when a security token is set without the pair. Also refuse when two cropping switches are set at once: `codeDeploy`, `visibleTools`, and a `modules` value other than `all` are mutually exclusive.
3. Spawn `command` with `--transport stdio` and the selected server flags. The child cwd is `cwd` when set, otherwise the directory that contains `command`.
4. Mount one `@deepseek-ai/dsh-mcp-client` child. Tool names, schemas, and results come from the server. This package does not reimplement them.
5. When `credentials/reference-updated` fires for one of the four credential names, dispose that child and connect again.

Each tool call times out after 10 minutes. A dropped connection uses the MCP client's own reconnect policy.

## Install

```bash
dsh plugin --profile web add dsh-alibaba-mcp
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` writes the bundle into the profile. Restart DeepSeek Harness if the tools do not appear in the current session.

Create an AccessKey in the Alibaba Cloud console, then set these credentials in this plugin's settings, or export the same names in the environment that launches DeepSeek Harness:

- `ALIBABA_CLOUD_ACCESS_KEY_ID`
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`

`ALIBABA_CLOUD_SECURITY_TOKEN` and `ALIBABA_CLOUD_REGION_ID` are optional.

The default `command` is the console script in `D:\tools\mcp\vendor\alibaba\.venv` (package `alibaba-cloud-ops-mcp-server` 0.9.27). On another machine, set `command` to that host's script.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `accessKeyIdEnv` | `ALIBABA_CLOUD_ACCESS_KEY_ID` | Credential reference for the AccessKey ID. The value is not kept in this config. |
| `accessKeySecretEnv` | `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | Credential reference for the AccessKey secret. |
| `securityTokenEnv` | `ALIBABA_CLOUD_SECURITY_TOKEN` | Optional STS token reference. Ignored when empty. A token without the key pair does not connect. |
| `regionEnv` | `ALIBABA_CLOUD_REGION_ID` | Optional region reference. Ignored when empty. |
| `command` | the venv `alibaba-cloud-ops-mcp-server.exe` | Stdio executable. Absolute paths are checked before spawn. |
| `cwd` | directory of `command` | Working directory of the child. Set this to a project root when using code deploy. |
| `serverName` | `alibaba` | Namespace for tool names: `mcp__<serverName>__<tool>`. Must match `[A-Za-z0-9_-]{1,32}` and be unique among MCP clients in the same scope. |
| `services` | empty | Comma-separated service list passed as `--services`. Empty keeps the server default. Note that this does **not** reduce the tool surface: the server only uses it to register the common-API tools, so it can even add tools. |
| `modules` | `core,api,deploy` | Comma-separated module switch. The default asks only for tools that need no network at startup (34 tools, about 3s). `all` restores the server's full 40-tool surface. Any value becomes a `--visible-tools` whitelist. Modules: `core`, `api`, `deploy`, `oss`, `oos`, `cms`, `local`, `ecs`, `vpc`, `rds`. Exclusive with `visibleTools` and `codeDeploy`. |
| `cloudEnv` | `domestic` | `domestic` or `international`. `international` is passed as `--env international`. |
| `extraConfig` | empty | Passed as `--extra-config` when set. Do not put secrets here. |
| `visibleTools` | empty | Comma-separated whitelist passed as `--visible-tools`. |
| `codeDeploy` | `false` | Pass `--code-deploy`. Cannot be combined with `visibleTools`. |
| `toolCallTimeoutMs` | `600000` | Per-call timeout in milliseconds. |

Example profile override. A later patch replaces the whole `config` object, so repeat every field you still want:

```yaml
- id: alibaba-mcp
  config:
    serverName: alibaba
    command: D:\tools\mcp\vendor\alibaba\.venv\Scripts\alibaba-cloud-ops-mcp-server.exe
    cloudEnv: domestic
```

The Cordis row id is `alibaba-mcp`. The package name is `dsh-alibaba-mcp`.

From 0.3.0 the plugin ships a client-side settings panel: open "Plugins → Alibaba Cloud Ops" in DSH, tick the modules you want, and saving writes the profile patch and reconnects the MCP, so the YAML edit is no longer required. The panel only offers the modules in the table above; when `codeDeploy` or `visibleTools` already trims the tool surface, it asks you to clear them first.

## Startup cost

The server builds its tool surface at startup. Left alone it publishes 40 tools, and 11 of them are "dynamic API" tools whose schemas it fetches over HTTPS from `api.aliyun.com`. That is the slow part. `--services` does not help here: it only registers the common-API tools, so it can even grow the surface.

Since 0.2.0 the plugin asks for the network-free subset by default (`modules: core,api,deploy`), which is 34 tools in about 3 seconds. `modules` turns the surface into a `--visible-tools` whitelist. Measured with server 0.9.27 on this machine (initialize plus tools/list over stdio, warm disk cache):

| `modules` | Tools | Startup |
|---|---|---|
| `all` (0.1.0 default) | 40 | 14.30s |
| `core,api,deploy` (default) | 34 | 3.09s |
| `core,api` | 33 | 2.86s |
| `core` | 29 | 3.11s |
| `deploy` | 7 | 2.89s |
| `api` | 4 | 2.96s |
| `ecs` | 8 | 10.27s |

`core` is `oss,oos,cms,local`. `api` adds `PromptUnderstanding`, `ListAPIs`, `GetAPIInfo`, and `CommonAPICaller`; the last one reaches every Alibaba Cloud API without a startup schema fetch. `ecs`, `vpc`, and `rds` are the dynamic modules, and each tool they add costs roughly a second at startup, so leave them off unless the agent needs those concrete tools.

If you mostly run OOS, OSS, CMS, or deployment work, `modules: core,api,deploy` gives you the full static surface plus generic API access in about 3 seconds instead of 14.

The plugin logs the real handshake time on every connect, so you can check the effect in its log rather than trusting this table.

## Security

- Resolved keys are sent only to the child process, as environment variables.
- This plugin's own log lines do not print the keys. Client errors are redacted when they contain a resolved secret.
- Cloud tool arguments are sent to Alibaba Cloud by the upstream server.
- The upstream server can also list local directories and run a local shell. This plugin does not add those tools; it does not remove them either. Use `visibleTools` to narrow the set.
- The plugin does not read the credentials file directly and does not open a port.

See [SECURITY.md](SECURITY.md).

## Compatibility

| Item | Value |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0-0` |
| Node | `>=22.19.0` |
| Server | local `alibaba-cloud-ops-mcp-server` 0.9.27 in `D:\tools\mcp\vendor\alibaba` |
| Requires | `credentials`, `tools`, and the shipped `@deepseek-ai/dsh-mcp-client` |

Display metadata is `locale/en.json`, `locale/zh.json`, and `icon.svg`. There is no Web UI and no build step.

## Uninstall

```bash
dsh plugin --profile <name> remove dsh-alibaba-mcp
```

Removing the plugin stops the child process and unregisters its tools. It does not delete the AccessKey credentials or the venv. Nothing else is stored on disk by this package.

## Troubleshooting

**No `mcp__alibaba__*` tools.** The command path is wrong, only one of the key pair is set, or another MCP client already reserved `serverName` `alibaba`. The plugin log says which case it hit and does not print the key.

**The server starts but cloud calls fail.** The credential chain inside the child has no usable key. Save both AccessKey credentials and wait for the reconnect.

**`serverName` is already in use.** Pick another `serverName` in config. That also changes the public tool names.

**A call times out.** OOS and deploy calls can be slow. The limit is 10 minutes per call (`toolCallTimeoutMs`).

## Development

```bash
node --test test/*.test.js
node --check src/index.js && node --check src/launch.js
```

```text
src/modules.js   module catalog and the modules -> --visible-tools resolver (unit-tested)
src/launch.js    pure argv and env builder (unit-tested, no network, no secrets in argv)
src/index.js     Cordis plugin: resolve credentials and mount dsh-mcp-client
locale/          display metadata (en, zh)
test/            node:test suites
```
