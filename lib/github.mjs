/**
 * GitHub-часть `dsh-review`: разбор remote, информация о ветке и создание PR.
 *
 * Сетевые запросы идут только на https://api.github.com; URL собирается из
 * константы и владельца/репозитория, поэтому подставить чужой хост нельзя.
 * Токен передаётся вызывающим (index.js берёт его из ctx.credentials), сам
 * модуль ничего не знает про DSH.
 */
import { normalizeGitTimeout, resolveRepoRoot, runGit, gitOutput } from './git.mjs'

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_TOKEN_MISSING = 'токен GitHub не сохранён: Настройки → Плагины → GitHub'
export const DEFAULT_PR_TIMEOUT_MS = 60000

const MAX_COMMITS = 20
const MAX_TEXT = 12000

const URL_REMOTE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([^/\s:]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+)$/i
const SCP_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+)\/([^/\s]+)$/

/** Обрезать текст для ответа. */
export function clipText(value, limit = MAX_TEXT) {
  const text = String(value ?? '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…обрезано, всего ${text.length} символов`
}

/**
 * Разобрать git remote в владельца, репозиторий и хост.
 * Понимает https://github.com/o/r.git, git@github.com:o/r.git,
 * ssh://git@github.com/o/r и похожие формы.
 * @param {unknown} url remote origin
 * @returns {{ owner: string, repo: string, host: string } | null}
 */
export function parseRemote(url) {
  const raw = String(url ?? '').trim().replace(/\/+$/, '')
  if (raw === '') return null
  const match = raw.match(URL_REMOTE) ?? raw.match(SCP_REMOTE)
  if (match === null) return null
  const host = match[1].toLowerCase()
  const owner = match[2]
  const repo = match[3].replace(/\.git$/i, '')
  if (host === '' || owner === '' || repo === '') return null
  return { owner, repo, host }
}

/** Поддерживается ли хост публичным GitHub API. */
export function isGitHubHost(host) {
  return typeof host === 'string' && /^(?:www\.)?github\.com$/i.test(host)
}

/** Информация о GitHub-репозитории из remote или null. */
export function parseGitHubRemote(url) {
  const remote = parseRemote(url)
  if (remote === null || !isGitHubHost(remote.host)) return null
  return remote
}

/**
 * Ветка по умолчанию: origin/HEAD, затем origin/main, origin/master, иначе main.
 * @param {string} repo корень репозитория
 * @param {number} timeoutMs таймаут git
 * @returns {Promise<string>}
 */
async function detectBaseBranch(repo, timeoutMs) {
  const symbolic = await runGit(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], timeoutMs)
  if (symbolic.ok) {
    const value = symbolic.stdout.trim().replace(/^origin\//, '')
    if (value !== '') return value
  }
  for (const candidate of ['main', 'master']) {
    const check = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${candidate}`], timeoutMs)
    if (check.ok) return candidate
  }
  return 'main'
}

/** Найти существующий ref для диапазона commits (origin/<base> важнее локального). */
async function rangeBase(repo, base, timeoutMs) {
  for (const candidate of [`origin/${base}`, base]) {
    const check = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], timeoutMs)
    if (check.ok) return candidate
  }
  return null
}

/**
 * Информация о ветке выбранного каталога: branch, remote, ahead/behind, base.
 * @param {{ rootDir?: string, dir?: unknown, timeoutMs?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>}
 */
export async function branchInfo(options = {}) {
  const timeoutMs = normalizeGitTimeout(options?.timeoutMs)
  const resolved = await resolveRepoRoot(options?.rootDir, options?.dir, { timeoutMs })
  if (resolved.ok !== true) return resolved
  const { repo, rel, branch } = resolved
  const warnings = []

  const remoteResult = await runGit(repo, ['remote', 'get-url', 'origin'], timeoutMs)
  const remoteUrl = remoteResult.ok ? remoteResult.stdout.trim() : ''
  const parsed = parseRemote(remoteUrl)
  const github = parsed !== null && isGitHubHost(parsed.host) ? parsed : null
  if (remoteUrl === '') {
    warnings.push('remote origin не настроен — PR создать нельзя')
  } else if (github === null) {
    warnings.push(`remote origin не GitHub (${parsed?.host ?? remoteUrl}) — PR создать нельзя`)
  }
  if (branch === null) warnings.push('HEAD оторван — ветка не определена')

  let upstream = null
  let ahead = null
  let behind = null
  const upstreamResult = await runGit(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], timeoutMs)
  if (upstreamResult.ok) {
    upstream = upstreamResult.stdout.trim()
    const counts = await runGit(repo, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], timeoutMs)
    if (counts.ok) {
      const parts = counts.stdout.trim().split(/\s+/)
      const behindValue = Number(parts[0])
      const aheadValue = Number(parts[1])
      if (Number.isFinite(behindValue)) behind = behindValue
      if (Number.isFinite(aheadValue)) ahead = aheadValue
    }
  } else {
    warnings.push('у ветки нет upstream — ahead/behind неизвестны')
  }

  const baseBranch = await detectBaseBranch(repo, timeoutMs)
  let commits = []
  if (branch !== null && branch !== baseBranch) {
    const baseRef = await rangeBase(repo, baseBranch, timeoutMs)
    if (baseRef !== null) {
      const logResult = await runGit(repo, ['log', '--oneline', `${baseRef}..HEAD`, `--max-count=${MAX_COMMITS}`], timeoutMs)
      if (logResult.ok) {
        commits = logResult.stdout
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line !== '')
          .slice(0, MAX_COMMITS)
      }
    }
  }
  if (branch !== null && branch === baseBranch) {
    warnings.push(`текущая ветка совпадает с base (${baseBranch}) — для PR нужна отдельная ветка`)
  }

  return {
    ok: true,
    repo: rel,
    repoPath: repo,
    branch,
    remoteUrl,
    github,
    upstream,
    ahead,
    behind,
    baseBranch,
    commits,
    warnings,
  }
}

/** Заголовки GitHub API. */
function githubHeaders(token, withBody) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dsh-review',
    ...(withBody ? { 'content-type': 'application/json' } : {}),
  }
}

/** Прочитать JSON, не падая на пустом/не-JSON ответе. */
async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** Человекочитаемая ошибка GitHub. */
export function githubErrorMessage(status, data) {
  const message = typeof data?.message === 'string' && data.message !== '' ? data.message : ''
  const details = Array.isArray(data?.errors)
    ? data.errors.map(error => (typeof error?.message === 'string' ? error.message : String(error?.code ?? ''))).filter(text => text !== '')
    : []
  const suffix = details.length > 0 ? `: ${details.join('; ')}` : message !== '' ? `: ${message}` : ''
  if (status === 401) return `GitHub: токен не принят (401). Проверьте токен в настройках плагина${suffix}`
  if (status === 403) return `GitHub: доступ запрещён (403)${suffix}`
  if (status === 404) return `GitHub: репозиторий не найден или нет доступа (404)${suffix}`
  if (status === 422) return `GitHub: запрос отклонён (422)${suffix}`
  if (status === 429) return `GitHub: превышен лимит запросов (429)${suffix}`
  return `GitHub: ошибка ${status}${suffix}`
}

/**
 * Запрос к GitHub API с таймаутом. URL обязан начинаться с GITHUB_API.
 * @returns {Promise<{ ok: boolean, status?: number, data?: unknown, message?: string }>}
 */
async function githubRequest(fetchImpl, url, init, timeoutMs) {
  if (!url.startsWith(`${GITHUB_API}/`)) return { ok: false, message: 'GitHub: недопустимый адрес запроса' }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetchImpl(url, { ...init, ...(controller !== null ? { signal: controller.signal } : {}) })
    const data = await readJson(response)
    if (response.ok !== true) {
      const status = typeof response.status === 'number' ? response.status : 0
      return { ok: false, status, message: githubErrorMessage(status, data) }
    }
    return { ok: true, status: response.status, data }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, message: `GitHub не ответил за ${Math.round(timeoutMs / 1000)} с` }
    return { ok: false, message: `GitHub недоступен: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * Создать pull request (или вернуть уже существующий).
 * @param {{ rootDir?: string, dir?: unknown, title?: unknown, body?: unknown, base?: unknown, head?: unknown, confirm?: unknown, token?: unknown, fetch?: unknown, timeoutMs?: unknown }} options параметры
 * @returns {Promise<Record<string, unknown>>} `{ok, existing, number, url, title, base, head}` или `{ok:false, message}`
 */
export async function createPullRequest(options = {}) {
  if (options?.confirm !== true) return { ok: false, message: 'нужно подтверждение (confirm: true)' }
  const title = typeof options?.title === 'string' ? options.title.trim() : ''
  if (title === '') return { ok: false, message: 'title: нужна непустая строка' }
  if (title.length > 256) return { ok: false, message: 'title: слишком длинное, максимум 256 символов' }

  const info = await branchInfo(options)
  if (info.ok !== true) return info
  if (info.github === null) {
    return { ok: false, message: 'remote origin не GitHub — создать PR нельзя. Настройте origin на github.com.' }
  }

  const head = typeof options?.head === 'string' && options.head.trim() !== '' ? options.head.trim() : info.branch
  const base = typeof options?.base === 'string' && options.base.trim() !== '' ? options.base.trim() : info.baseBranch
  if (head === null || head === '') return { ok: false, message: 'не удалось определить ветку для PR (HEAD оторван)' }
  if (base === null || base === '') return { ok: false, message: 'не удалось определить base-ветку для PR' }
  if (head === base) return { ok: false, message: `ветка ${head} совпадает с base — переключитесь на отдельную ветку` }

  const token = typeof options?.token === 'string' ? options.token.trim() : ''
  if (token === '') return { ok: false, message: GITHUB_TOKEN_MISSING }

  const fetchImpl = typeof options?.fetch === 'function' ? options.fetch : globalThis.fetch
  if (typeof fetchImpl !== 'function') return { ok: false, message: 'fetch недоступен в этом окружении' }

  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Math.min(Math.max(Math.ceil(Number(options.timeoutMs)), 1000), 120000)
    : DEFAULT_PR_TIMEOUT_MS

  const { owner, repo } = info.github
  const body = typeof options?.body === 'string' && options.body.trim() !== '' ? options.body.trim() : (info.commits ?? []).join('\n')
  const repoLabel = `${owner}/${repo}`
  const headers = githubHeaders(token, false)

  const existing = await githubRequest(
    fetchImpl,
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`,
    { method: 'GET', headers },
    timeoutMs,
  )
  if (existing.ok !== true) return { ok: false, message: existing.message ?? 'GitHub: не удалось проверить существующие PR' }
  const list = Array.isArray(existing.data) ? existing.data : []
  const found = list.find(pull => pull?.state !== 'closed') ?? list[0]
  if (found !== undefined && found !== null) {
    return {
      ok: true,
      existing: true,
      number: found.number ?? null,
      url: found.html_url ?? found.url ?? '',
      title: found.title ?? title,
      base: found.base?.ref ?? base,
      head,
      repo: repoLabel,
    }
  }

  const created = await githubRequest(
    fetchImpl,
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: 'POST',
      headers: githubHeaders(token, true),
      body: JSON.stringify({ title, body, head, base }),
    },
    timeoutMs,
  )
  if (created.ok !== true) return { ok: false, message: created.message ?? 'GitHub: не удалось создать PR' }
  const data = created.data ?? {}
  return {
    ok: true,
    existing: false,
    number: data.number ?? null,
    url: data.html_url ?? '',
    title: data.title ?? title,
    base: data.base?.ref ?? base,
    head,
    repo: repoLabel,
  }
}

/** Вывод git одной строкой — нужен для сообщений выше. */
export function gitErrorText(result) {
  return clipText(gitOutput(result))
}
