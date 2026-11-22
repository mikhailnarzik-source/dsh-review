/**
 * Host-часть `dsh-review`.
 *
 * Даёт агенту инструменты и интерфейсу маршруты для просмотра незакоммиченных
 * изменений проекта, запуска тестов, коммита и push. Внешние команды — только
 * `git` и команда тестов проекта; сетевых запросов нет.
 */
import { readChanges, readDiff, revertFile, initRepository } from './lib/changes.mjs'
import { runTests, detectProjects } from './lib/tests.mjs'
import { commitChanges, pushChanges } from './lib/git.mjs'

export const name = 'dsh-review'
export const inject = ['tools', 'sessionPersistence', 'connection', 'workspaceRegistry']

const STATE_PATH = '/api/dsh-review/state'
const DIFF_PATH = '/api/dsh-review/diff'
const REVERT_PATH = '/api/dsh-review/revert'
const INIT_PATH = '/api/dsh-review/init'
const PROJECTS_PATH = '/api/dsh-review/projects'
const TESTS_PATH = '/api/dsh-review/tests-run'
const COMMIT_PATH = '/api/dsh-review/git-commit'
const PUSH_PATH = '/api/dsh-review/git-push'

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
  lines.push(`файлов изменено: ${files.length}${result?.commit ? `; коммит: ${result.commit}` : ''}`)
  if (files.length > 0) lines.push(...files.map(path => `- ${path}`))
  if (typeof result?.output === 'string' && result.output !== '') lines.push(result.output)
  return clipText(lines.join('\n'))
}

/** Текст для инструмента `git_push`. */
function formatPush(result) {
  const lines = [
    result?.ok === true
      ? `PUSH ВЫПОЛНЕН: ${result?.remote ?? '—'}/${result?.branch ?? '—'}`
      : `PUSH НЕ ВЫПОЛНЕН: ${result?.message ?? 'причина неизвестна'}`,
    `remote: ${result?.remote ?? '—'}; branch: ${result?.branch ?? '—'}; код: ${result?.exitCode ?? '—'}${result?.protectedBranch === true ? '; защищённая ветка (main/master), подтверждение запрошено' : ''}`,
  ]
  if (typeof result?.output === 'string' && result.output !== '') lines.push(result.output)
  return clipText(lines.join('\n'))
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
        path: COMMIT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await readBody(request)
            const dir = await projectDir(ctx)
            const result = await commitChanges(dir, body)
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
            const dir = await projectDir(ctx)
            const result = await pushChanges(dir, body)
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
      description: 'Создать коммит изменений проекта. Требует confirm: true; проверяет список изменённых файлов и отказывается коммитить файлы, похожие на секреты (.env, *.key, *secret*, credentials*, *.pem).',
      parameters: {
        type: 'object',
        properties: {
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
        const dir = await projectDir(ctx)
        const result = await commitChanges(dir, input)
        return assertOk(result, formatCommit)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент git_commit недоступен:', error)
  }

  try {
    ctx.tools.register({
      name: 'git_push',
      description: 'Отправить текущую ветку в remote (по умолчанию origin). Требует confirm: true, никогда не делает force push; возвращает remote, ветку и итог.',
      parameters: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: 'Обязательно true: подтверждение push.' },
          remote: { type: 'string', description: 'Имя remote, по умолчанию origin.' },
          branch: { type: 'string', description: 'Ветка; по умолчанию текущая ветка проекта.' },
        },
        required: ['confirm'],
      },
      output: TEXT_OUTPUT,
      async execute(input) {
        const dir = await projectDir(ctx)
        const result = await pushChanges(dir, input)
        return assertOk(result, formatPush)
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент git_push недоступен:', error)
  }
}
