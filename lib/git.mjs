/**
 * Операции git: состояние, коммит и push — всегда в репозитории выбранного
 * каталога, а не корня воркспейса.
 *
 * Каталог `dir` может быть подкаталогом; корень репозитория определяется через
 * `git rev-parse --show-toplevel` и обязан лежать внутри корня воркспейса.
 * Все команды запускаются с фиксированным набором аргументов через spawn,
 * поэтому имя файла или ветки не может подставить чужую команду.
 *
 * Безопасность и предсказуемость:
 * - коммит требует `confirm: true`, отказывается от файлов, похожих на секреты
 *   (`.env`, `*.key`, `*secret*`, `credentials*`, `*.pem`), и от опасных путей
 *   (`node_modules/`, `.npm-cache/`, `.pnpm-store/`, `.artifacts/`, `*.log`);
 * - лимит изменённых файлов — MAX_COMMIT_FILES, иначе отказ с числом;
 * - `git add`/`git commit`/`git status` идут с таймаутом и убийством дерева
 *   процесса, поэтому огромный каталог не подвешивает интерфейс;
 * - push требует `confirm: true`, никогда не добавляет `--force` и сообщает
 *   repo/remote/branch.
 */
import { spawn } from 'node:child_process'
import { basename, isAbsolute, resolve } from 'node:path'
import { classifyInside, displayRelative, isDirectory, realPath } from './paths.mjs'
import { insideProject, parsePorcelain } from './changes.mjs'

export const DEFAULT_GIT_TIMEOUT_MS = 120000
export const MAX_GIT_TIMEOUT_MS = 600000
export const PUSH_TIMEOUT_MS = 300000
/** Сколько изменённых файлов можно закоммитить за один раз. */
export const MAX_COMMIT_FILES = 500
/** Сколько файлов отдаём в ответе status/ошибки. */
export const MAX_REPORT_FILES = 200

const MAX_TEXT = 12000
const MAX_GIT_OUTPUT = 8 * 1024 * 1024
const REF_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const PROTECTED_BRANCHES = new Set(['main', 'master'])
const SECRET_BASENAME = [
  /^\.env(\..+)?$/i,
  /\.key$/i,
  /secret/i,
  /^credentials/i,
  /\.pem$/i,
]
const DANGEROUS_DIRS = new Set(['node_modules', '.npm-cache', '.pnpm-store', '.artifacts'])
const DANGEROUS_FILE = /\.log$/i

/** Обрезать длинный текст для ответа. */
export function clipText(value, limit = MAX_TEXT) {
  const text = String(value ?? '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…обрезано, всего ${text.length} символов`
}

/**
 * Последние строки вывода: в ошибках git важнее конец, где `fatal:`.
 * @param {unknown} value вывод
 * @param {number} lines сколько строк оставить
 * @param {number} maxChars ограничение длины
 */
export function lastLines(value, lines = 5, maxChars = 2000) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  const list = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
  const tail = list.slice(-lines).join('\n')
  return tail.length > maxChars ? tail.slice(-maxChars) : tail
}

/**
 * Хвост вывода для показа в интерфейсе: начало может быть шумом, `fatal:`
 * приходит в конце.
 * @param {unknown} value вывод
 * @param {number} maxChars ограничение длины
 */
export function tailText(value, maxChars = 4000) {
  const text = String(value ?? '').trim()
  if (text.length <= maxChars) return text
  return `…обрезано начало…\n${text.slice(-maxChars)}`
}

/** Первые несколько путей для сообщения. */
function preview(paths, limit = 5) {
  const list = (Array.isArray(paths) ? paths : []).slice(0, limit)
  const rest = (Array.isArray(paths) ? paths.length : 0) - list.length
  return list.join(', ') + (rest > 0 ? ` и ещё ${rest}` : '')
}

/** Таймаут в секундах для сообщения. */
function seconds(timeoutMs) {
  return Math.round(timeoutMs / 1000)
}

/**
 * Таймаут git-операции: по умолчанию 120 с, допустимо 10 мс — 600 с.
 * @param {unknown} value исходное значение в миллисекундах
 * @returns {number} миллисекунды
 */
export function normalizeGitTimeout(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_GIT_TIMEOUT_MS
  return Math.min(Math.max(Math.ceil(number), 10), MAX_GIT_TIMEOUT_MS)
}

/**
 * Похож ли путь на файл с секретом.
 * @param {unknown} filePath путь из git
 * @returns {boolean}
 */
export function lookLikeSecret(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/')
  const base = normalized.split('/').pop() ?? ''
  if (base === '') return false
  return SECRET_BASENAME.some(pattern => pattern.test(base))
}

/** Найти в списке путей файлы, похожие на секреты. */
export function findSecretPaths(paths) {
  return (Array.isArray(paths) ? paths : []).filter(path => lookLikeSecret(path))
}

/**
 * Почему путь опасно коммитить: служебный каталог или лог.
 * @param {unknown} filePath путь из git
 * @returns {string | null} причина или null
 */
export function dangerousPathKind(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/')
  const segments = normalized.split('/').filter(segment => segment !== '')
  const base = segments.pop() ?? ''
  for (const segment of segments) {
    if (DANGEROUS_DIRS.has(segment)) return `${segment}/`
  }
  if (DANGEROUS_DIRS.has(base)) return `${base}/`
  if (DANGEROUS_FILE.test(base)) return '*.log'
  return null
}

/** Найти в списке путей опасные. */
export function findDangerousPaths(paths) {
  return (Array.isArray(paths) ? paths : []).filter(path => dangerousPathKind(path) !== null)
}

/** Убить процесс вместе с потомками. */
function killTree(child) {
  if (typeof child.pid !== 'number') return
  try {
    if (process.platform === 'win32') {
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
 * Запустить git с таймаутом и убийством дерева процесса.
 * @param {string} cwd рабочий каталог
 * @param {string[]} args аргументы git
 * @param {number} timeoutMs таймаут
 * @returns {Promise<{ ok: boolean, timedOut: boolean, code: number | null, stdout: string, stderr: string, durationMs: number }>}
 */
function runGit(cwd, args, timeoutMs = DEFAULT_GIT_TIMEOUT_MS) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now()
    let settled = false
    let timedOut = false
    let spawnError = null
    let stdout = ''
    let stderr = ''
    let timer
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveRun({
        ok: !timedOut && spawnError === null && code === 0,
        timedOut,
        code: typeof code === 'number' ? code : null,
        stdout,
        stderr: stderr !== '' ? stderr : (spawnError?.message ?? ''),
        durationMs: Date.now() - startedAt,
      })
    }

    let child
    try {
      child = spawn('git', args, { cwd, windowsHide: true, env: process.env })
    } catch (error) {
      spawnError = error instanceof Error ? error : new Error(String(error))
      finish(null)
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      setTimeout(() => finish(null), 3000).unref?.()
    }, timeoutMs)
    timer.unref?.()

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_GIT_OUTPUT) stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_GIT_OUTPUT) stderr += chunk
    })
    child.on('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      finish(null)
    })
    child.on('close', code => finish(code))
  })
}

/** Собрать вывод git в одну строку. */
function joined(result) {
  return [result.stdout, result.stderr].map(part => String(part ?? '').trim()).filter(part => part !== '').join('\n')
}

/**
 * Посчитать неотслеживаемые файлы репозитория через `git ls-files --others`.
 *
 * `--exclude-standard` учитывает .gitignore, поэтому счётчик совпадает с тем,
 * что реально попытается добавить `git add -A`. Поток читается по кускам и
 * прерывается, как только превышен лимит: на MotoGrip в 70 000 файлов это
 * быстрые доли секунды вместо гигантского вывода.
 * @param {string} repo корень репозитория
 * @param {number} timeoutMs таймаут
 * @param {number} limit после скольких файлов остановиться
 * @returns {Promise<{ count: number, capped: boolean, timedOut: boolean, message: string }>}
 */
function countOtherFiles(repo, timeoutMs, limit) {
  return new Promise((resolveCount) => {
    let settled = false
    let count = 0
    let timedOut = false
    let spawnMessage = ''
    let timer
    let child
    const finish = (capped) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child?.stdout?.destroy()
        child?.stderr?.destroy()
      } catch {
        // поток уже закрыт
      }
      try {
        child?.kill('SIGKILL')
      } catch {
        // процесс уже завершился
      }
      resolveCount({ count, capped, timedOut, message: spawnMessage })
    }

    try {
      child = spawn('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
        cwd: repo,
        windowsHide: true,
        env: process.env,
      })
    } catch (error) {
      resolveCount({ count: 0, capped: false, timedOut: false, message: error instanceof Error ? error.message : String(error) })
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      finish(false)
    }, timeoutMs)
    timer.unref?.()

    child.stdout?.on('data', (chunk) => {
      if (settled) return
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0) continue
        count += 1
        if (count > limit) {
          killTree(child)
          finish(true)
          return
        }
      }
    })
    child.on('error', (error) => {
      spawnMessage = error instanceof Error ? error.message : String(error)
      finish(false)
    })
    child.on('close', () => finish(false))
  })
}

/**
 * Посчитать изменённые файлы репозитория до `git add`: изменённые/удалённые
 * записи из status плюс все неотслеживаемые файлы (включая содержимое
 * неотслеживаемых каталогов, которые status показывает одной строкой).
 * @param {string} repo корень репозитория
 * @param {{ kind: string }[]} statusFiles записи `git status --porcelain -z`
 * @param {number} timeoutMs таймаут
 * @returns {Promise<{ count: number, capped: boolean, timedOut: boolean, message: string }>}
 */
export async function countChangedFiles(repo, statusFiles, timeoutMs = DEFAULT_GIT_TIMEOUT_MS) {
  const tracked = (Array.isArray(statusFiles) ? statusFiles : []).filter(file => file?.kind !== 'untracked').length
  if (tracked > MAX_COMMIT_FILES) return { count: tracked, capped: false, timedOut: false, message: '' }
  const other = await countOtherFiles(repo, timeoutMs, MAX_COMMIT_FILES - tracked)
  return {
    count: tracked + other.count,
    capped: other.capped,
    timedOut: other.timedOut,
    message: other.message,
  }
}

/**
 * Прочитать изменённые файлы каталога-репозитория.
 * @param {string} projectDir каталог внутри git-репозитория
 * @returns {Promise<{ path: string, index: string, worktree: string, kind: string }[]>}
 */
export async function readStatusFiles(projectDir) {
  const result = await runGit(projectDir, ['status', '--porcelain=v1', '-z'], DEFAULT_GIT_TIMEOUT_MS)
  if (!result.ok) throw new Error(`git status: ${joined(result) || 'не удалось выполнить'}`)
  return parsePorcelain(result.stdout)
}

/** Проверить, что ветка или remote — безопасное имя, а не опция git. */
function validRefName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && REF_TOKEN.test(value)
}

/**
 * Найти корень git-репозитория для выбранного каталога и убедиться, что он
 * находится внутри корня воркспейса.
 * @param {string} rootDir корень воркспейса
 * @param {unknown} dir выбранный каталог (относительно rootDir или абсолютный)
 * @param {{ timeoutMs?: unknown }} options таймаут
 * @returns {Promise<Record<string, unknown>>} `{ok:true, root, repo, rel, branch}` или `{ok:false, message}`
 */
export async function resolveRepoRoot(rootDir, dir, options = {}) {
  const timeoutMs = normalizeGitTimeout(options?.timeoutMs)
  const root = resolve(rootDir ?? '.')
  const requested = typeof dir === 'string' ? dir.trim() : ''
  const target = requested === '' ? root : isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
  const state = classifyInside(root, target)
  if (state === 'outside') return { ok: false, message: `каталог вне корня воркспейса: ${requested || target}` }
  if (state === 'missing') return { ok: false, message: `каталог не найден: ${requested || target}` }

  const top = await runGit(target, ['rev-parse', '--show-toplevel'], timeoutMs)
  if (!top.ok) {
    if (top.timedOut) return { ok: false, timedOut: true, message: `git rev-parse не завершился за ${seconds(timeoutMs)} с` }
    return {
      ok: false,
      message: `каталог не является git-репозиторием: ${requested || '.'}. Выберите каталог с собственным репозиторием — например, ".publish/<имя>".`,
    }
  }
  const repo = resolve(top.stdout.trim())
  if (!isDirectory(repo)) return { ok: false, message: 'git вернул несуществующий корень репозитория' }

  const rootReal = realPath(root) ?? root
  const repoReal = realPath(repo) ?? repo
  if (classifyInside(rootReal, repoReal) !== 'ok') {
    return { ok: false, message: 'git-репозиторий выбранного каталога находится вне корня воркспейса' }
  }

  // Git-репозиторием должен быть ровно выбранный каталог. Иначе это подкаталог
  // чужого репозитория — типичный случай установленной копии `plugins/<имя>`,
  // где toplevel оказывается корнем воркспейса.
  const targetReal = realPath(target) ?? target
  if (repoReal !== targetReal) {
    const repoRel = displayRelative(rootReal, repoReal)
    const name = basename(targetReal)
    const suggestion = name !== '' ? `.publish/${name}` : '.publish/<имя>'
    return {
      ok: false,
      repo: repoRel,
      repoPath: repoReal,
      toplevel: repoRel,
      message: `Это установленная копия, а не отдельный репозиторий: git-корень — "${repoRel}". Выберите "${suggestion}" или каталог с собственным .git.`,
    }
  }

  const branchResult = await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs)
  let branch = null
  if (branchResult.ok) {
    const value = branchResult.stdout.trim()
    if (value !== '' && value !== 'HEAD') branch = value
  }
  if (branch === null) {
    // Репозиторий без коммитов: rev-parse падает, но имя ветки уже задано.
    const symbolic = await runGit(repo, ['symbolic-ref', '--short', 'HEAD'], timeoutMs)
    if (symbolic.ok) {
      const value = symbolic.stdout.trim()
      if (value !== '') branch = value
    }
  }
  return {
    ok: true,
    root,
    repo,
    repoReal,
    rel: displayRelative(rootReal, repoReal),
    branch,
    requested: target,
    timeoutMs,
  }
}

/**
 * Состояние git выбранного каталога: repo, ветка, изменённые файлы, warnings.
 * @param {{ rootDir?: string, dir?: unknown, timeoutMs?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>} результат для маршрута/UI
 */
export async function gitStatus(options = {}) {
  const resolved = await resolveRepoRoot(options?.rootDir, options?.dir, { timeoutMs: options?.timeoutMs })
  if (resolved.ok !== true) return resolved
  const { repo, rel, branch, timeoutMs } = resolved

  const status = await runGit(repo, ['status', '--porcelain=v1', '-z'], timeoutMs)
  if (!status.ok) {
    const output = joined(status)
    const tail = lastLines(output)
    return {
      ok: false,
      repo: rel,
      branch,
      timedOut: status.timedOut,
      exitCode: status.code,
      output: tailText(output),
      message: status.timedOut
        ? `git status не завершился за ${seconds(timeoutMs)} с — вероятно, слишком большой каталог; проверьте .gitignore`
        : `git status завершился ошибкой (код ${status.code ?? '—'})${tail !== '' ? `:\n${tail}` : ''}`,
    }
  }

  const statusFiles = parsePorcelain(status.stdout)
  const allFiles = statusFiles.map(file => file.path)
  const counted = await countChangedFiles(repo, statusFiles, timeoutMs)
  if (counted.timedOut) {
    return {
      ok: false,
      repo: rel,
      branch,
      timedOut: true,
      message: `git ls-files не завершился за ${seconds(timeoutMs)} с — вероятно, слишком большой каталог; проверьте .gitignore`,
    }
  }

  const dangerous = findDangerousPaths(allFiles)
  const secrets = findSecretPaths(allFiles)
  const warnings = []
  const total = counted.capped ? MAX_COMMIT_FILES + 1 : counted.count
  if (counted.capped || counted.count > MAX_COMMIT_FILES) {
    warnings.push(`изменено файлов: ${counted.capped ? `больше ${MAX_COMMIT_FILES}` : counted.count} — больше лимита ${MAX_COMMIT_FILES}, коммит будет отклонён.`)
  }
  if (dangerous.length > 0) {
    warnings.push(`опасные пути (${dangerous.length}): ${preview(dangerous)}. Добавьте их в .gitignore.`)
  }
  if (secrets.length > 0) {
    warnings.push(`файлы, похожие на секреты (${secrets.length}): ${preview(secrets)}. Коммит будет отклонён.`)
  }

  return {
    ok: true,
    repo: rel,
    repoPath: repo,
    branch,
    files: allFiles.slice(0, MAX_REPORT_FILES),
    total,
    capped: counted.capped,
    truncated: allFiles.length > MAX_REPORT_FILES || counted.capped,
    warnings,
    dangerous: dangerous.slice(0, MAX_REPORT_FILES),
    secrets: secrets.slice(0, MAX_REPORT_FILES),
  }
}

/**
 * Сделать коммит изменений в репозитории выбранного каталога.
 * @param {{ rootDir?: string, dir?: unknown, message?: unknown, paths?: unknown, confirm?: unknown, timeoutMs?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>} результат с ok, repo, branch, files, hash
 */
export async function commitChanges(options = {}) {
  const message = typeof options?.message === 'string' ? options.message.trim() : ''
  if (message === '') return { ok: false, message: 'message: нужна непустая строка' }
  if (message.length > 5000) return { ok: false, message: 'message: слишком длинное, максимум 5000 символов' }
  if (options?.confirm !== true) return { ok: false, message: 'нужно подтверждение (confirm: true)' }

  const resolved = await resolveRepoRoot(options?.rootDir, options?.dir, { timeoutMs: options?.timeoutMs })
  if (resolved.ok !== true) return resolved
  const { repo, rel, branch, timeoutMs } = resolved

  const status = await runGit(repo, ['status', '--porcelain=v1', '-z'], timeoutMs)
  if (!status.ok) {
    const output = joined(status)
    const tail = lastLines(output)
    return {
      ok: false,
      repo: rel,
      branch,
      timedOut: status.timedOut,
      exitCode: status.code,
      output: tailText(output),
      message: status.timedOut
        ? `git status не завершился за ${seconds(timeoutMs)} с — вероятно, слишком большой каталог; проверьте .gitignore`
        : `git status завершился ошибкой (код ${status.code ?? '—'})${tail !== '' ? `:\n${tail}` : ''}`,
    }
  }
  const statusFiles = parsePorcelain(status.stdout)
  const files = statusFiles.map(file => file.path)
  if (files.length === 0) return { ok: false, repo: rel, branch, files: [], total: 0, message: 'нет изменений для коммита' }

  // До `git add` считаем реальные файлы: status показывает неотслеживаемые
  // каталоги одной строкой, а внутри MotoGrip/mobile-app их десятки тысяч —
  // именно на них `git add -A` падает с "fatal: adding files failed".
  const counted = await countChangedFiles(repo, statusFiles, timeoutMs)
  if (counted.timedOut) {
    return {
      ok: false,
      repo: rel,
      branch,
      files: files.slice(0, MAX_REPORT_FILES),
      timedOut: true,
      message: `git ls-files не завершился за ${seconds(timeoutMs)} с — вероятно, слишком много файлов; добавьте большие каталоги в .gitignore`,
    }
  }
  const total = counted.capped ? MAX_COMMIT_FILES + 1 : counted.count
  if (counted.capped || counted.count > MAX_COMMIT_FILES) {
    return {
      ok: false,
      repo: rel,
      branch,
      files: files.slice(0, MAX_REPORT_FILES),
      total,
      message: `отказ: изменённых файлов ${counted.capped ? `больше ${MAX_COMMIT_FILES}` : counted.count} (лимит ${MAX_COMMIT_FILES}). Похоже, в каталоге есть большие папки — добавьте их в .gitignore.`,
    }
  }

  const secrets = findSecretPaths(files)
  if (secrets.length > 0) {
    return {
      ok: false,
      blocked: true,
      repo: rel,
      branch,
      files: files.slice(0, MAX_REPORT_FILES),
      total,
      message: `отказ: в изменениях есть файлы, похожие на секреты: ${preview(secrets)}. Уберите их из индекса или добавьте в .gitignore.`,
    }
  }

  const dangerous = findDangerousPaths(files)
  if (dangerous.length > 0) {
    return {
      ok: false,
      blocked: true,
      repo: rel,
      branch,
      files: files.slice(0, MAX_REPORT_FILES),
      total,
      message: `отказ: в изменениях есть опасные пути: ${preview(dangerous)}. Добавьте их в .gitignore и повторите.`,
    }
  }

  let onlyAll = true
  let explicitPaths = []
  const rawPaths = options?.paths
  if (Array.isArray(rawPaths) && rawPaths.length > 0) {
    onlyAll = false
    for (const entry of rawPaths) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        return { ok: false, repo: rel, branch, message: 'paths: ожидается массив непустых путей', files: files.slice(0, MAX_REPORT_FILES) }
      }
      const filePath = entry.trim()
      if (!insideProject(repo, filePath)) {
        return { ok: false, repo: rel, branch, message: `путь вне репозитория: ${filePath}`, files: files.slice(0, MAX_REPORT_FILES) }
      }
      if (!explicitPaths.includes(filePath)) explicitPaths.push(filePath)
    }
  } else if (rawPaths !== undefined && rawPaths !== null && rawPaths !== 'all') {
    return { ok: false, repo: rel, branch, message: "paths: ожидается массив путей или 'all'", files: files.slice(0, MAX_REPORT_FILES) }
  }

  const addResult = await runGit(repo, onlyAll ? ['add', '-A'] : ['add', '--', ...explicitPaths], timeoutMs)
  if (!addResult.ok) {
    const output = joined(addResult)
    const tail = lastLines(output)
    return {
      ok: false,
      repo: rel,
      branch,
      files: files.slice(0, MAX_REPORT_FILES),
      total,
      timedOut: addResult.timedOut,
      exitCode: addResult.code,
      message: addResult.timedOut
        ? `git add не завершился за ${seconds(timeoutMs)} с — вероятно, в каталоге слишком много файлов; добавьте большие каталоги в .gitignore`
        : `git add завершился ошибкой (код ${addResult.code ?? '—'})${tail !== '' ? `:\n${tail}` : ''}`,
      output: tailText(output),
    }
  }

  const commitResult = await runGit(repo, ['commit', '-m', message], timeoutMs)
  if (!commitResult.ok) {
    const output = joined(commitResult)
    const tail = lastLines(output)
    return {
      ok: false,
      repo: rel,
      branch,
      files: files.slice(0, MAX_REPORT_FILES),
      total,
      timedOut: commitResult.timedOut,
      exitCode: commitResult.code,
      message: commitResult.timedOut
        ? `git commit не завершился за ${seconds(timeoutMs)} с`
        : `git commit завершился ошибкой (код ${commitResult.code ?? '—'})${tail !== '' ? `:\n${tail}` : ''}`,
      output: tailText(output),
    }
  }

  let hash = null
  const hashResult = await runGit(repo, ['rev-parse', '--short', 'HEAD'], timeoutMs)
  if (hashResult.ok) hash = hashResult.stdout.trim() || null

  return {
    ok: true,
    message: 'коммит создан',
    repo: rel,
    repoPath: repo,
    branch,
    files: files.slice(0, MAX_REPORT_FILES),
    total,
    hash,
    // Поле commit оставлено для совместимости с клиентом 1.1.x.
    commit: hash,
    staged: onlyAll ? 'all' : explicitPaths,
    output: clipText(joined(commitResult)),
  }
}

/**
 * Отправить ветку в remote из репозитория выбранного каталога.
 * @param {{ rootDir?: string, dir?: unknown, remote?: unknown, branch?: unknown, confirm?: unknown, timeoutMs?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>} результат с repo, remote и branch
 */
export async function pushChanges(options = {}) {
  if (options?.confirm !== true) return { ok: false, message: 'нужно подтверждение (confirm: true)' }

  const resolved = await resolveRepoRoot(options?.rootDir, options?.dir, { timeoutMs: options?.timeoutMs })
  if (resolved.ok !== true) return resolved
  const { repo, rel, timeoutMs } = resolved

  const remote = typeof options?.remote === 'string' && options.remote.trim() !== '' ? options.remote.trim() : 'origin'
  if (!validRefName(remote)) return { ok: false, repo: rel, message: 'remote: недопустимое имя' }

  let branch = typeof options?.branch === 'string' && options.branch.trim() !== '' ? options.branch.trim() : ''
  if (branch !== '') {
    if (!validRefName(branch)) return { ok: false, repo: rel, message: 'branch: недопустимое имя' }
  } else {
    branch = resolved.branch ?? ''
    if (branch === '') {
      return { ok: false, repo: rel, message: 'не удалось определить ветку: HEAD оторван, укажите branch явно' }
    }
  }

  // Никаких --force и никаких необъявленных опций: только remote и ветка.
  const pushResult = await runGit(repo, ['push', remote, branch], PUSH_TIMEOUT_MS)
  const output = joined(pushResult)
  const tail = lastLines(output)
  return {
    ok: pushResult.ok,
    message: pushResult.ok
      ? 'push выполнен'
      : `git push завершился ошибкой${pushResult.timedOut ? ` (таймаут)` : ''}${tail !== '' ? `:\n${tail}` : ''}`,
    repo: rel,
    repoPath: repo,
    remote,
    branch,
    protectedBranch: PROTECTED_BRANCHES.has(branch),
    forced: false,
    timedOut: pushResult.timedOut,
    exitCode: pushResult.code,
    output: tailText(output),
  }
}
