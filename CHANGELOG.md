# Changelog

## 0.3.0

- Add a client-side settings panel to the DSH plugin detail page, so the `modules` switch can be ticked in the GUI instead of edited in `cordis.patch.yml`. The panel reads and writes the plugin's settings namespace through the settings remote and the change is applied by the plugin manager.
- The panel shows the startup cost per module (fast static modules vs the per-tool schema fetch of `ecs`/`vpc`/`rds`) and blocks saving when `codeDeploy` or `visibleTools` already owns the tool crop, because `modules` cannot take effect next to them.
- Add `exports["./client"]` and `dsh.client` to the package manifest, plus `scripts/build-client.mjs`, which wraps `src/client.js` into the `window.__ModuleLoader__` factory the web client loads. No new runtime dependency: React comes from the host.
- The client entry exports its cordis `inject` list (`slots`, `remote`, `remote.settings`, `locale`). Without that export the host never injects those services, `apply()` throws, and the entire web boot fails with `1 entry did not activate` — the bug that made 0.3.0 unloadable.
- `modules` is now a **volatile** config field. `volatileForm()` in `@deepseek-ai/dsh-settings` only projects volatile fields, so this is what gives the plugin a settings namespace and an editable form at all; `apply()` also listens on `loader/volatile-update` and reconnects the MCP server with the new whitelist.
- Keep the client module list covered by tests against `src/modules.js`, so a module the server accepts can never silently disappear from the picker.

## 0.2.0

- Add a `modules` switch so the tool surface can be enabled per module instead of always loading all 40 tools. `modules` resolves to a `--visible-tools` whitelist.
- **Default changed:** `modules` defaults to `core,api,deploy` (34 tools, measured 3.09s) instead of the full 40-tool surface (14.30s). Set `modules: all` to restore the 0.1.0 behavior.
- Modules: `core` (`oss,oos,cms,local`), `api` (the four common-API tools, including `CommonAPICaller`), `deploy` (the deploy tools plus `ECS_DescribeInstances`), and the individual `oss`, `oos`, `cms`, `local`, `ecs`, `vpc`, `rds`.
- The dynamic `ecs`/`vpc`/`rds` tools fetch their schemas over HTTPS at startup and cost about one second each, so they are opt-in. `CommonAPICaller` still reaches every Alibaba Cloud API without that cost.
- An unknown module name is rejected with a clear log line instead of being forwarded to the server, because the server aborts startup when it cannot resolve a tool name.
- `modules`, `visibleTools`, and `codeDeploy` are mutually exclusive; the log says which switch conflicted. `codeDeploy: true` keeps working next to the new default.
- Log the real handshake time and the selected surface on every connect.

## 0.1.0

First release.

- Connects the local `alibaba-cloud-ops-mcp-server` over stdio and registers whatever tools that process publishes.
- Default command is `D:\tools\mcp\vendor\alibaba\.venv\Scripts\alibaba-cloud-ops-mcp-server.exe` (the pinned 0.9.27 venv). Override `command` on another machine.
- Reads `ALIBABA_CLOUD_ACCESS_KEY_ID` and `ALIBABA_CLOUD_ACCESS_KEY_SECRET` from the credential store. Optional `ALIBABA_CLOUD_SECURITY_TOKEN` and `ALIBABA_CLOUD_REGION_ID`. None of these values are written into plugin config.
- Passes the keys on the child environment so they survive the MCP client's KEY/SECRET/TOKEN scrub.
- Reconnects when one of those credentials changes.
- Tool calls time out after 10 minutes.
