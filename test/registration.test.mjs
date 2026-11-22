import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Минимальный контекст плагина: запоминает регистрации. */
function fakeContext(options = {}) {
  const tools = []
  const routes = []
  return {
    tools: { register: definition => tools.push(definition) },
    connection: { fetch: { register: route => routes.push(route) } },
    effect: (callback) => {
      callback()
      return () => {}
    },
    get: (name) => (name === 'workspaceRegistry' && options.projectDir !== undefined
      ? { list: () => [{ path: options.projectDir }] }
      : undefined),
    toolsList: tools,
    routesList: routes,
  }
}

/** Вызвать POST-маршрут с JSON-телом. */
async function callRoute(ctx, path, payload) {
  const route = ctx.routesList.find(item => item.path === path)
  assert.ok(route, `маршрут ${path} не зарегистрирован`)
  const response = await route.fetch(new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  }))
  return await response.json()
}

test('index.js регистрирует инструменты и POST-маршруты', async () => {
  const module = await import('../index.js')
  assert.equal(module.name, 'dsh-review')
  const ctx = fakeContext()
  module.apply(ctx)

  const toolNames = ctx.toolsList.map(tool => tool.name).sort()
  assert.deepEqual(toolNames, ['changes_review', 'git_commit', 'git_push', 'tests_run'])

  for (const tool of ctx.toolsList) {
    assert.equal(typeof tool.description, 'string', `${tool.name}: описание`)
    assert.equal(tool.parameters?.type, 'object', `${tool.name}: parameters`)
    assert.equal(typeof tool.execute, 'function', `${tool.name}: execute`)
    assert.equal(tool.output?.schema?.type, 'string', `${tool.name}: output.schema`)
    assert.equal(typeof tool.output?.render, 'function', `${tool.name}: output.render`)
    // В DSH 0.2.x у инструмента нет поля run — старый стиль молча не регистрировался.
    assert.equal('run' in tool, false, `${tool.name}: не должно быть run`)
  }

  const commit = ctx.toolsList.find(tool => tool.name === 'git_commit')
  assert.deepEqual(commit.parameters.required, ['message', 'confirm'])
  const push = ctx.toolsList.find(tool => tool.name === 'git_push')
  assert.deepEqual(push.parameters.required, ['confirm'])
  const tests = ctx.toolsList.find(tool => tool.name === 'tests_run')
  assert.equal('required' in tests.parameters, false)

  const routes = ctx.routesList.map(route => route.path).sort()
  assert.deepEqual(routes, [
    '/api/dsh-review/diff',
    '/api/dsh-review/git-commit',
    '/api/dsh-review/git-push',
    '/api/dsh-review/init',
    '/api/dsh-review/revert',
    '/api/dsh-review/state',
    '/api/dsh-review/tests-run',
  ])
  for (const route of ctx.routesList) {
    assert.deepEqual(route.methods, ['POST'], `${route.path}: методы`)
    assert.equal(route.requestBody, 'buffered', `${route.path}: тело`)
    assert.equal(typeof route.fetch, 'function', `${route.path}: fetch`)
  }
})

test('маршрут git-commit без confirm отвечает ok:false', async () => {
  const module = await import('../index.js')
  const ctx = fakeContext()
  module.apply(ctx)
  const route = ctx.routesList.find(item => item.path === '/api/dsh-review/git-commit')
  const response = await route.fetch(new Request('http://localhost/api/dsh-review/git-commit', {
    method: 'POST',
    body: JSON.stringify({ message: 'без подтверждения' }),
  }))
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.match(payload.message, /подтвержд/)
})

test('маршрут git-push без confirm отвечает ok:false', async () => {
  const module = await import('../index.js')
  const ctx = fakeContext()
  module.apply(ctx)
  const route = ctx.routesList.find(item => item.path === '/api/dsh-review/git-push')
  const response = await route.fetch(new Request('http://localhost/api/dsh-review/git-push', {
    method: 'POST',
    body: JSON.stringify({}),
  }))
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.match(payload.message, /подтвержд/)
})

test('инструменты git_commit и git_push требуют confirm:true', async () => {
  const module = await import('../index.js')
  const ctx = fakeContext()
  module.apply(ctx)
  const commit = ctx.toolsList.find(tool => tool.name === 'git_commit')
  const push = ctx.toolsList.find(tool => tool.name === 'git_push')
  await assert.rejects(() => commit.execute({ message: 'x', confirm: false }), /подтвержд/)
  await assert.rejects(() => push.execute({ confirm: false }), /подтвержд/)
})

test('маршрут tests-run запускает команду в каталоге проекта', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-route-tests-'))
  try {
    await writeFile(join(dir, 'ok.js'), "console.log('ROUTE-TESTS-OK')\n", 'utf8')
    const module = await import('../index.js')
    const ctx = fakeContext({ projectDir: dir })
    module.apply(ctx)
    const payload = await callRoute(ctx, '/api/dsh-review/tests-run', { command: 'node ok.js', timeoutSec: 60 })
    assert.equal(payload.ok, true)
    assert.equal(payload.command, 'node ok.js')
    assert.equal(payload.exitCode, 0)
    assert.ok(payload.output.includes('ROUTE-TESTS-OK'))
    assert.equal(typeof payload.durationMs, 'number')
    assert.equal(typeof payload.truncated, 'boolean')
    assert.ok(payload.passed === null || typeof payload.passed === 'number')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('маршрут git-commit делает коммит после confirm:true', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-route-commit-'))
  try {
    await run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await run('git', ['config', 'user.name', 'test'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await writeFile(join(dir, 'app.js'), 'const value = 1\n', 'utf8')
    const module = await import('../index.js')
    const ctx = fakeContext({ projectDir: dir })
    module.apply(ctx)
    const payload = await callRoute(ctx, '/api/dsh-review/git-commit', {
      message: 'route commit',
      paths: 'all',
      confirm: true,
    })
    assert.equal(payload.ok, true)
    assert.ok(payload.files.includes('app.js'))
    const log = await run('git', ['log', '-1', '--pretty=%s'], { cwd: dir })
    assert.equal(String(log.stdout).trim(), 'route commit')

    const push = await callRoute(ctx, '/api/dsh-review/git-push', { confirm: false })
    assert.equal(push.ok, false)
    assert.match(push.message, /подтвержд/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
