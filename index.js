/**
 * Host-часть `dsh-review`.
 *
 * Даёт агенту инструмент и интерфейсу маршруты для просмотра незакоммиченных
 * изменений проекта: список файлов со статистикой, построчный diff и откат
 * одного файла. Никаких сетевых запросов и никаких команд, кроме `git`.
 */
import { readChanges, readDiff, revertFile } from './lib/changes.mjs'

export const name = 'dsh-review'
export const inject = ['tools', 'sessionPersistence', 'connection', 'workspaceRegistry']

const STATE_PATH = '/api/dsh-review/state'
const DIFF_PATH = '/api/dsh-review/diff'
const REVERT_PATH = '/api/dsh-review/revert'
const INIT_PATH = '/api/dsh-review/init'

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
            const { initRepository } = await import('./lib/changes.mjs')
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
      async run(input) {
        const dir = await projectDir(ctx)
        const changes = await readChanges(dir)
        if (typeof input?.path !== 'string' || input.path === '') {
          return { ok: true, dir, ...changes }
        }
        const lines = await readDiff(dir, input.path)
        return { ok: true, dir, path: input.path, files: changes.files, lines }
      },
    })
  } catch (error) {
    console.error('[dsh-review] инструмент недоступен:', error)
  }
}
