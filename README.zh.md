# dsh-alibaba-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/NingYuanLee/dsh-alibaba-mcp/ci.yml?label=CI)](https://github.com/NingYuanLee/dsh-alibaba-mcp/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-alibaba-mcp.svg)](https://www.npmjs.com/package/dsh-alibaba-mcp) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE) [![Node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19.0-339933.svg)](#compatibility) [![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2%20%3C0.3.0--0%20%7C%7C%20%3E%3D0.2.2--0%20%3C0.3.0--0-6f42c1)](#compatibility) [![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-6f42c1.svg)](https://github.com/topics/dsh-plugin) [![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的第三方插件，不是 DeepSeek 或阿里云的官方产品。MIT。

[English](README.md) | 中文

接入本机的 [阿里云运维 MCP 服务器](https://github.com/aliyun/alibaba-cloud-ops-mcp-server)，并注册该进程公布的工具。模型看到的名字是 `mcp__alibaba__*`。

## What it does

助手通过 [uv](https://docs.astral.sh/uv/) 调用阿里云运维 MCP 服务。插件不打包这个服务，也不依赖本机的某个目录：它从 PyPI 运行 `alibaba-cloud-ops-mcp-server`，再把连接交给 `@deepseek-ai/dsh-mcp-client`。

AccessKey 从 DSH 凭据库读取，只放进子进程的环境变量，不会写入 `cordis.patch.yml`。MCP 客户端会清掉父进程里看起来像密钥的变量，所以只放在父进程环境里的值到不了子进程。

两个密钥都没配置时，插件仍会启动服务，由服务自己的凭据链去找密钥。保存凭据后会重新连接。

## How it works

1. 用 `ctx.credentials` 解析 `accessKeyIdEnv` 和 `accessKeySecretEnv`（默认 `ALIBABA_CLOUD_ACCESS_KEY_ID` 和 `ALIBABA_CLOUD_ACCESS_KEY_SECRET`）。凭据库优先于进程环境变量。可选的 `securityTokenEnv` 和 `regionEnv` 走同一条路径。
2. 密钥只配了一半，或只配了 SecurityToken 而没有成对密钥时，不启动。同时打开两种裁剪方式时也不启动：`codeDeploy`、`visibleTools`、以及 `modules` 取 `all` 以外的值，三者互斥。
3. 用 `--transport stdio` 和选中的服务参数启动 `command`。`cwd` 有值时用它，否则用 `command` 所在目录；`command` 是靠 `PATH` 查找的裸名时用当前目录。
4. 挂一个 `@deepseek-ai/dsh-mcp-client` 子插件。工具名、参数和结果都来自服务器，本包不重写这些工具。
5. 四个凭据名之一发出 `credentials/reference-updated` 时，拆掉该子插件再连一次。

单次工具调用超时 10 分钟。连接断开后沿用 MCP 客户端自己的重连策略。

## Install

```bash
dsh plugin --profile web add dsh-alibaba-mcp
```

包里声明了 `dsh.bundle.patch`，`dsh plugin add` 会把 bundle 写进 profile。如果当前会话里还看不到工具，重启 DeepSeek Harness。

在阿里云控制台创建 AccessKey，然后在本插件的设置里保存同名凭据，或在启动 DeepSeek Harness 的环境里导出：

- `ALIBABA_CLOUD_ACCESS_KEY_ID`
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`

`ALIBABA_CLOUD_SECURITY_TOKEN` 和 `ALIBABA_CLOUD_REGION_ID` 可选。

### 前置条件

服务是 Python 发行包，所以通过 [uv](https://docs.astral.sh/uv/getting-started/installation/) 启动。先装一次 uv：

```bash
# Windows
winget install --id=astral-sh.uv -e
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

插件连接前会检查 `uv` 是否存在，缺失时明确报出这个前置条件，而不是抛一个 spawn 错误。插件自己不会安装任何东西。

Python 版本固定为 **3.12**（`python` 设置项）。这不是随意选的：uv 默认会选它能找到的最新解释器，而在 CPython 3.14 上 `pydantic-core` 编译失败——它的 PyO3 绑定最高只支持 3.13。看到这个编译错误就说明机器默认解释器太新，uv 首次运行会自己下载一个托管的 3.12。

## Configuration

| 字段 | 默认 | 含义 |
|---|---|---|
| `accessKeyIdEnv` | `ALIBABA_CLOUD_ACCESS_KEY_ID` | AccessKey ID 的凭据引用。值不会留在这份配置里。 |
| `accessKeySecretEnv` | `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | AccessKey Secret 的凭据引用。 |
| `securityTokenEnv` | `ALIBABA_CLOUD_SECURITY_TOKEN` | 可选的 STS Token 引用。空值忽略。没有成对密钥时即使有 Token 也不连接。 |
| `regionEnv` | `ALIBABA_CLOUD_REGION_ID` | 可选的地域引用。空值忽略。 |
| `command` | `uv` | stdio 启动器。默认通过 uv 跑服务；裸名在 `PATH` 上查找。绝对路径直接使用，并在启动前检查是否存在。 |
| `python` | `3.12` | 传给 uv 的 `--python` 解释器版本。固定版本是因为 uv 默认选最新解释器，而 CPython 3.14 会让 `pydantic-core` 编译失败。 |
| `cwd` | `command` 所在目录 | 子进程工作目录。做代码部署时把它设成项目根目录。裸名命令留空。 |
| `serverName` | `alibaba` | 工具名前缀：`mcp__<serverName>__<tool>`。必须匹配 `[A-Za-z0-9_-]{1,32}`，且在同一作用域的 MCP 客户端里唯一。 |
| `services` | 空 | 逗号分隔的服务列表，传给 `--services`。空则沿用服务器默认。注意它**不减少**工具数量：服务器只用它注册通用 API 工具，所以它甚至可能增加工具。 |
| `modules` | `core,api,deploy` | 逗号分隔的模块开关。默认只请求启动时不需要联网的工具（34 个，约 3 秒）。`all` 恢复服务器全量 40 个工具。任何取值都会转成 `--visible-tools` 白名单。模块：`core`、`api`、`deploy`、`oss`、`oos`、`cms`、`local`、`ecs`、`vpc`、`rds`。与 `visibleTools`、`codeDeploy` 互斥。 |
| `cloudEnv` | `domestic` | `domestic` 或 `international`。后者会传 `--env international`。 |
| `extraConfig` | 空 | 有值时传给 `--extra-config`。不要把密钥写在这里。 |
| `visibleTools` | 空 | 逗号分隔的白名单，传给 `--visible-tools`。 |
| `codeDeploy` | `false` | 传 `--code-deploy`。不能和 `visibleTools` 同时使用。 |
| `toolCallTimeoutMs` | `600000` | 单次调用超时，单位毫秒。 |

profile 覆盖示例。后写的补丁会整份替换 `config`，所以仍然需要的字段都要再写一遍：

```yaml
- id: alibaba-mcp
  config:
    serverName: alibaba
    python: '3.12'
    cloudEnv: domestic
```

Cordis 行 id 是 `alibaba-mcp`。包名是 `dsh-alibaba-mcp`。

从 0.3.0 起，插件自带客户端设置面板：在 DSH 的「插件 → 阿里云运维」详情页直接勾选模块，保存后会写回 profile 补丁并重连 MCP，不必手改 YAML。面板只列上表里的模块；如果 `codeDeploy` 或 `visibleTools` 已经占用了工具裁剪，面板会提示先清掉它们再保存。

## Startup cost

服务器在启动时构建工具表。放任不管时它会发布 40 个工具，其中 11 个是“动态 API”工具，它们的 schema 要在启动时从 `api.aliyun.com` 走 HTTPS 拉取。慢的就是这一段。`--services` 帮不上忙：它只注册通用 API 工具，所以反而可能让工具数量变多。

从 0.2.0 起，插件默认只请求启动时不需要联网的子集（`modules: core,api,deploy`），34 个工具，约 3 秒。`modules` 把工具表转成 `--visible-tools` 白名单。在本机用 0.9.27 实测（stdio 下 initialize 加 tools/list，磁盘缓存已热）：

| `modules` | 工具数 | 启动 |
|---|---|---|
| `all`（0.1.0 默认） | 40 | 14.30s |
| `core,api,deploy`（默认） | 34 | 3.09s |
| `core,api` | 33 | 2.86s |
| `core` | 29 | 3.11s |
| `deploy` | 7 | 2.89s |
| `api` | 4 | 2.96s |
| `ecs` | 8 | 10.27s |

`core` 等于 `oss,oos,cms,local`。`api` 额外加 `PromptUnderstanding`、`ListAPIs`、`GetAPIInfo`、`CommonAPICaller`，其中 `CommonAPICaller` 能调用任意阿里云 API，且启动时不用拉 schema。`ecs`、`vpc`、`rds` 是动态模块，它们带来的每个工具在启动时大约要花一秒，所以除非确实要这些具体工具，否则别开。

如果你主要做 OOS、OSS、CMS 或部署，用 `modules: core,api,deploy` 就能在约 3 秒拿到全部静态工具加通用 API 能力，而不是 14 秒。

插件每次连接都会打印真实握手耗时，你可以看日志核对，不必只信这张表。

## Security

- 解析出来的密钥只放进子进程环境变量。
- 本插件自己的日志不打印密钥。客户端错误里如果带了已解析的密钥，会先打成 `[redacted]`。
- 云工具的参数由上游服务器发给阿里云。
- 上游服务器还能列出本机目录并执行本机 shell。这些工具不是本插件加的，本插件也不会删掉它们。要用 `visibleTools` 收窄。
- 插件不直接读凭据文件，也不监听端口。

详见 [SECURITY.md](SECURITY.md)。

## Compatibility

| 项 | 值 |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0-0 \|\| >=0.2.2-0 <0.3.0-0` |
| Node | `>=22.19.0` |
| 已验证 | dsh `0.2.2-rc.1` |
| 服务器 | 来自 PyPI 的 `alibaba-cloud-ops-mcp-server` 0.9.27，通过 uv 启动 |
| 依赖 | `credentials`、`tools`，以及自带的 `@deepseek-ai/dsh-mcp-client` |

显示元数据是 `locale/en.json`、`locale/zh.json` 和 `icon.svg`。没有 Web UI，也没有构建步骤。

## Uninstall

```bash
dsh plugin --profile <name> remove dsh-alibaba-mcp
```

卸掉插件会停掉子进程并注销它的工具。不会删除 AccessKey 凭据。服务本身留在 uv 的缓存里，由 uv 自己按规则清理。

## Troubleshooting

**看不到 `mcp__alibaba__*`。** `PATH` 上没有 `uv`、密钥只配了一半，或别的 MCP 客户端已经占用了 `serverName` `alibaba`。插件日志会说明是哪一种，并且不打印密钥。

**`PATH 上找不到 uv`。** 装好 uv 后重新打开 DeepSeek Harness，让新的 `PATH` 生效：Windows 用 `winget install --id=astral-sh.uv -e`，其他平台用 `curl -LsSf https://astral.sh/uv/install.sh | sh`。

**`Failed to build pydantic-core`。** 机器默认的 Python 比 3.13 新，`pydantic-core` 没有对应的 wheel。插件因此固定了 `--python 3.12`；如果仍然编译失败，说明 uv 没能取到托管的 3.12，请检查网络，或把 `python` 设成机器上已存在的解释器。

**第一次连接比较慢。** uv 首次使用会下载服务本身和它的 74 个依赖，之后就走缓存了。

**服务起来了，但云调用失败。** 子进程的凭据链里没有可用密钥。把一对 AccessKey 存进凭据，等待重新连接。

**`serverName` 已被占用。** 在配置里换一个 `serverName`。对外的工具名也会跟着变。

**调用超时。** OOS 和部署可能比较慢。0.1.0 的单次上限是 10 分钟（`toolCallTimeoutMs`）。

## Development

```bash
node --test test/*.test.js
node --check src/index.js && node --check src/launch.js
```

```text
src/modules.js   模块目录，以及 modules 到 --visible-tools 的解析（单测）
src/launch.js    纯参数和环境变量构造（单测，不联网，参数里不放密钥）
src/index.js     Cordis 插件：解析凭据并挂上 dsh-mcp-client
locale/          显示元数据（en、zh）
test/            node:test
```
