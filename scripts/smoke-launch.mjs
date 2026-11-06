/**
 * Start the server the way the plugin now does and check that it answers an
 * MCP initialize request over stdio.
 *
 * This is the end-to-end proof that the uv based launch plan works: the same
 * command and arguments buildLaunch produces, spawned for real.
 */
import { spawn } from 'node:child_process'
import { buildLaunch } from '../src/launch.js'

const launch = buildLaunch({
  command: 'uv',
  modules: 'core,api,deploy',
  accessKeyId: 'LTAI-smoke-test-id',
  accessKeySecret: 'smoke-test-secret',
  region: 'cn-hangzhou',
})

if (!launch.ok) {
  console.error('launch plan failed:', launch)
  process.exit(1)
}

console.log('command:', launch.command)
console.log('args:', JSON.stringify(launch.args))
console.log('cwd:', JSON.stringify(launch.cwd))
console.log('env keys:', Object.keys(launch.env).join(', '))

const child = spawn(launch.command, launch.args, {
  cwd: launch.cwd || undefined,
  env: { ...process.env, ...launch.env },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => { stdout += d.toString() })
child.stderr.on('data', (d) => { stderr += d.toString() })

const timer = setTimeout(() => {
  child.kill()
  console.error('\nTIMEOUT: no initialize response within 90s')
  console.error('stderr tail:', stderr.split('\n').slice(-12).join('\n'))
  process.exit(1)
}, 90_000)

const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'dsh-alibaba-mcp-smoke', version: '0.0.0' },
  },
}

child.stdin.write(`${JSON.stringify(request)}\n`)

const poll = setInterval(() => {
  const line = stdout.split('\n').find((l) => l.trim().startsWith('{'))
  if (!line) return
  try {
    const message = JSON.parse(line)
    if (message.id !== 1) return
    clearInterval(poll)
    clearTimeout(timer)
    console.log('\ninitialize response:')
    console.log('  server:', JSON.stringify(message.result?.serverInfo ?? {}))
    console.log('  protocol:', message.result?.protocolVersion)
    const toolCount = message.result?.capabilities?.tools
    console.log('  tools advertised:', toolCount ? 'yes' : 'no')
    child.kill()
    process.exit(0)
  } catch {
    // Not the response yet.
  }
}, 250)

child.on('exit', (code) => {
  clearInterval(poll)
  clearTimeout(timer)
  console.error(`\nserver exited with code ${code} before responding`)
  console.error('stderr tail:', stderr.split('\n').slice(-15).join('\n'))
  process.exit(1)
})
