/**
 * /api/system/* - host telemetry for the Command screen.
 *
 * Cross-platform on purpose: the dashboard is developed on Linux and run on
 * Windows, and a telemetry panel that silently reports zeros on one of them is
 * worse than one that reports nothing.
 *
 * CPU percentage needs two samples. os.cpus() returns cumulative tick counters
 * since boot, so a single reading yields the average since power-on - a number
 * that barely moves and makes the gauge look broken. A module-level snapshot of
 * the previous reading turns it into utilisation over the interval between
 * polls, which is what the panel is asking for.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const os = require('os')
const { exec } = require('child_process')

let previousTicks = null

function readTicks() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    for (const kind of Object.keys(cpu.times)) total += cpu.times[kind]
    idle += cpu.times.idle
  }
  return { idle, total }
}

function cpuPercent() {
  const now = readTicks()
  const previous = previousTicks
  previousTicks = now
  if (!previous) return null // first call has no interval to measure over
  const idle = now.idle - previous.idle
  const total = now.total - previous.total
  if (total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)))
}

function stats() {
  const total = os.totalmem()
  const free = os.freemem()
  // loadavg is zeros on Windows. Reporting null says "not measurable here"
  // instead of implying an idle machine.
  const load = os.platform() === 'win32' ? null : os.loadavg().map((n) => Number(n.toFixed(2)))

  return {
    host: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      model: os.cpus()[0] ? os.cpus()[0].model.trim() : 'unknown',
      cores: os.cpus().length,
      percent: cpuPercent(),
      load,
    },
    memory: {
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
      percent: total > 0 ? Math.round(((total - free) / total) * 100) : null,
    },
    // Thermal needs a platform sensor library. Declared rather than faked so
    // the panel can render "no sensor" instead of a plausible wrong number.
    thermal: null,
    timestamp: Date.now(),
  }
}

function run(command, timeoutMs = 6000) {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve(error && !stdout ? null : String(stdout || '')))
  })
}

/**
 * Top processes by memory. `ps` and PowerShell disagree on everything, so each
 * platform gets its own command and both are normalised to the same shape.
 */
async function processes(limit = 25) {
  if (os.platform() === 'win32') {
    const script =
      'Get-Process | Sort-Object -Property WS -Descending | ' +
      `Select-Object -First ${limit} Id,ProcessName,WS,CPU | ConvertTo-Json -Compress`
    const out = await run(`powershell -NoProfile -NonInteractive -Command "${script}"`)
    if (!out) return []
    let parsed
    try { parsed = JSON.parse(out) } catch { return [] }
    // A single process serialises as an object rather than an array.
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.map((p) => ({
      pid: p.Id,
      name: p.ProcessName,
      memoryBytes: p.WS ?? null,
      cpuSeconds: typeof p.CPU === 'number' ? Number(p.CPU.toFixed(1)) : null,
    }))
  }

  const out = await run(`ps -eo pid,comm,rss,time --sort=-rss | head -n ${limit + 1}`)
  if (!out) return []
  return out
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 4) return null
      return {
        pid: Number(parts[0]),
        name: parts[1],
        memoryBytes: Number(parts[2]) * 1024, // ps reports RSS in KiB
        cpuSeconds: null,
        cpuTime: parts[3],
      }
    })
    .filter(Boolean)
}

function mount(app) {
  app.get('/api/system/stats', (req, res) => res.json(stats()))

  app.get('/api/system/processes', async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 25))
    try {
      res.json({ processes: await processes(limit), timestamp: Date.now() })
    } catch (error) {
      res.status(500).json({ error: String(error && error.message) })
    }
  })
}

module.exports = { mount, stats, processes, cpuPercent }
