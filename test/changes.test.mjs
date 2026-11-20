import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { annotateDiff, insideProject, parseNumstat, parsePorcelain } from '../lib/changes.mjs'

test('porcelain: изменённый и новый файл', () => {
  const files = parsePorcelain(' M src/app.js\u0000?? notes.md\u0000')
  assert.equal(files.length, 2)
  assert.deepEqual(files[0], { path: 'src/app.js', index: ' ', worktree: 'M', kind: 'modified' })
  assert.deepEqual(files[1], { path: 'notes.md', index: '?', worktree: '?', kind: 'untracked' })
})

test('porcelain: переименование берёт новое имя', () => {
  const files = parsePorcelain('R  old.js\u0000new.js\u0000')
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'new.js')
  assert.equal(files[0].kind, 'renamed')
})

test('numstat: добавленные и удалённые строки', () => {
  const stats = parseNumstat('12\t3\tsrc/app.js\n0\t0\timage.png\n')
  assert.equal(stats.get('src/app.js').added, 12)
  assert.equal(stats.get('src/app.js').removed, 3)
  assert.equal(stats.get('image.png').added, 0)
})

test('diff: строки размечены по типу', () => {
  const lines = annotateDiff('diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n same')
  assert.deepEqual(lines.map(line => line.kind), ['meta', 'hunk', 'del', 'add', 'context'])
})

test('пути: выход за пределы проекта запрещён', () => {
  const root = join(tmpdir(), 'project-root')
  assert.equal(insideProject(root, 'src/app.js'), true)
  assert.equal(insideProject(root, '../outside.js'), false)
  assert.equal(insideProject(root, '..'), false)
})

test('чтение изменений и откат нового файла', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-'))
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'app.js'), 'const value = 1\n', 'utf8')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    await run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    await run('git', ['add', '.'], { cwd: dir })
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir })

    await writeFile(join(dir, 'src', 'app.js'), 'const value = 2\n', 'utf8')
    await writeFile(join(dir, 'fresh.md'), 'новый файл\n', 'utf8')

    const { readChanges, readDiff, revertFile } = await import('../lib/changes.mjs')
    const changes = await readChanges(dir)
    assert.equal(changes.total, 2)
    assert.ok(changes.files.some(file => file.path === 'src/app.js' && file.kind === 'modified'))
    assert.ok(changes.files.some(file => file.path === 'fresh.md' && file.kind === 'untracked'))

    const diff = await readDiff(dir, 'src/app.js')
    assert.ok(diff.some(line => line.kind === 'add' && line.line.includes('value = 2')))
    assert.ok(diff.some(line => line.kind === 'del' && line.line.includes('value = 1')))

    const reverted = await revertFile(dir, 'src/app.js', false)
    assert.equal(reverted.action, 'reverted')
    const after = await readChanges(dir)
    assert.equal(after.total, 1)

    const removed = await revertFile(dir, 'fresh.md', true)
    assert.equal(removed.action, 'removed')
    const final = await readChanges(dir)
    assert.equal(final.total, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('откат за пределы проекта не проходит', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-guard-'))
  try {
    const { revertFile } = await import('../lib/changes.mjs')
    await assert.rejects(() => revertFile(dir, '../secret.txt', true), /вне проекта/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
