import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProjects, isInsideProject, runTests } from '../lib/tests.mjs'

/** Манifest npm-проекта с тестовым скриптом. */
function pkg(name) {
  return JSON.stringify({ name, scripts: { test: 'node ok.js' } })
}

/** Создать дерево файлов и каталогов. */
async function writeTree(dir, tree) {
  for (const [name, value] of Object.entries(tree)) {
    const target = join(dir, name)
    if (typeof value === 'string') {
      await writeFile(target, value, 'utf8')
    } else {
      await mkdir(target, { recursive: true })
      await writeTree(target, value)
    }
  }
}

/** Временный корень воркспейса с заданным деревом. */
async function makeRoot(tree) {
  const root = await mkdtemp(join(tmpdir(), 'review-projects-'))
  await writeTree(root, tree)
  return root
}

test('detectProjects: корень, глубина 1–2, .publish и пропуск мусора', async () => {
  const gradleWrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const root = await makeRoot({
    'package.json': pkg('root-app'),
    sub1: { 'package.json': pkg('sub-one') },
    sub2: { 'package.json': JSON.stringify({ scripts: { test: 'node x.js' } }) },
    'gradle-dir': { [gradleWrapper]: '' },
    dotnet: { 'App.csproj': '<Project />' },
    '.publish': { plugin: { 'package.json': pkg('published-plugin') } },
    deep: { a: { b: { 'package.json': pkg('too-deep') } } },
    node_modules: { fake: { 'package.json': pkg('in-node-modules') } },
    dist: { 'package.json': pkg('in-dist') },
    build: { 'package.json': pkg('in-build') },
  })
  try {
    const candidates = detectProjects(root)
    const byRel = Object.fromEntries(candidates.map(candidate => [candidate.rel, candidate]))
    assert.equal(candidates[0].rel, '.', 'корень идёт первым')
    assert.equal(byRel['.'].label, 'root-app')
    assert.equal(byRel['.'].kind, 'npm')
    assert.equal(byRel['sub1'].label, 'sub-one')
    assert.equal(byRel['sub2'].label, 'sub2')
    assert.equal(byRel['gradle-dir'].kind, 'gradle')
    assert.equal(byRel['dotnet'].kind, 'dotnet')
    assert.equal(byRel['.publish/plugin'].label, 'published-plugin')
    assert.equal(byRel['deep/a/b'], undefined, 'глубже двух уровней не ищем')
    assert.equal(byRel['node_modules/fake'], undefined)
    assert.equal(byRel['dist'], undefined)
    assert.equal(byRel['build'], undefined)
    assert.ok(candidates.every(candidate => !candidate.rel.includes('\\')), 'пути через /')
    assert.ok(candidates.every(candidate => typeof candidate.dir === 'string' && candidate.dir !== ''))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detectProjects: лимит 60 кандидатов', async () => {
  const tree = {}
  for (let index = 0; index < 65; index += 1) {
    tree[`project-${String(index).padStart(2, '0')}`] = { 'package.json': pkg(`app-${index}`) }
  }
  const root = await makeRoot(tree)
  try {
    const candidates = detectProjects(root)
    assert.equal(candidates.length, 60)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runTests: каталог вне корня запрещён', async () => {
  const root = await makeRoot({ sub: { 'package.json': pkg('sub') } })
  const outside = await mkdtemp(join(tmpdir(), 'review-outside-'))
  await writeFile(join(outside, 'package.json'), pkg('outside'), 'utf8')
  try {
    const relativeOutside = await runTests(root, { dir: '../outside' })
    assert.equal(relativeOutside.ok, false)
    assert.match(relativeOutside.message, /вне корня/)
    const absoluteOutside = await runTests(root, { dir: outside })
    assert.equal(absoluteOutside.ok, false)
    assert.match(absoluteOutside.message, /вне корня/)
    assert.equal(isInsideProject(root, outside), false)
    assert.equal(isInsideProject(root, join(root, 'sub')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('runTests: несуществующий каталог внутри корня', async () => {
  const root = await makeRoot({ sub: { 'package.json': pkg('sub') } })
  try {
    const result = await runTests(root, { dir: 'nope' })
    assert.equal(result.ok, false)
    assert.match(result.message, /не найден/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runTests: несколько кандидатов — needsChoice без запуска', async () => {
  const root = await makeRoot({
    a: { 'package.json': pkg('a') },
    b: { 'package.json': pkg('b') },
  })
  try {
    const result = await runTests(root, {})
    assert.equal(result.ok, false)
    assert.equal(result.needsChoice, true)
    assert.equal(result.candidates.length, 2)
    assert.deepEqual(result.candidates.map(candidate => candidate.rel).sort(), ['a', 'b'])
    assert.equal(typeof result.command, 'undefined')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runTests: один кандидат запускается автоматически', async () => {
  const root = await makeRoot({
    sub: {
      'package.json': pkg('only'),
      'ok.js': "console.log('AUTO-OK')\n",
    },
  })
  try {
    const result = await runTests(root, { timeoutSec: 120 })
    assert.equal(result.ok, true)
    assert.equal(result.dir, 'sub')
    assert.equal(result.command, 'npm test')
    assert.ok(result.output.includes('AUTO-OK'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runTests: выбранный dir из нескольких кандидатов', async () => {
  const root = await makeRoot({
    a: { 'package.json': pkg('a') },
    b: {
      'package.json': pkg('b'),
      'ok.js': "console.log('SELECTED-OK')\n",
    },
  })
  try {
    const result = await runTests(root, { dir: 'b', command: 'node ok.js', timeoutSec: 60 })
    assert.equal(result.ok, true)
    assert.equal(result.dir, 'b')
    assert.ok(result.output.includes('SELECTED-OK'))

    const normalized = await runTests(root, { dir: 'b/../b', command: 'node ok.js', timeoutSec: 60 })
    assert.equal(normalized.ok, true)
    assert.equal(normalized.dir, 'b')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runTests: манифест в корне важнее вложенных проектов', async () => {
  const root = await makeRoot({
    'package.json': pkg('root-app'),
    'ok.js': "console.log('ROOT-OK')\n",
    sub: { 'package.json': pkg('sub') },
  })
  try {
    const result = await runTests(root, { timeoutSec: 120 })
    assert.equal(result.ok, true)
    assert.equal(result.dir, '.')
    assert.ok(result.output.includes('ROOT-OK'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runTests: кандидатов нет — подсказка с указанием dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-empty-'))
  try {
    const result = await runTests(root, {})
    assert.equal(result.ok, false)
    assert.equal(result.needsChoice, undefined)
    assert.match(result.message, /не найден package\.json/)
    assert.match(result.message, /dir/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detectProjects: установленные копии plugins/* исключены, .publish и mobile-app остаются', async () => {
  const gradleWrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const root = await makeRoot({
    plugins: {
      'dsh-cards': { 'package.json': pkg('dsh-cards-copy') },
      'dsh-review': { 'package.json': pkg('dsh-review-copy') },
    },
    '.publish': {
      'dsh-cards': { 'package.json': pkg('dsh-cards') },
    },
    'mobile-app': {
      android: { [gradleWrapper]: '' },
    },
  })
  try {
    const candidates = detectProjects(root)
    const rels = candidates.map(candidate => candidate.rel)
    assert.ok(!rels.some(rel => rel === 'plugins' || rel.startsWith('plugins/')), `plugins/* не должен попадать в список: ${rels.join(', ')}`)
    assert.ok(rels.includes('.publish/dsh-cards'))
    assert.ok(rels.includes('mobile-app/android'))
    assert.equal(candidates.find(candidate => candidate.rel === '.publish/dsh-cards')?.label, 'dsh-cards')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
