import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { commitChanges, findSecretPaths, lookLikeSecret, pushChanges, readStatusFiles } from '../lib/git.mjs'

const run = promisify(execFile)

/** Выполнить git в каталоге. */
async function git(dir, args) {
  const result = await run('git', args, { cwd: dir })
  return String(result.stdout ?? '')
}

/** Создать временный git-репозиторий с локальной идентичностью. */
async function repository(prefix = 'review-git-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'test'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  return dir
}

test('секреты: типичные имена файлов распознаются', () => {
  assert.equal(lookLikeSecret('.env'), true)
  assert.equal(lookLikeSecret('src/.env.local'), true)
  assert.equal(lookLikeSecret('deploy/app.key'), true)
  assert.equal(lookLikeSecret('my-secret.txt'), true)
  assert.equal(lookLikeSecret('credentials.yaml'), true)
  assert.equal(lookLikeSecret('cert.pem'), true)
  assert.equal(lookLikeSecret('src/app.js'), false)
  assert.equal(lookLikeSecret('environment.md'), false)
  assert.equal(lookLikeSecret('keyboard.js'), false)
  assert.deepEqual(findSecretPaths(['src/app.js', '.env', 'cert.pem']), ['.env', 'cert.pem'])
})

test('коммит: без confirm отказывает', async () => {
  const result = await commitChanges('E:/tmp', { message: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.message, /подтвержд/)
})

test('коммит: без изменений отказывает', async () => {
  const dir = await repository()
  try {
    const result = await commitChanges(dir, { message: 'пусто', confirm: true })
    assert.equal(result.ok, false)
    assert.match(result.message, /нет изменений/)
    assert.deepEqual(result.files, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: файл, похожий на секрет, блокирует коммит', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, '.env'), 'TOKEN=secret\n', 'utf8')
    const result = await commitChanges(dir, { message: 'добавил env', confirm: true })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.ok(result.files.includes('.env'))
    assert.match(result.message, /секрет/)
    // Ничего не закоммичено.
    const status = await readStatusFiles(dir)
    assert.ok(status.some(file => file.path === '.env'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: создаёт коммит и возвращает список файлов', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, 'app.js'), 'const value = 1\n', 'utf8')
    const result = await commitChanges(dir, { message: 'первый коммит', confirm: true })
    assert.equal(result.ok, true)
    assert.ok(result.files.includes('app.js'))
    assert.equal(typeof result.commit, 'string')
    assert.ok(result.commit.length > 0)
    const log = await git(dir, ['log', '-1', '--pretty=%s'])
    assert.equal(log.trim(), 'первый коммит')
    const status = await readStatusFiles(dir)
    assert.equal(status.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: путь вне проекта отклоняется', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, 'app.js'), 'const value = 1\n', 'utf8')
    const result = await commitChanges(dir, { message: 'x', paths: ['../outside.txt'], confirm: true })
    assert.equal(result.ok, false)
    assert.match(result.message, /вне проекта/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('push: без confirm отказывает', async () => {
  const result = await pushChanges('E:/tmp', {})
  assert.equal(result.ok, false)
  assert.match(result.message, /подтвержд/)
})

test('push: недопустимая ветка отклоняется', async () => {
  const result = await pushChanges('E:/tmp', { confirm: true, branch: '--force' })
  assert.equal(result.ok, false)
  assert.match(result.message, /ветка|branch/i)
})

test('push: отправляет ветку в локальный bare-remote', async () => {
  const dir = await repository()
  const bare = await mkdtemp(join(tmpdir(), 'review-remote-'))
  try {
    await git(bare, ['init', '--bare', '-q', '-b', 'main'])
    await writeFile(join(dir, 'app.js'), 'const value = 2\n', 'utf8')
    const commit = await commitChanges(dir, { message: 'к пушу', confirm: true })
    assert.equal(commit.ok, true)
    await git(dir, ['remote', 'add', 'origin', bare])

    const pushed = await pushChanges(dir, { confirm: true })
    assert.equal(pushed.ok, true)
    assert.equal(pushed.remote, 'origin')
    assert.equal(pushed.branch, 'main')
    assert.equal(pushed.protectedBranch, true)
    assert.equal(pushed.forced, false)
    const remoteHead = await git(bare, ['rev-parse', '--verify', 'refs/heads/main'])
    assert.ok(remoteHead.trim().length > 0)
    const remoteLog = await git(bare, ['log', '-1', '--pretty=%s', 'main'])
    assert.equal(remoteLog.trim(), 'к пушу')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(bare, { recursive: true, force: true })
  }
})
