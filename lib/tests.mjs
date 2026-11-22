/**
 * Запуск тестов проекта: автодетект команды, spawn в каталоге проекта,
 * таймаут и компактный отчёт.
 *
 * Модуль ничего не знает про DSH — только про каталог проекта. Команда
 * автодетекта собирается из фиксированных строк, поэтому подставить чужие
 * аргументы через имя файла нельзя. Произвольную строку принимает только
 * явный параметр `command` — это осознанное действие агента или человека.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const DEFAULT_TIMEOUT_SEC = 600
export const MAX_TIMEOUT_SEC = 3600
/** Сколько символов вывода отдаём наружу. */
export const MAX_OUTPUT = 12000
/** Длина начала вывода при умной обрезке. */
export const HEAD_OUTPUT = 2000
/** Длина хвоста вывода при умной обрезке. */
export const TAIL_OUTPUT = 8000
export const TRUNCATED_MARK = '\n…обрезано…\n'

const MAX_RAW = 8 * 1024 * 1024
const RAW_HEAD = 2 * 1024 * 1024
const RAW_TAIL = 6 * 1024 * 1024
const MAX_DEPTH = 3
const isWindows = process.platform === 'win32'
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.gradle',
  '.idea',
  '.vs',
  'bin',
  'obj',
  'build',
  'dist',
  'target',
  'out',
])

/** Есть ли в каталоге обычный файл с таким именем. */
function hasFile(dir, name) {
  try {
    return statSync(join(dir, name)).isFile()
  } catch {
    return false
  }
}

/**
 * Прочитать `scripts.test` из package.json.
 * @param {string} dir каталог проекта
 * @returns {string | null} текст скрипта или null, если скрипта нет
 */
export function readPackageTestScript(dir) {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    const script = pkg?.scripts?.test
    return typeof script === 'string' && script.trim() !== '' ? script.trim() : null
  } catch {
    return null
  }
}

/**
 * Найти первый *.sln или *.csproj в каталоге проекта (не глубже MAX_DEPTH).
 * Обход в ширину: ближайший к корню проект важнее вложенного.
 * @param {string} dir каталог проекта
 * @returns {string | null} путь относительно проекта или null
 */
export function findDotnetProject(dir) {
  const root = resolve(dir)
  const queue = [{ current: root, depth: 0 }]
  while (queue.length > 0) {
    const { current, depth } = queue.shift()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    const found = entries
      .filter(entry => entry.isFile() && /\.(sln|csproj)$/i.test(entry.name))
      .map(entry => entry.name)
      .sort((left, right) => (/\.sln$/i.test(left) ? -1 : 0) - (/\.sln$/i.test(right) ? -1 : 0))
    if (found.length > 0) return relative(root, join(current, found[0]))
    if (depth >= MAX_DEPTH) continue
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      queue.push({ current: join(current, entry.name), depth: depth + 1 })
    }
  }
  return null
}

/**
 * Определить команду тестов проекта.
 *
 * Порядок: `scripts.test` из package.json (через pnpm, если есть pnpm-lock),
 * затем pnpm-lock без package.json, затем Gradle wrapper, затем .NET, иначе
 * `npm test` — как и требует AGENTS.md: сначала npm-проект, потом остальные.
 * @param {string} dir каталог проекта
 * @returns {string} команда оболочки
 */
export function detectTestCommand(dir) {
  const root = resolve(dir)
  const npmScript = readPackageTestScript(root)
  if (npmScript !== null) return hasFile(root, 'pnpm-lock.yaml') ? 'pnpm test' : 'npm test'
  if (hasFile(root, 'pnpm-lock.yaml')) return 'pnpm test'
  if (isWindows && hasFile(root, 'gradlew.bat')) return 'gradlew.bat test'
  if (hasFile(root, 'gradlew')) return isWindows ? 'gradlew test' : './gradlew test'
  const dotnetProject = findDotnetProject(root)
  if (dotnetProject !== null) return `dotnet test "${dotnetProject.replace(/\\/g, '/')}"`
  return 'npm test'
}

/**
 * Привести значение таймаута к секундам в допустимом диапазоне.
 * @param {unknown} value исходное значение
 * @returns {number} секунды от 1 до MAX_TIMEOUT_SEC
 */
export function normalizeTimeoutSec(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_TIMEOUT_SEC
  return Math.min(Math.max(Math.ceil(number), 1), MAX_TIMEOUT_SEC)
}

/**
 * Умная обрезка вывода: начало, маркер и хвост.
 * Хвост важнее начала: там итог тестов.
 * @param {unknown} raw полный вывод
 * @returns {{ output: string, truncated: boolean }}
 */
export function trimOutput(raw) {
  const text = String(raw ?? '')
  if (text.length <= MAX_OUTPUT) return { output: text, truncated: false }
  return {
    output: `${text.slice(0, HEAD_OUTPUT)}${TRUNCATED_MARK}${text.slice(-TAIL_OUTPUT)}`,
    truncated: true,
  }
}

/** Первое совпадение числа по списку шаблонов. */
function firstNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match !== null) {
      const value = Number(match[1])
      if (Number.isFinite(value)) return value
    }
  }
  return null
}

/**
 * Разобрать итог тестов из вывода, если он там есть.
 * Поддерживаются TAP/spec node --test, mocha/jest, pytest, dotnet, maven.
 * Осторожно: шаблоны могут ошибаться на нестандартном выводе — тогда null.
 * @param {unknown} raw вывод команды
 * @returns {{ passed: number | null, failed: number | null }}
 */
export function parseTestSummary(raw) {
  const text = String(raw ?? '')
  if (text === '') return { passed: null, failed: null }
  let passed = firstNumber(text, [
    /(?:^|\n)\s*(?:#|ℹ)\s*pass(?:ed)?\s+(\d+)/i,
    /\b(\d+)\s+passing\b/i,
    /\b(\d+)\s+passed\b/i,
    /\bPassed:\s*(\d+)/i,
  ])
  let failed = firstNumber(text, [
    /(?:^|\n)\s*(?:#|ℹ)\s*fail(?:ed)?\s+(\d+)/i,
    /\b(\d+)\s+failing\b/i,
    /\b(\d+)\s+failed\b/i,
    /\bFailed:\s*(\d+)/i,
  ])
  const maven = text.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+)(?:,\s*Errors:\s*(\d+))?/i)
  if (maven !== null) {
    const run = Number(maven[1])
    const failures = Number(maven[2])
    const errors = Number(maven[3] ?? 0)
    if (passed === null && Number.isFinite(run)) passed = Math.max(0, run - failures - errors)
    if (failed === null) failed = failures + errors
  }
  return { passed, failed }
}

/** Дописать кусок вывода, ограничивая объём памяти. */
function appendChunk(state, chunk) {
  state.raw += String(chunk ?? '')
  if (state.raw.length > MAX_RAW) {
    state.raw = `${state.raw.slice(0, RAW_HEAD)}\n…обрезано…\n${state.raw.slice(-RAW_TAIL)}`
  }
}

/** Убить процесс вместе с потомками. */
function killTree(child) {
  if (typeof child.pid !== 'number') return
  try {
    if (isWindows) {
      // Сначала taskkill /T, пока живёт cmd.exe: он должен найти потомков.
      // Раньше child.kill() может убить оболочку раньше времени и оставить
      // внука с открытыми pipe — тогда событие close не наступает.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.on('error', () => {
        try {
          child.kill('SIGKILL')
        } catch {
          // процесс уже завершился
        }
      })
      killer.on('close', () => {
        try {
          child.kill('SIGKILL')
        } catch {
          // процесс уже завершился
        }
        // Закрываем свою сторону pipe, чтобы close наступил даже у потомка.
        child.stdout?.destroy()
        child.stderr?.destroy()
      })
      return
    }
    child.kill('SIGKILL')
  } catch {
    // процесс уже завершился — добивать нечего
  }
}

/**
 * Запустить тесты проекта.
 * @param {string} projectDir каталог проекта
 * @param {{ command?: unknown, timeoutSec?: unknown }} options команда и таймаут
 * @returns {Promise<{
 *   ok: boolean, command: string, exitCode: number | null, durationMs: number,
 *   output: string, truncated: boolean, timedOut: boolean,
 *   passed: number | null, failed: number | null, message?: string,
 * }>}
 */
export async function runTests(projectDir, options = {}) {
  const dir = resolve(projectDir)
  const explicit = typeof options?.command === 'string' ? options.command.trim() : ''
  const command = explicit !== '' ? explicit : detectTestCommand(dir)
  const timeoutSec = normalizeTimeoutSec(options?.timeoutSec)
  const startedAt = Date.now()
  const state = { raw: '' }

  return await new Promise((resolveRun) => {
    let settled = false
    let timedOut = false
    let spawnError = null
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const text = state.raw.trim()
      const trimmed = trimOutput(text)
      const summary = parseTestSummary(text)
      const exitCode = typeof code === 'number' ? code : null
      const result = {
        ok: !timedOut && spawnError === null && exitCode === 0,
        command,
        exitCode,
        durationMs: Date.now() - startedAt,
        output: trimmed.output,
        truncated: trimmed.truncated,
        timedOut,
        passed: summary.passed,
        failed: summary.failed,
      }
      if (spawnError !== null) result.message = spawnError.message
      resolveRun(result)
    }

    let timer
    let child
    try {
      child = spawn(command, {
        cwd: dir,
        shell: true,
        windowsHide: true,
        env: process.env,
      })
    } catch (error) {
      spawnError = error instanceof Error ? error : new Error(String(error))
      resolveRun({
        ok: false,
        command,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        output: '',
        truncated: false,
        timedOut: false,
        passed: null,
        failed: null,
        message: spawnError.message,
      })
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      // Если дерево не закрылось само, не держим вызов бесконечно.
      setTimeout(() => finish(null), 5000).unref?.()
    }, timeoutSec * 1000)
    timer.unref?.()

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => appendChunk(state, chunk))
    child.stderr?.on('data', chunk => appendChunk(state, chunk))
    child.on('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      finish(null)
    })
    child.on('close', code => finish(code))
  })
}
