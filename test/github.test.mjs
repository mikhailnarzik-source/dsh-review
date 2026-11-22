import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  GITHUB_API,
  branchInfo,
  createPullRequest,
  parseRemote,
  parseGitHubRemote,
} from '../lib/github.mjs'

const run = promisify(execFile)

/** Выполнить git в каталоге. */
async function git(dir, args) {
  const result = await run('git', args, { cwd: dir })
  return String(result.stdout ?? '')
}

/** Временный git-репозиторий с локальной идентичностью. */
async function repository(prefix = 'review-gh-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'test'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  return dir
}

/** Репозиторий с main, веткой feature и GitHub-origin. */
async function repoWithFeature() {
  const dir = await repository()
  await writeFile(join(dir, 'README.md'), '# app\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'init'])
  await git(dir, ['branch', '-M', 'main'])
  await git(dir, ['checkout', '-q', '-b', 'feature'])
  await writeFile(join(dir, 'feature.txt'), 'x\n', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'add feature'])
  await git(dir, ['remote', 'add', 'origin', 'https://github.com/acme/app.git'])
  return dir
}

/** Ответ-заглушка fetch. */
function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data }
}

/** Mock fetch: запоминает вызовы и отвечает по обработчику. */
function mockFetch(handler) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return handler(url, init, calls.length)
  }
  return { fetch, calls }
}

test('parseRemote: https, scp, ssh и лишний .git', () => {
  const expected = { owner: 'owner', repo: 'repo', host: 'github.com' }
  assert.deepEqual(parseRemote('https://github.com/owner/repo.git'), expected)
  assert.deepEqual(parseRemote('https://github.com/owner/repo'), expected)
  assert.deepEqual(parseRemote('https://github.com/owner/repo/'), expected)
  assert.deepEqual(parseRemote('git@github.com:owner/repo.git'), expected)
  assert.deepEqual(parseRemote('ssh://git@github.com/owner/repo'), expected)
  assert.deepEqual(parseRemote('git://github.com/owner/repo.git'), expected)
  assert.equal(parseRemote(''), null)
  assert.equal(parseRemote('not a remote'), null)
  assert.equal(parseRemote('https://github.com/owner'), null)

  const gitlab = parseRemote('https://gitlab.com/owner/repo.git')
  assert.equal(gitlab.host, 'gitlab.com')
  assert.equal(parseGitHubRemote('https://gitlab.com/owner/repo.git'), null)
  assert.deepEqual(parseGitHubRemote('git@github.com:owner/repo.git'), expected)
})

test('branchInfo: вне репозитория — понятная ошибка', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-gh-plain-'))
  try {
    const status = await branchInfo({ rootDir: root, dir: '.' })
    assert.equal(status.ok, false)
    assert.match(status.message, /git-репозитори/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('branchInfo: за пределами корня — отказ', async () => {
  const dir = await repository('review-gh-outside-')
  try {
    const status = await branchInfo({ rootDir: dir, dir: '..' })
    assert.equal(status.ok, false)
    assert.match(status.message, /вне корня/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('branchInfo: fallback base main, GitHub-remote и коммиты', async () => {
  const dir = await repoWithFeature()
  try {
    const info = await branchInfo({ rootDir: dir, dir: '.' })
    assert.equal(info.ok, true)
    assert.equal(info.branch, 'feature')
    assert.equal(info.baseBranch, 'main')
    assert.equal(info.ahead, null)
    assert.equal(info.behind, null)
    assert.equal(info.github.owner, 'acme')
    assert.equal(info.github.repo, 'app')
    assert.equal(info.github.host, 'github.com')
    assert.ok(info.commits.some(line => line.includes('add feature')))
    assert.ok(info.commits.length <= 20)
    assert.ok(info.warnings.some(warning => /upstream/.test(warning)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('branchInfo: не-GitHub origin — предупреждение', async () => {
  const dir = await repository('review-gh-gitlab-')
  try {
    await writeFile(join(dir, 'a.txt'), 'x\n', 'utf8')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-q', '-m', 'init'])
    await git(dir, ['remote', 'add', 'origin', 'https://gitlab.com/acme/app.git'])
    const info = await branchInfo({ rootDir: dir, dir: '.' })
    assert.equal(info.ok, true)
    assert.equal(info.github, null)
    assert.ok(info.warnings.some(warning => /не GitHub/.test(warning)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createPullRequest: confirm обязателен', async () => {
  const result = await createPullRequest({ rootDir: 'E:/tmp', dir: '.', title: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.message, /подтвержд/)
})

test('createPullRequest: без токена — подсказка про настройки', async () => {
  const dir = await repoWithFeature()
  try {
    const result = await createPullRequest({ rootDir: dir, dir: '.', title: 'PR', confirm: true, token: '' })
    assert.equal(result.ok, false)
    assert.match(result.message, /токен/)
    assert.match(result.message, /Настройки/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createPullRequest: head совпадает с base — отказ без сети', async () => {
  const dir = await repoWithFeature()
  const mock = mockFetch(() => {
    throw new Error('fetch не должен вызываться')
  })
  try {
    await git(dir, ['checkout', '-q', 'main'])
    const result = await createPullRequest({
      rootDir: dir,
      dir: '.',
      title: 'PR из main',
      confirm: true,
      token: 'token',
      fetch: mock.fetch,
    })
    assert.equal(result.ok, false)
    assert.match(result.message, /совпадает с base/)
    assert.equal(mock.calls.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createPullRequest: существующий PR возвращается как existing', async () => {
  const dir = await repoWithFeature()
  const mock = mockFetch(() => response([
    {
      number: 7,
      html_url: 'https://github.com/acme/app/pull/7',
      title: 'Feature',
      state: 'open',
      base: { ref: 'main' },
    },
  ]))
  try {
    const result = await createPullRequest({
      rootDir: dir,
      dir: '.',
      title: 'Feature PR',
      confirm: true,
      token: 'secret-token',
      fetch: mock.fetch,
    })
    assert.equal(result.ok, true)
    assert.equal(result.existing, true)
    assert.equal(result.number, 7)
    assert.equal(result.url, 'https://github.com/acme/app/pull/7')
    assert.equal(mock.calls.length, 1)
    const call = mock.calls[0]
    assert.ok(call.url.startsWith(`${GITHUB_API}/repos/acme/app/pulls?`))
    assert.ok(call.url.includes('head=acme%3Afeature'))
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.headers.Authorization, 'Bearer secret-token')
    assert.equal(call.init.headers.Accept, 'application/vnd.github+json')
    assert.equal(call.init.headers['X-GitHub-Api-Version'], '2022-11-28')
    assert.equal(call.init.headers['User-Agent'], 'dsh-review')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createPullRequest: создаёт PR через POST', async () => {
  const dir = await repoWithFeature()
  const mock = mockFetch((url, init) => {
    if (init.method === 'GET') return response([])
    return response({
      number: 42,
      html_url: 'https://github.com/acme/app/pull/42',
      title: 'My feature',
      base: { ref: 'main' },
    })
  })
  try {
    const result = await createPullRequest({
      rootDir: dir,
      dir: '.',
      title: 'My feature',
      body: 'Описание',
      confirm: true,
      token: 'secret-token',
      fetch: mock.fetch,
    })
    assert.equal(result.ok, true)
    assert.equal(result.existing, false)
    assert.equal(result.number, 42)
    assert.equal(result.url, 'https://github.com/acme/app/pull/42')
    assert.equal(result.base, 'main')
    assert.equal(result.head, 'feature')
    assert.equal(mock.calls.length, 2)
    const post = mock.calls[1]
    assert.equal(post.init.method, 'POST')
    assert.ok(post.url.startsWith(`${GITHUB_API}/repos/acme/app/pulls`))
    const payload = JSON.parse(post.init.body)
    assert.deepEqual(payload, { title: 'My feature', body: 'Описание', head: 'feature', base: 'main' })
    assert.equal(post.init.headers.Authorization, 'Bearer secret-token')
    assert.equal(post.init.headers['content-type'], 'application/json')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createPullRequest: ответ 422 переводится в понятную ошибку', async () => {
  const dir = await repoWithFeature()
  const mock = mockFetch((url, init) => {
    if (init.method === 'GET') return response([])
    return response(
      { message: 'Validation Failed', errors: [{ message: 'A pull request already exists.' }] },
      { ok: false, status: 422 },
    )
  })
  try {
    const result = await createPullRequest({
      rootDir: dir,
      dir: '.',
      title: 'Feature PR',
      confirm: true,
      token: 'secret-token',
      fetch: mock.fetch,
    })
    assert.equal(result.ok, false)
    assert.match(result.message, /422/)
    assert.match(result.message, /A pull request already exists/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
