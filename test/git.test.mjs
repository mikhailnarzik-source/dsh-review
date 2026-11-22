import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  MAX_COMMIT_FILES,
  commitChanges,
  dangerousPathKind,
  findDangerousPaths,
  findSecretPaths,
  gitStatus,
  lookLikeSecret,
  pushChanges,
  readStatusFiles,
  resolveRepoRoot,
} from '../lib/git.mjs'

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

/** Прочитать список файлов в статусе репозитория. */
async function statusPaths(dir) {
  return (await readStatusFiles(dir)).map(file => file.path)
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

test('опасные пути: служебные каталоги и логи', () => {
  assert.equal(dangerousPathKind('node_modules/pkg/index.js'), 'node_modules/')
  assert.equal(dangerousPathKind('.npm-cache/a/b'), '.npm-cache/')
  assert.equal(dangerousPathKind('.pnpm-store/v3/x'), '.pnpm-store/')
  assert.equal(dangerousPathKind('nested/.artifacts/out.bin'), '.artifacts/')
  assert.equal(dangerousPathKind('logs/app.log'), '*.log')
  assert.equal(dangerousPathKind('deep.log'), '*.log')
  assert.equal(dangerousPathKind('src/app.js'), null)
  assert.equal(dangerousPathKind('src/nodelike/app.js'), null)
  assert.deepEqual(findDangerousPaths(['src/app.js', 'node_modules/x', 'a.log']), ['node_modules/x', 'a.log'])
})

test('коммит: без confirm отказывает', async () => {
  const result = await commitChanges({ rootDir: 'E:/tmp', dir: '.', message: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.message, /подтвержд/)
})

test('push: без confirm отказывает', async () => {
  const result = await pushChanges({ rootDir: 'E:/tmp', dir: '.' })
  assert.equal(result.ok, false)
  assert.match(result.message, /подтвержд/)
})

test('коммит: без изменений отказывает', async () => {
  const dir = await repository()
  try {
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'пусто', confirm: true })
    assert.equal(result.ok, false)
    assert.match(result.message, /нет изменений/)
    assert.deepEqual(result.files, [])
    assert.equal(result.repo, '.')
    assert.equal(result.branch, 'main')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: файл, похожий на секрет, блокирует коммит', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, '.env'), 'TOKEN=secret\n', 'utf8')
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'добавил env', confirm: true })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.ok(result.files.includes('.env'))
    assert.equal(result.repo, '.')
    assert.match(result.message, /секрет/)
    assert.ok((await statusPaths(dir)).includes('.env'), 'ничего не закоммичено')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: опасные пути блокируются, после .gitignore коммит проходит', async () => {
  const dir = await repository()
  try {
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'x\n', 'utf8')
    await writeFile(join(dir, 'debug.log'), 'log\n', 'utf8')
    await writeFile(join(dir, 'app.js'), 'const a = 1\n', 'utf8')

    const blocked = await commitChanges({ rootDir: dir, dir: '.', message: 'мусор', confirm: true })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.blocked, true)
    assert.match(blocked.message, /опасные пути/)
    assert.match(blocked.message, /gitignore/)
    // git status показывает неотслеживаемый каталог целиком: node_modules/.
    assert.ok(blocked.files.some(path => path === 'node_modules/' || path.startsWith('node_modules/')))
    assert.ok(blocked.files.includes('debug.log'))

    await writeFile(join(dir, '.gitignore'), 'node_modules/\n*.log\n', 'utf8')
    const ok = await commitChanges({ rootDir: dir, dir: '.', message: 'приложение', confirm: true })
    assert.equal(ok.ok, true)
    assert.ok(ok.files.includes('app.js'))
    assert.ok(!ok.files.includes('debug.log'))
    const log = await git(dir, ['log', '-1', '--pretty=%s'])
    assert.equal(log.trim(), 'приложение')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test(`коммит: лимит ${MAX_COMMIT_FILES} файлов`, async () => {
  const dir = await repository()
  try {
    for (let index = 0; index < MAX_COMMIT_FILES + 1; index += 1) {
      await writeFile(join(dir, `file-${index}.txt`), `${index}\n`, 'utf8')
    }
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'много', confirm: true })
    assert.equal(result.ok, false)
    assert.equal(result.total, MAX_COMMIT_FILES + 1)
    assert.match(result.message, new RegExp(String(MAX_COMMIT_FILES)))
    assert.match(result.message, /лимит/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: таймаут git-операции возвращает понятную ошибку', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, 'app.js'), 'const a = 1\n', 'utf8')
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'таймаут', confirm: true, timeoutMs: 10 })
    assert.equal(result.ok, false)
    assert.equal(result.timedOut, true)
    assert.match(result.message, /не завершился за/)
    assert.ok((await statusPaths(dir)).includes('app.js'), 'коммит не создан')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: таймаут именно git add (медленный clean-фильтр)', async () => {
  const dir = await repository()
  try {
    // Clean-фильтр «зависает», поэтому git status быстрый, а git add — нет.
    await git(dir, ['config', 'filter.slow.clean', 'node -e "setTimeout(() => {}, 10000)"'])
    await writeFile(join(dir, '.gitattributes'), '*.txt filter=slow\n', 'utf8')
    await writeFile(join(dir, 'a.txt'), 'hello\n', 'utf8')
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'медленный add', confirm: true, timeoutMs: 1500 })
    assert.equal(result.ok, false)
    assert.equal(result.timedOut, true)
    assert.match(result.message, /git add не завершился за/)
    assert.match(result.message, /gitignore/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: создаёт коммит и возвращает repo/branch/files/hash', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, 'app.js'), 'const value = 1\n', 'utf8')
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'первый коммит', confirm: true })
    assert.equal(result.ok, true)
    assert.equal(result.repo, '.')
    assert.equal(result.branch, 'main')
    assert.ok(result.files.includes('app.js'))
    assert.equal(typeof result.hash, 'string')
    assert.ok(result.hash.length > 0)
    assert.equal(result.hash, result.commit)
    const log = await git(dir, ['log', '-1', '--pretty=%s'])
    assert.equal(log.trim(), 'первый коммит')
    assert.equal((await statusPaths(dir)).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('коммит: путь вне репозитория отклоняется', async () => {
  const dir = await repository()
  try {
    await writeFile(join(dir, 'app.js'), 'const value = 1\n', 'utf8')
    const result = await commitChanges({ rootDir: dir, dir: '.', message: 'x', paths: ['../outside.txt'], confirm: true })
    assert.equal(result.ok, false)
    assert.match(result.message, /вне репозитория/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveRepoRoot: выбирает вложенный репозиторий и его ветку', async () => {
  const root = await repository('review-scope-')
  try {
    const nested = join(root, '.publish', 'app')
    await mkdir(nested, { recursive: true })
    await git(nested, ['init', '-q', '-b', 'main'])
    await git(nested, ['config', 'user.name', 'test'])
    await git(nested, ['config', 'user.email', 'test@example.com'])
    const resolved = await resolveRepoRoot(root, '.publish/app')
    assert.equal(resolved.ok, true)
    assert.equal(resolved.repo, nested)
    assert.equal(resolved.rel, '.publish/app')
    assert.equal(resolved.branch, 'main')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('git-status: файлы выбранного каталога, а не корня', async () => {
  const root = await repository('review-status-scope-')
  try {
    const nested = join(root, '.publish', 'app')
    await mkdir(nested, { recursive: true })
    await git(nested, ['init', '-q', '-b', 'main'])
    await git(nested, ['config', 'user.name', 'test'])
    await git(nested, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(root, 'root-only.txt'), 'root\n', 'utf8')
    await writeFile(join(nested, 'app.js'), 'const a = 1\n', 'utf8')

    const status = await gitStatus({ rootDir: root, dir: '.publish/app' })
    assert.equal(status.ok, true)
    assert.equal(status.repo, '.publish/app')
    assert.equal(status.branch, 'main')
    assert.deepEqual(status.files, ['app.js'])
    assert.equal(status.total, 1)
    assert.deepEqual(status.warnings, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('git-status: не git-репозиторий — понятная ошибка', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-not-git-'))
  const previousCeiling = process.env.GIT_CEILING_DIRECTORIES
  // Temp лежит внутри домашнего репозитория: запрещаем git искать выше root.
  process.env.GIT_CEILING_DIRECTORIES = root
  try {
    const nested = join(root, 'plain')
    await mkdir(nested, { recursive: true })
    const status = await gitStatus({ rootDir: root, dir: 'plain' })
    assert.equal(status.ok, false)
    assert.match(status.message, /не является git-репозиторием/)
    const commit = await commitChanges({ rootDir: root, dir: 'plain', message: 'x', confirm: true })
    assert.equal(commit.ok, false)
    assert.match(commit.message, /не является git-репозиторием/)
  } finally {
    if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = previousCeiling
    await rm(root, { recursive: true, force: true })
  }
})

test('git: каталог вне корня воркспейса отклоняется', async () => {
  const root = await repository('review-outside-git-')
  const outside = await repository('review-outside-repo-')
  try {
    for (const dir of ['..', outside]) {
      const status = await gitStatus({ rootDir: root, dir })
      assert.equal(status.ok, false)
      assert.match(status.message, /вне корня/)
      const commit = await commitChanges({ rootDir: root, dir, message: 'x', confirm: true })
      assert.equal(commit.ok, false)
      assert.match(commit.message, /вне корня/)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('коммит и push: работают в репозитории выбранного каталога', async () => {
  const root = await repository('review-scope-commit-')
  const bare = await mkdtemp(join(tmpdir(), 'review-scope-remote-'))
  try {
    await writeFile(join(root, 'root.txt'), 'root\n', 'utf8')
    const rootCommit = await commitChanges({ rootDir: root, dir: '.', message: 'корень', confirm: true })
    assert.equal(rootCommit.ok, true)

    const nested = join(root, '.publish', 'app')
    await mkdir(nested, { recursive: true })
    await git(nested, ['init', '-q', '-b', 'main'])
    await git(nested, ['config', 'user.name', 'test'])
    await git(nested, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(nested, 'app.js'), 'const a = 2\n', 'utf8')

    const commit = await commitChanges({ rootDir: root, dir: '.publish/app', message: 'вложенный', confirm: true })
    assert.equal(commit.ok, true)
    assert.equal(commit.repo, '.publish/app')
    assert.equal(commit.branch, 'main')
    assert.ok(commit.files.includes('app.js'))
    const nestedLog = await git(nested, ['log', '-1', '--pretty=%s'])
    assert.equal(nestedLog.trim(), 'вложенный')
    const rootLog = await git(root, ['log', '--pretty=%s'])
    assert.equal(rootLog.trim(), 'корень', 'репозиторий корня не тронут')

    await git(bare, ['init', '--bare', '-q', '-b', 'main'])
    await git(nested, ['remote', 'add', 'origin', bare])
    const pushed = await pushChanges({ rootDir: root, dir: '.publish/app', confirm: true })
    assert.equal(pushed.ok, true)
    assert.equal(pushed.repo, '.publish/app')
    assert.equal(pushed.remote, 'origin')
    assert.equal(pushed.branch, 'main')
    assert.equal(pushed.protectedBranch, true)
    const remoteLog = await git(bare, ['log', '-1', '--pretty=%s', 'main'])
    assert.equal(remoteLog.trim(), 'вложенный')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(bare, { recursive: true, force: true })
  }
})

test('push: недопустимая ветка отклоняется', async () => {
  const dir = await repository()
  try {
    const result = await pushChanges({ rootDir: dir, dir: '.', confirm: true, branch: '--force' })
    assert.equal(result.ok, false)
    assert.match(result.message, /ветка|branch/i)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
