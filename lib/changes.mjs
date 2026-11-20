/**
 * Работа с незакоммиченными изменениями: чтение состояния git, построчный diff
 * и безопасный откат одного файла.
 *
 * Модуль ничего не знает про DSH — только про каталог проекта. Все внешние
 * команды запускаются через `git` с фиксированным набором аргументов, поэтому
 * подставить чужую команду через имя файла нельзя.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { relative, resolve, sep } from 'node:path'

const run = promisify(execFile)

/** Какой символ статуса git превращается в какое состояние файла. */
const STATUS_KINDS = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflict',
  '?': 'untracked',
}

/**
 * Разобрать вывод `git status --porcelain=v1 -z`.
 * @param {string} raw вывод команды
 * @returns {{ path: string, index: string, worktree: string, kind: string }[]}
 */
export function parsePorcelain(raw) {
  const parts = String(raw ?? '').split('\u0000').filter(part => part !== '')
  const files = []
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]
    if (entry.length < 4) continue
    const indexStatus = entry[0]
    const worktreeStatus = entry[1]
    let filePath = entry.slice(3)
    // Переименование в porcelain выдаёт два поля: старое и новое имя.
    if (indexStatus === 'R' || indexStatus === 'C') {
      index += 1
      filePath = parts[index] ?? filePath
    }
    const kind = STATUS_KINDS[worktreeStatus] ?? STATUS_KINDS[indexStatus] ?? 'modified'
    files.push({ path: filePath, index: indexStatus, worktree: worktreeStatus, kind })
  }
  return files
}

/**
 * Разобрать `git diff --numstat`.
 * @param {string} raw вывод команды
 * @returns {Map<string, { added: number, removed: number }>}
 */
export function parseNumstat(raw) {
  const result = new Map()
  for (const line of String(raw ?? '').split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const added = Number(parts[0])
    const removed = Number(parts[1])
    const filePath = parts.slice(2).join('\t').trim()
    if (filePath === '') continue
    result.set(filePath, {
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
    })
  }
  return result
}

/**
 * Проверить, что файл лежит внутри проекта: откат за его пределы недопустим.
 * @param {string} projectDir корень проекта
 * @param {string} filePath путь из git (относительный)
 */
export function insideProject(projectDir, filePath) {
  const root = resolve(projectDir)
  const target = resolve(root, filePath)
  if (target === root) return false
  return target.startsWith(root + sep)
}

/**
 * Разметить строки diff для интерфейса.
 * @param {string} diff унифицированный diff
 */
export function annotateDiff(diff) {
  return String(diff ?? '')
    .split('\n')
    .map((line, index) => {
      let kind = 'context'
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) kind = 'meta'
      else if (line.startsWith('@@')) kind = 'hunk'
      else if (line.startsWith('+')) kind = 'add'
      else if (line.startsWith('-')) kind = 'del'
      return { line, kind, number: index + 1 }
    })
}

/**
 * Собрать сводку по проекту: список файлов и статистику.
 * @param {string} projectDir каталог проекта
 */
export async function readChanges(projectDir) {
  const status = await run('git', ['status', '--porcelain=v1', '-z'], { cwd: projectDir, maxBuffer: 8 * 1024 * 1024 })
  const files = parsePorcelain(status.stdout)
  if (files.length === 0) return { files: [], total: 0, added: 0, removed: 0 }

  let stats = new Map()
  try {
    const numstat = await run('git', ['diff', '--numstat', 'HEAD'], { cwd: projectDir, maxBuffer: 8 * 1024 * 1024 })
    stats = parseNumstat(numstat.stdout)
  } catch {
    // репозиторий без коммитов: статистики нет, покажем только имена
  }

  let added = 0
  let removed = 0
  const enriched = files.map((file) => {
    const stat = stats.get(file.path)
    const fileAdded = stat?.added ?? 0
    const fileRemoved = stat?.removed ?? 0
    added += fileAdded
    removed += fileRemoved
    return { ...file, added: fileAdded, removed: fileRemoved }
  })

  return { files: enriched, total: enriched.length, added, removed }
}

/**
 * Diff одного файла.
 * @param {string} projectDir каталог проекта
 * @param {string} filePath путь из git
 */
export async function readDiff(projectDir, filePath) {
  if (!insideProject(projectDir, filePath)) throw new Error('файл вне проекта')
  try {
    const result = await run('git', ['diff', '--no-color', 'HEAD', '--', filePath], { cwd: projectDir, maxBuffer: 16 * 1024 * 1024 })
    if (result.stdout.trim() !== '') return annotateDiff(result.stdout)
  } catch {
    // до первого коммита `git diff HEAD` падает — покажем новый файл целиком
  }
  return annotateDiff(await readNewFile(projectDir, filePath))
}

/** Содержимое неотслеживаемого файла как «только добавленные» строки. */
async function readNewFile(projectDir, filePath) {
  const { readFile } = await import('node:fs/promises')
  try {
    const text = await readFile(resolve(projectDir, filePath), 'utf8')
    return text
      .split('\n')
      .slice(0, 4000)
      .map(line => `+${line}`)
      .join('\n')
  } catch {
    return ''
  }
}

/**
 * Откатить один файл: отслеживаемый возвращается к HEAD, новый удаляется.
 * @param {string} projectDir каталог проекта
 * @param {string} filePath путь из git
 * @param {boolean} untracked файл ещё не в индексе
 */
export async function revertFile(projectDir, filePath, untracked) {
  if (!insideProject(projectDir, filePath)) throw new Error('файл вне проекта')
  const relativePath = relative(resolve(projectDir), resolve(projectDir, filePath))
  if (untracked) {
    const { rm } = await import('node:fs/promises')
    await rm(resolve(projectDir, relativePath), { force: true })
    return { ok: true, path: relativePath, action: 'removed' }
  }
  await run('git', ['checkout', '--', relativePath], { cwd: projectDir })
  return { ok: true, path: relativePath, action: 'reverted' }
}
