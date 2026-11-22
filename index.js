/**
 * Host-часть `dsh-review`.
 *
 * Даёт агенту инструменты и интерфейсу маршруты для просмотра незакоммиченных
 * изменений проекта, запуска тестов, коммита/push, информации о ветке и
 * создания PR. Внешние команды — `git` и команда тестов проекта; сеть — только
 * GitHub API для PR.
 */
import { readChanges, readDiff, revertFile, initRepository } from './lib/changes.mjs'
import { runTests, detectProjects } from './lib/tests.mjs'
import { commitChanges, pushChanges, gitStatus } from './lib/git.mjs'
import { branchInfo, createPullRequest } from './lib/github.mjs'

export const name = 'dsh-review'
export const inject = ['tools', 'sessionPersistence', 'connection', 'workspaceRegistry', 'credentials']

const STATE_PATH = '/api/dsh-review/state'
const DIFF_PATH = '/api/dsh-review/diff'
const REVERT_PATH = '/api/dsh-review/revert'
const INIT_PATH = '/api/dsh-review/init'
const PROJECTS_PATH = '/api/dsh-review/projects'
const TESTS_PATH = '/api/dsh-review/tests-run'
const GIT_STATUS_PATH = '/api/dsh-review/git-status'
const COMMIT_PATH = '/api/dsh-review/git-commit'
const PUSH_PATH = '/api/dsh-review/git-push'
const BRANCH_INFO_PATH = '/api/dsh-review/branch-info'
const PR_CREATE_PATH = '/api/dsh-review/pr-create'

/** Как состояние git превращается в подпись для человека. */
const KIND_RU = {
  modified: 'изменён',
  added: 'добавлен',
  deleted: 'удалён',
  renamed: 'переименован',
  copied: 'скопирован',
  conflict: 'конфликт',
  untracked: 'новый',
}

/** Канонический текстовый результат инструментов. */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

/** Каталог проекта: первый рабочий каталог из реестра или текущий. */
async function projectDir(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    const workspaces = registry?.list?.() ?? []
    const first = workspaces.find?.(item => typeof item?.path === 'string' && item.path !== '')
    if (first !== undefined) return first.path
  } catch {
    // реестр недоступен — работаем от текущего каталога
  }
  return process.cwd()
}

/** Токен GitHub из credential store; пустая строка, если не сохранён. */
async function resolveGitHubToken(ctx) {
  try {
    const hit = await ctx.credentials.resolve('GITHUB_TOKEN')
    return typeof hit?.value === 'string' ? hit.value : ''
  } catch {
    return ''
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readBody(request) {
  try {
    const text = await request.text()
    return text === '' ? {} : JSON.parse(text)
  } catch {
    return {}
  }
}

/** Обрезать длинный текст, сохраняя начало. */
function clipText(value, limit = 12000) {
  const text = String(value ?? '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…обрезано, всего ${text.length} символов`
}

/** Длительность в удобном виде. */
function formatDuration(durationMs) {
  const ms = Number(durationMs)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(1)} с`
}

/** Текст для инструмента `changes_review`. */
function formatChanges(dir, changes, filePath, diffLines) {
  const lines = [
    `Проект: ${dir}`,
    `Файлов: ${changes.total}; добавлено: ${changes.added}; удалено: ${changes.removed}`,
  ]
  if (changes.total === 0) {
    lines.push('Незакоммиченных изменений нет.')
  } else {
    for (const file of changes.files) {
      lines.push(`- ${KIND_RU[file.kind] ?? file.kind}: ${file.path} (+${file.added}/−${file.removed})`)
    }
  }
  if (typeof filePath === 'string' && filePath !== '') {
    lines.push('', `diff: ${filePath}`)
    const text = (diffLines ?? []).map(entry => entry.line).join('\n')
    lines.push(text === '' ? '(пусто)' : text)
  }
  return clipText(lines.join('\n'))
}

/** Текст для инструмента `tests_run`. */
function formatTests(result) {
  // Тесты не запускались: нет подходящего каталога или нужно выбрать его явно.
  if (result?.ok !== true && typeof result?.command !== 'string') {
    const lines = [`ТЕСТЫ НЕ ЗАПУЩЕНЫ: ${result?.message ?? 'причина неизвестна'}`]
    if (result?.needsChoice === true) {
      lines.push('Выберите каталог параметром dir (путь относительно корня воркспейса):')
      for (const candidate of result.candidates ?? []) {
        lines.push(`- ${candidate.label} — ${candidate.rel} (dir: "${candidate.rel}")`)
      }
    }
    return lines.join('\n')
  }
  const status = result?.ok === true
    ? 'ТЕСТЫ ПРОШЛИ'
    : result?.timedOut === true
      ? 'ТАЙМАУТ ТЕСТОВ'
      : 'ТЕСТЫ УПАЛИ'
  const counts = result?.passed !== null || result?.failed !== null
    ? `; passed: ${result?.passed ?? '—'}, failed: ${result?.failed ?? '—'}`
    : ''
  const lines = [
    `${status}: ${result?.command ?? '—'}`,
    `каталог: ${result?.dir ?? '—'}; код: ${result?.exitCode ?? '—'}; длительность: ${formatDuration(result?.durationMs)}${counts}`,
  ]
  if (result?.truncated === true) lines.push('(вывод обрезан: начало и хвост)')
  if (typeof result?.message === 'string' && result.message !== '') lines.push(`ошибка запуска: ${result.message}`)
  lines.push(result?.output !== undefined && result.output !== '' ? String(result.output) : '(пустой вывод)')
  return lines.join('\n')
}

/** Текст для инструмента `git_commit`. */
function formatCommit(result) {
  const lines = [result?.ok === true ? 'КОММИТ СОЗДАН' : `КОММИТ НЕ СОЗДАН: ${result?.message ?? 'причина неизвестна'}`]
  const files = Array.isArray(result?.files) ? result.files : []
  const total = Number.isFinite(result?.total) ? result.total : files.length
  lines.push(`репозиторий: ${result?.repo ?? '—'}; ветка: ${result?.branch ?? '—'}; файлов: ${total}${result?.hash ? `; hash: ${result.hash}` : ''}`)
  if (files.length > 0) lines.push(...files.slice(0, 50).map(path => `- ${path}`))
  if (total > files.slice(0, 50).length) lines.push(`… и ещё ${total - files.slice(0, 50).length}`)
  if (Array.isArray(result?.warnings) && result.warnings.length > 0) lines.push(`предупреждения: ${result.warnings.join('; ')}`)
  if (typeof result?.output === 'string' && result.output !== '') lines.push(result.output)
  return clipText(lines.join('\n'))
}

/** Текст для инструмента `git_push`. */
function formatPush(result) {
  const lines = [
    result?.ok === true
      ? `PUSH ВЫПОЛНЕН: ${result?.repo ?? '—'} → ${result?.remote ?? '—'}/${result?.branch ?? '—'}`
      : `PUSH НЕ ВЫПОЛНЕН: ${result?.message ?? 'причина неизвестна'}`,
    `репозиторий: ${result?.repo ?? '—'}; remote: ${result?.remote ?? '—'}; branch: ${result?.branch ?? '—'}; код: ${result?.exitCode ?? '—'}${result?.protectedBranch === true ? '; защищённая ветка (main/master), подтверждение запрошено' : ''}`,
  ]
  if (typeof result?.output === 'string' && result.output !== '') lines.push(result.output)
  return clipText(lines.join('\n'))
}

/** Текст для инструмента `branch_info`. */
function formatBranchInfo(result) {
  if (result?.ok !== true) return `НЕТ ДАННЫХ О ВЕТКЕ: ${result?.message ?? 'причина неизвестна'}`
  const ahead = Number.isFinite(result?.ahead) ? result.ahead : '—'
  const behind = Number.isFinite(result?.behind) ? result.behind : '—'
  const lines = [
    `ВЕТКА: ${result?.branch ?? '—'} (${result?.repo ?? '—'}); ahead: ${ahead}, behind: ${behind}`,
    `base: ${result?.baseBranch ?? '—'}; upstream: ${result?.upstream ?? '—'}`,
    `remote: ${result?.remoteUrl ?? '—'}${result?.github ? ` (GitHub: ${result.github.owner}/${result.github.repo})` : ' (не GitHub)'}`,
  ]
  if (Array.isArray(result?.commits) && result.commits.length > 0) {
    lines.push('коммиты для PR:')
    lines.push(...result.commits.map(line => `- ${line}`))
  }
  if (Array.isArray(result?.warnings) && result.warnings.length > 0) lines.push(`предупреждения: ${result.warnings.join('; ')}`)
  return clipText(lines.join('\n'))
}

/** Текст для инструмента `pr_create`. */
function formatPullRequest(result) {
  const status = result?.existing === true ? 'PR УЖЕ СУЩЕСТВУЕТ' : 'PR СОЗДАН'
  const lines = [
    `${status}: #${result?.number ?? '—'} ${result?.title ?? ''}`.trim(),
    `${result?.repo ?? '—'}: ${result?.head ?? '—'} → ${result?.base ?? '—'}`,
    String(result?.url ?? ''),
  ]
  return clipText(lines.filter(line => line !== '').join('\n'))
}

/** Упасть, если операция вернула ok:false, иначе отформатировать результат. */
function assertOk(result, formatter) {
  if (result?.ok !== true) {
    const details = [String(result?.message ?? 'операция не выполнена')]
    if (result?.blocked === true && Array.isArray(result?.files) && result.files.length > 0) {
      details.push(`файлы: ${result.files.join(', ')}`)
    }
    if (typeof result?.output === 'string' && result.output !== '') details.push(result.output)
    throw new Error(details.join('\n'))
  }
  return formatter(result)
}

export function apply(ctx) {
  try {
    ctx.effect(() => {
      ctx.connection.fetch.register({
        path: STATE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          try {
            const dir = await projectDir(ctx)
            const changes = await readChanges(dir)
            return json({ ok: true, dir, ...changes })
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: DIFF_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const dir = await projectDir(ctx)
            if (typeof body.path !== 'string' || body.path === '') return json({ ok: false, message: 'не указан файл' })
            const lines = await readDiff(dir, body.path)
            return json({ ok: true, path: body.path, lines })
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: INIT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            if (body.confirm !== true) return json({ ok: false, message: 'нужно подтверждение' })
            const dir = await projectDir(ctx)
            const result = await initRepository(dir)
            return json({ ok: true, ...result })
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: REVERT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            if (body.confirm !== true) return json({ ok: false, message: 'нужно подтверждение' })
            if (typeof body.path !== 'string' || body.path === '') return json({ ok: false, message: 'не указан файл' })
            const dir = await projectDir(ctx)
            const result = await revertFile(dir, body.path, body.untracked === true)
            return json({ ok: true, ...result })
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: PROJECTS_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          try {
            const root = await projectDir(ctx)
            const candidates = detectProjects(root)
            return json({ ok: true, dir: root, candidates })
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: TESTS_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const root = await projectDir(ctx)
            const result = await runTests(root, {
              dir: body.dir,
              command: body.command,
              timeoutSec: body.timeoutSec,
            })
            return json(result)
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: GIT_STATUS_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const root = await projectDir(ctx)
            const result = await gitStatus({ rootDir: root, dir: body.dir })
            return json(result)
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: BRANCH_INFO_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const root = await projectDir(ctx)
            const result = await branchInfo({ rootDir: root, dir: body.dir })
            return json(result)
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: PR_CREATE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const root = await projectDir(ctx)
            const token = await resolveGitHubToken(ctx)
            const result = await createPullRequest({
              rootDir: root,
              dir: body.dir,
              title: body.title,
              body: body.body,
              base: body.base,
              head: body.head,
              confirm: body.confirm,
              token,
            })
            return json(result)
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: COMMIT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const root = await projectDir(ctx)
            const result = await commitChanges({
              rootDir: root,
              dir: body.dir,
              message: body.message,
              paths: body.paths,
              confirm: body.confirm,
            })
            return json(result)
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })

      ctx.connection.fetch.register({
        path: PUSH_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const root = await projectDir(ctx)
            const result = await pushChanges({
              rootDir: root,
              dir: body.dir,
              remote: body.remote,
              branch: body.branch,
              confirm: body.confirm,
            })
            return json(result)
          } catch (error) {
            return json({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      })
    }, 'dsh-review: routes')
  } catch (error) {
    console.error('[dsh-review] маршруты недоступны:', error)
  }

  try {
    ctx.tools.register({
      name: 'changes_review',
      description: 'Показать незакоммиченные изменения проекта: файлы, статистика строк, diff по запрошенному файлу.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь файла для diff; без него возвращается только список файлов.' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const dir = await projectDir(ctx)
        const changes = await readChanges(dir)
        if (typeof input?.path !== 'string' || input.path === '') return formatChanges(dir, changes)
        const lines = await readDiff(dir, input.path)
        return formatChanges(dir, changes, input.path, lines)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент changes_review недоступен:', error)
  }

  try {
    ctx.tools.register({
      name: 'tests_run',
      description: 'Запустить тесты проекта. Каталог с тестами выбирается автоматически (корень, затем глубина 1–2): если кандидатов несколько, вернётся список и нужен параметр dir. Команда определяется автоматически, вывод обрезается, таймаут по умолчанию 600 с.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Каталог проекта относительно корня воркспейса, например ".publish/dsh-review"; "." — сам корень. Без параметра берётся корень или единственный найденный проект.',
          },
          command: {
            type: 'string',
            description: 'Команда оболочки вместо автодетекта, например "npm test -- --watch=false". Запускается в каталоге проекта.',
          },
          timeoutSec: {
            type: 'number',
            description: 'Таймаут в секундах, по умолчанию 600, максимум 3600.',
          },
        },
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const root = await projectDir(ctx)
        const result = await runTests(root, {
          dir: input?.dir,
          command: input?.command,
          timeoutSec: input?.timeoutSec,
        })
        return formatTests(result)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент tests_run недоступен:', error)
  }

  try {
    ctx.tools.register({
      name: 'git_commit',
      description: 'Создать коммит изменений в git-репозитории выбранного каталога (корень репозитория определяется через git rev-parse). Требует confirm: true; отказывается от секретов (.env, *.key, *secret*, credentials*, *.pem), опасных путей (node_modules/, .npm-cache/, .pnpm-store/, .artifacts/, *.log) и слишком большого числа файлов; git add/commit идут с таймаутом.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Каталог проекта относительно корня воркспейса, например ".publish/dsh-review"; "." — корень. Коммит выполняется в его git-репозитории.',
          },
          message: { type: 'string', description: 'Сообщение коммита.' },
          paths: {
            description: "Пути для индексации (массив) или 'all' — все изменения.",
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string', const: 'all' },
            ],
          },
          confirm: { type: 'boolean', description: 'Обязательно true: подтверждение записи в git.' },
        },
        required: ['message', 'confirm'],
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const root = await projectDir(ctx)
        const result = await commitChanges({
          rootDir: root,
          dir: input?.dir,
          message: input?.message,
          paths: input?.paths,
          confirm: input?.confirm,
        })
        return assertOk(result, formatCommit)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент git_commit недоступен:', error)
  }

  try {
    ctx.tools.register({
      name: 'git_push',
      description: 'Отправить ветку в remote (по умолчанию origin) из git-репозитория выбранного каталога. Требует confirm: true, никогда не делает force push; возвращает repo, remote, ветку и итог.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Каталог проекта относительно корня воркспейса, например ".publish/dsh-review"; "." — корень. Push выполняется в его git-репозитории.',
          },
          confirm: { type: 'boolean', description: 'Обязательно true: подтверждение push.' },
          remote: { type: 'string', description: 'Имя remote, по умолчанию origin.' },
          branch: { type: 'string', description: 'Ветка; по умолчанию текущая ветка репозитория.' },
        },
        required: ['confirm'],
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const root = await projectDir(ctx)
        const result = await pushChanges({
          rootDir: root,
          dir: input?.dir,
          remote: input?.remote,
          branch: input?.branch,
          confirm: input?.confirm,
        })
        return assertOk(result, formatPush)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент git_push недоступен:', error)
  }

  try {
    ctx.tools.register({
      name: 'branch_info',
      description: 'Показать ветку выбранного каталога: branch, remote origin, ahead/behind, base-ветку, коммиты для PR и доступность GitHub.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Каталог проекта относительно корня воркспейса, например ".publish/dsh-review"; "." — корень.',
          },
        },
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const root = await projectDir(ctx)
        const result = await branchInfo({ rootDir: root, dir: input?.dir })
        return formatBranchInfo(result)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент branch_info недоступен:', error)
  }

  try {
    ctx.tools.register({
      name: 'pr_create',
      description: 'Создать pull request на GitHub для выбранного каталога (или вернуть уже существующий). Требует confirm: true и сохранённый GITHUB_TOKEN; title обязателен, body/base/head по умолчанию берутся из ветки.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Каталог проекта относительно корня воркспейса, например ".publish/dsh-review"; "." — корень.',
          },
          title: { type: 'string', description: 'Название PR.' },
          body: { type: 'string', description: 'Описание PR; по умолчанию — список коммитов base..HEAD.' },
          base: { type: 'string', description: 'Базовая ветка; по умолчанию origin/HEAD или main.' },
          head: { type: 'string', description: 'Ветка PR; по умолчанию текущая ветка.' },
          confirm: { type: 'boolean', description: 'Обязательно true: подтверждение создания PR.' },
        },
        required: ['title', 'confirm'],
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const root = await projectDir(ctx)
        const token = await resolveGitHubToken(ctx)
        const result = await createPullRequest({
          rootDir: root,
          dir: input?.dir,
          title: input?.title,
          body: input?.body,
          base: input?.base,
          head: input?.head,
          confirm: input?.confirm,
          token,
        })
        return assertOk(result, formatPullRequest)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент pr_create недоступен:', error)
  }
}
