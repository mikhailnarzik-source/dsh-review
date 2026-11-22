/**
 * Операции записи git: коммит и push.
 *
 * Модуль ничего не знает про DSH — только про каталог проекта. Все команды
 * запускаются с фиксированным набором аргументов через execFile, поэтому имя
 * файла или ветки не может подставить чужую команду.
 *
 * Безопасность:
 * - коммит требует `confirm: true` и отказывается, если среди изменённых
 *   файлов есть похожие на секреты (`.env`, `*.key`, `*secret*`,
 *   `credentials*`, `*.pem`);
 * - push требует `confirm: true`, никогда не добавляет `--force` и сообщает
 *   remote/branch; пуш в main/master дополнительно помечается в ответе.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { insideProject, parsePorcelain } from './changes.mjs'

const run = promisify(execFile)

const MAX_TEXT = 12000
const GIT_TIMEOUT_MS = 120000
const PUSH_TIMEOUT_MS = 300000
const REF_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const PROTECTED_BRANCHES = new Set(['main', 'master'])
const SECRET_BASENAME = [
  /^\.env(\..+)?$/i,
  /\.key$/i,
  /secret/i,
  /^credentials/i,
  /\.pem$/i,
]

/** Обрезать длинный текст для ответа. */
export function clipText(value, limit = MAX_TEXT) {
  const text = String(value ?? '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…обрезано, всего ${text.length} символов`
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

/** Запустить git и вернуть результат без исключений. */
async function git(projectDir, args, timeoutMs = GIT_TIMEOUT_MS) {
  try {
    const result = await run('git', args, {
      cwd: projectDir,
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    })
    return { ok: true, code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'number' ? error.code : null,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? ''),
    }
  }
}

/** Собрать вывод git в одну строку. */
function joined(result) {
  return [result.stdout, result.stderr].map(part => String(part ?? '').trim()).filter(part => part !== '').join('\n')
}

/**
 * Прочитать изменённые файлы проекта.
 * @param {string} projectDir каталог проекта
 * @returns {Promise<{ path: string, index: string, worktree: string, kind: string }[]>}
 */
export async function readStatusFiles(projectDir) {
  const result = await git(projectDir, ['status', '--porcelain=v1', '-z'])
  if (!result.ok) throw new Error(`git status: ${joined(result) || 'не удалось выполнить'}`)
  return parsePorcelain(result.stdout)
}

/** Проверить, что ветка или remote — безопасное имя, а не опция git. */
function validRefName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && REF_TOKEN.test(value)
}

/**
 * Сделать коммит изменений.
 * @param {string} projectDir каталог проекта
 * @param {{ message?: unknown, paths?: unknown, confirm?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>} результат с ok и списком файлов
 */
export async function commitChanges(projectDir, options = {}) {
  const message = typeof options?.message === 'string' ? options.message.trim() : ''
  if (message === '') return { ok: false, message: 'message: нужна непустая строка' }
  if (message.length > 5000) return { ok: false, message: 'message: слишком длинное, максимум 5000 символов' }
  if (options?.confirm !== true) return { ok: false, message: 'нужно подтверждение (confirm: true)' }

  let statusFiles
  try {
    statusFiles = await readStatusFiles(projectDir)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  const files = statusFiles.map(file => file.path)
  if (files.length === 0) return { ok: false, message: 'нет изменений для коммита', files: [] }

  const secrets = findSecretPaths(files)
  if (secrets.length > 0) {
    return {
      ok: false,
      blocked: true,
      files,
      message: `отказ: в изменениях есть файлы, похожие на секреты: ${secrets.join(', ')}. Уберите их из индекса или добавьте в .gitignore.`,
    }
  }

  let onlyAll = true
  let explicitPaths = []
  const rawPaths = options?.paths
  if (Array.isArray(rawPaths) && rawPaths.length > 0) {
    onlyAll = false
    for (const entry of rawPaths) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        return { ok: false, message: 'paths: ожидается массив непустых путей', files }
      }
      const filePath = entry.trim()
      if (!insideProject(projectDir, filePath)) {
        return { ok: false, message: `путь вне проекта: ${filePath}`, files }
      }
      if (!explicitPaths.includes(filePath)) explicitPaths.push(filePath)
    }
  } else if (rawPaths !== undefined && rawPaths !== null && rawPaths !== 'all') {
    return { ok: false, message: "paths: ожидается массив путей или 'all'", files }
  }

  const addResult = onlyAll
    ? await git(projectDir, ['add', '-A'])
    : await git(projectDir, ['add', '--', ...explicitPaths])
  if (!addResult.ok) {
    return { ok: false, message: 'git add завершился ошибкой', exitCode: addResult.code, output: clipText(joined(addResult)), files }
  }

  const commitResult = await git(projectDir, ['commit', '-m', message])
  if (!commitResult.ok) {
    return {
      ok: false,
      message: 'git commit завершился ошибкой',
      exitCode: commitResult.code,
      output: clipText(joined(commitResult)),
      files,
    }
  }

  let commit = null
  const hashResult = await git(projectDir, ['rev-parse', '--short', 'HEAD'])
  if (hashResult.ok) commit = hashResult.stdout.trim() || null

  return {
    ok: true,
    message: 'коммит создан',
    commit,
    files,
    staged: onlyAll ? 'all' : explicitPaths,
    output: clipText(joined(commitResult)),
  }
}

/**
 * Отправить текущую ветку в remote.
 * @param {string} projectDir каталог проекта
 * @param {{ remote?: unknown, branch?: unknown, confirm?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>} результат с remote и branch
 */
export async function pushChanges(projectDir, options = {}) {
  if (options?.confirm !== true) return { ok: false, message: 'нужно подтверждение (confirm: true)' }

  const remote = typeof options?.remote === 'string' && options.remote.trim() !== '' ? options.remote.trim() : 'origin'
  if (!validRefName(remote)) return { ok: false, message: 'remote: недопустимое имя' }

  let branch = typeof options?.branch === 'string' && options.branch.trim() !== '' ? options.branch.trim() : ''
  if (branch !== '') {
    if (!validRefName(branch)) return { ok: false, message: 'branch: недопустимое имя' }
  } else {
    const current = await git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!current.ok) return { ok: false, message: `не удалось определить текущую ветку: ${joined(current) || 'git rev-parse'}` }
    branch = current.stdout.trim()
    if (branch === '' || branch === 'HEAD') {
      return { ok: false, message: 'не удалось определить ветку: HEAD оторван, укажите branch явно' }
    }
  }

  // Никаких --force и никаких необъявленных опций: только remote и ветка.
  const pushResult = await git(projectDir, ['push', remote, branch], PUSH_TIMEOUT_MS)
  return {
    ok: pushResult.ok,
    message: pushResult.ok ? 'push выполнен' : 'git push завершился ошибкой',
    remote,
    branch,
    protectedBranch: PROTECTED_BRANCHES.has(branch),
    forced: false,
    exitCode: pushResult.code,
    output: clipText(joined(pushResult)),
  }
}
