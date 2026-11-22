/**
 * Запуск тестов проекта: выбор каталога, автодетект команды, spawn, таймаут
 * и компактный отчёт.
 *
 * Модуль ничего не знает про DSH — только про корень воркспейса. Команда
 * автодетекта собирается из фиксированных строк, поэтому подставить чужие
 * аргументы через имя файла нельзя. Произвольную строку принимает только
 * явный параметр `command` — это осознанное действие агента или человека.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { classifyInside, displayRelative, realPath } from './paths.mjs'

export const DEFAULT_TIMEOUT_SEC = 600
export const MAX_TIMEOUT_SEC = 3600
/** Сколько символов вывода отдаём наружу. */
export const MAX_OUTPUT = 12000
/** Длина начала вывода при умной обрезке. */
export const HEAD_OUTPUT = 2000
/** Длина хвоста вывода при умной обрезке. */
export const TAIL_OUTPUT = 8000
export const TRUNCATED_MARK = '\n…обрезано…\n'
/** Сколько каталогов с тестами максимум показывает detectProjects. */
export const MAX_PROJECTS = 60

const MAX_RAW = 8 * 1024 * 1024
const RAW_HEAD = 2 * 1024 * 1024
const RAW_TAIL = 6 * 1024 * 1024
const MAX_DEPTH = 3
const PROJECT_MAX_DEPTH = 2
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
/** Эти каталоги не могут быть проектами с тестами при поиске по воркспейсу. */
const PROJECT_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build'])

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

/** Найти манифест тестов в самом каталоге (без рекурсии). */
export function hasTestManifest(dir) {
  return manifestKind(dir) !== null
}

/**
 * Тип манифеста тестов в каталоге: npm/pnpm test, Gradle или .NET.
 * @param {string} dir каталог-кандидат
 * @returns {'npm' | 'gradle' | 'dotnet' | null}
 */
export function manifestKind(dir) {
  const root = resolve(dir)
  if (readPackageTestScript(root) !== null) return 'npm'
  if (hasFile(root, 'gradlew.bat') || hasFile(root, 'gradlew')) return 'gradle'
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    if (entries.some(entry => entry.isFile() && /\.(sln|csproj)$/i.test(entry.name))) return 'dotnet'
  } catch {
    // каталог недоступен — манифеста нет
  }
  return null
}

/** Подпись кандидата: имя из package.json или имя каталога. */
function projectLabel(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (typeof pkg?.name === 'string' && pkg.name.trim() !== '') return pkg.name.trim()
  } catch {
    // package.json может отсутствовать или быть невалидным
  }
  return basename(dir)
}

/**
 * Найти каталоги с тестами: сам корень, затем глубина 1–2.
 *
 * Пропускаются `node_modules`, `.git`, `dist`, `build`; скрытые каталоги
 * (например, `.publish`) просматриваются. Для package.json подписью служит
 * `name`, иначе имя каталога. Лимит — MAX_PROJECTS кандидатов.
 * @param {string} rootDir корень воркспейса
 * @returns {{ dir: string, rel: string, label: string, kind: 'npm' | 'gradle' | 'dotnet' }[]}
 */
export function detectProjects(rootDir) {
  const root = resolve(rootDir)
  const candidates = []
  const seen = new Set()
  const add = (dir) => {
    if (candidates.length >= MAX_PROJECTS) return
    const kind = manifestKind(dir)
    if (kind === null) return
    const real = realPath(dir) ?? resolve(dir)
    if (seen.has(real)) return
    seen.add(real)
    candidates.push({ dir: resolve(dir), rel: displayRelative(root, dir), label: projectLabel(dir), kind })
  }

  add(root)
  let level = [root]
  for (let depth = 1; depth <= PROJECT_MAX_DEPTH && candidates.length < MAX_PROJECTS; depth += 1) {
    const next = []
    for (const parent of level) {
      let entries
      try {
        entries = readdirSync(parent, { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        if (candidates.length >= MAX_PROJECTS) break
        if (!entry.isDirectory() || PROJECT_SKIP_DIRS.has(entry.name)) continue
        const child = join(parent, entry.name)
        add(child)
        next.push(child)
      }
      if (candidates.length >= MAX_PROJECTS) break
    }
    level = next
  }
  return candidates
}

/**
 * Классифицировать запрошенный каталог относительно корня.
 * @param {string} rootDir корень воркспейса
 * @param {string} targetDir запрошенный каталог (абсолютный или относительный)
 * @returns {'ok' | 'outside' | 'missing'}
 */
export const classifyProjectDir = classifyInside

/**
 * Лежит ли каталог внутри корня (с учётом реальных путей и симлинков).
 * @param {string} rootDir корень воркспейса
 * @param {string} targetDir проверяемый каталог
 */
export function isInsideProject(rootDir, targetDir) {
  return classifyInside(rootDir, targetDir) === 'ok'
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
 *
 * Каталог выбирается так: явный `options.dir` (проверяется, что он внутри
 * корня) → манифест в самом корне → единственный найденный проект. Если
 * подходящих каталогов несколько, тесты не запускаются: возвращается
 * `needsChoice` со списком кандидатов, чтобы вызывающий выбрал `dir`.
 * @param {string} rootDir корень воркспейса
 * @param {{ dir?: unknown, command?: unknown, timeoutSec?: unknown }} options каталог, команда и таймаут
 * @returns {Promise<Record<string, unknown>>} результат; при ошибке `ok:false`
 */
export async function runTests(rootDir, options = {}) {
  const root = resolve(rootDir)
  const requested = typeof options?.dir === 'string' ? options.dir.trim() : ''
  let projectDir
  if (requested !== '') {
    const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
    const state = classifyProjectDir(root, target)
    if (state === 'outside') {
      return { ok: false, message: `каталог вне корня воркспейса: ${requested}` }
    }
    if (state === 'missing') {
      return { ok: false, message: `каталог не найден: ${requested}` }
    }
    projectDir = target
  } else if (hasTestManifest(root)) {
    projectDir = root
  } else {
    const candidates = detectProjects(root)
    if (candidates.length === 0) {
      return {
        ok: false,
        message: `не найден package.json с scripts.test, gradlew или *.sln/*.csproj в ${root}; укажите dir явно`,
      }
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        needsChoice: true,
        candidates,
        message: 'в воркспейсе несколько каталогов с тестами — выберите dir',
      }
    }
    projectDir = candidates[0].dir
  }

  const dir = projectDir
  const projectRel = displayRelative(root, dir)
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
        dir: projectRel,
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
        dir: projectRel,
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
