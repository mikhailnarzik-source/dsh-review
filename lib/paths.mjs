/**
 * Общие проверки путей: реальный путь, принадлежность корню воркспейса и
 * отображение каталога относительно корня.
 *
 * Используется модулями тестов и git, чтобы «внутри корня» означало одно и то
 * же: и лексически (`path.relative`), и по реальному пути (симлинки).
 */
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Каталог — обычный каталог на диске.
 * @param {string} path абсолютный или относительный путь
 */
export function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Реальный путь каталога (симлинки разрешены) или null.
 * @param {string} path каталог
 */
export function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Уходит ли относительный путь за пределы корня.
 * @param {string} rel результат `path.relative`
 */
export function escapesRoot(rel) {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

/**
 * Путь относительно корня с прямыми слэшами; корень — '.'.
 * @param {string} root корень
 * @param {string} dir каталог
 */
export function displayRelative(root, dir) {
  const rel = relative(root, dir)
  return rel === '' ? '.' : rel.split(sep).join('/')
}

/**
 * Классифицировать каталог относительно корня.
 * @param {string} rootDir корень воркспейса
 * @param {string} targetDir запрошенный каталог (абсолютный или относительный)
 * @returns {'ok' | 'outside' | 'missing'}
 */
export function classifyInside(rootDir, targetDir) {
  const root = resolve(rootDir)
  const target = isAbsolute(targetDir) ? resolve(targetDir) : resolve(root, targetDir)
  if (escapesRoot(relative(root, target))) return 'outside'
  if (!isDirectory(target)) return 'missing'
  const rootReal = realPath(root) ?? root
  const targetReal = realPath(target)
  if (targetReal === null) return 'missing'
  if (escapesRoot(relative(rootReal, targetReal))) return 'outside'
  return 'ok'
}

/**
 * Лежит ли каталог внутри корня (с учётом реальных путей и симлинков).
 * @param {string} rootDir корень воркспейса
 * @param {string} targetDir проверяемый каталог
 */
export function isInside(rootDir, targetDir) {
  return classifyInside(rootDir, targetDir) === 'ok'
}
