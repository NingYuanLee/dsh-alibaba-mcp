# Security policy

## Reporting a vulnerability

This package is a private local bundle and has no public issue tracker. Report security
issues privately to the maintainer. Do not send an AccessKey, a security token, or a
child-process environment dump.

Include the DeepSeek Harness version, the profile, and reproduction steps. Redact
`ALIBABA_CLOUD_ACCESS_KEY_ID`, `ALIBABA_CLOUD_ACCESS_KEY_SECRET`, and
`ALIBABA_CLOUD_SECURITY_TOKEN`.

## Scope

`dsh-alibaba-mcp` connects the official `@deepseek-ai/dsh-mcp-client` to a local
`alibaba-cloud-ops-mcp-server` process so the agent can call that server's tools.

- The plugin reads credential references (`ALIBABA_CLOUD_ACCESS_KEY_ID`,
  `ALIBABA_CLOUD_ACCESS_KEY_SECRET`, and optionally `ALIBABA_CLOUD_SECURITY_TOKEN` and
  `ALIBABA_CLOUD_REGION_ID`) through `ctx.credentials.resolve`. It does not read
  `$DSH_HOME/.credentials.yaml` itself.
- When both key parts are present, they are placed only on the child process environment.
  The MCP client drops ambient names matching `KEY`, `SECRET`, or `TOKEN` before spawn;
  an explicit `env` entry is what puts the key back.
- The keys are not written into `cordis.patch.yml`, argv, or this plugin's own log lines.
  If a client error string contains a resolved secret of 4 or more characters, the plugin
  replaces that value with `[redacted]` before logging. Treat any remaining child stderr
  as secret.
- With no key pair and no token, the child still starts. It then uses the server's own
  credential chain (a shared credentials file or an instance role). That is the upstream
  server's behavior, not an extra network call from this package.
- A half-set key pair, or a token without a key pair, does not start the child.
- Tool arguments are handled by the upstream server. That includes Alibaba Cloud API
  calls, which can read and change cloud resources, and the server's own local tools
  (`LOCAL_ListDirectory`, `LOCAL_RunShellScript`, `LOCAL_AnalyzeDeployStack`). This
  plugin does not add another shell and does not reimplement those tools.
- `codeDeploy` and `visibleTools` cannot be set together. Leaving both empty loads the
  server's normal tool set.
- The plugin opens no listening port. The child uses stdio.

## Supported versions

Security fixes target the `0.1.x` line on the `>=0.2.1-rc.2 <0.3.0-0` DeepSeek Harness range.
