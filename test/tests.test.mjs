import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectTestCommand,
  normalizeTimeoutSec,
  parseTestSummary,
  readPackageTestScript,
  trimOutput,
  runTests,
} from '../lib/tests.mjs'

/** Создать временный каталог проекта с файлами. */
async function project(files, prefix = 'tests-detect-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf8')
  }
  return dir
}

test('автодетект: package.json со scripts.test → npm test', async () => {
  const dir = await project({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) })
  try {
    assert.equal(readPackageTestScript(dir), 'node --test')
    assert.equal(detectTestCommand(dir), 'npm test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('автодетект: pnpm-lock → pnpm test', async () => {
  const dir = await project({
    'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  })
  try {
    assert.equal(detectTestCommand(dir), 'pnpm test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('автодетект: gradlew → gradlew test', async () => {
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const dir = await project({ [wrapper]: '' })
  try {
    assert.equal(detectTestCommand(dir), process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('автодетект: .sln/.csproj → dotnet test', async () => {
  const dir = await project({ 'App.csproj': '<Project />' })
  try {
    assert.match(detectTestCommand(dir), /^dotnet test "App\.csproj"$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('автодетект: .sln важнее .csproj', async () => {
  const dir = await project({ 'App.sln': 'solution', 'App.csproj': '<Project />' })
  try {
    assert.match(detectTestCommand(dir), /^dotnet test "App\.sln"$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('автодетект: пустой каталог → npm test', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tests-empty-'))
  try {
    assert.equal(detectTestCommand(dir), 'npm test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('таймаут: значение приводится к диапазону 1..3600', () => {
  assert.equal(normalizeTimeoutSec(undefined), 600)
  assert.equal(normalizeTimeoutSec('30'), 30)
  assert.equal(normalizeTimeoutSec(0), 600)
  assert.equal(normalizeTimeoutSec(-5), 600)
  assert.equal(normalizeTimeoutSec(99999), 3600)
})

test('обрезка: начало, маркер и хвост', () => {
  const short = trimOutput('короткий вывод')
  assert.equal(short.truncated, false)
  assert.equal(short.output, 'короткий вывод')

  const long = `${'H'.repeat(2000)}${'M'.repeat(30000)}${'T'.repeat(2000)}`
  const trimmed = trimOutput(long)
  assert.equal(trimmed.truncated, true)
  assert.ok(trimmed.output.length <= 12000)
  assert.ok(trimmed.output.startsWith('H'.repeat(2000)))
  assert.ok(trimmed.output.includes('…обрезано…'))
  assert.ok(trimmed.output.endsWith('T'.repeat(2000)))
})

test('итог тестов: node TAP, mocha, pytest, dotnet', () => {
  assert.deepEqual(parseTestSummary('# tests 5\n# pass 5\n# fail 0\n'), { passed: 5, failed: 0 })
  assert.deepEqual(parseTestSummary('  3 passing (12ms)\n  1 failing\n'), { passed: 3, failed: 1 })
  assert.deepEqual(parseTestSummary('2 failed, 7 passed in 1.2s'), { passed: 7, failed: 2 })
  assert.deepEqual(parseTestSummary('Failed: 0, Passed: 4, Skipped: 0'), { passed: 4, failed: 0 })
  assert.deepEqual(parseTestSummary('Tests run: 5, Failures: 1, Errors: 1, Skipped: 0'), { passed: 3, failed: 2 })
  assert.deepEqual(parseTestSummary('нечего парсить'), { passed: null, failed: null })
})

test('runTests: успешный запуск через автодетект npm test', async () => {
  const dir = await project({
    'package.json': JSON.stringify({ scripts: { test: 'node ok.js' } }),
    'ok.js': "console.log('TESTS-OK-123')\n",
  })
  try {
    const result = await runTests(dir, { timeoutSec: 120 })
    assert.equal(result.ok, true)
    assert.equal(result.command, 'npm test')
    assert.equal(result.exitCode, 0)
    assert.ok(result.output.includes('TESTS-OK-123'))
    assert.ok(result.durationMs >= 0)
    assert.equal(result.timedOut, false)
    assert.equal(typeof result.truncated, 'boolean')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runTests: падение возвращает ненулевой код', async () => {
  const dir = await project({
    'fail.js': "console.error('boom'); process.exit(3)\n",
  })
  try {
    const result = await runTests(dir, { command: 'node fail.js', timeoutSec: 60 })
    assert.equal(result.ok, false)
    assert.equal(result.command, 'node fail.js')
    assert.equal(result.exitCode, 3)
    assert.ok(result.output.includes('boom'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runTests: таймаут убивает процесс', async () => {
  const dir = await project({
    'sleep.js': 'setTimeout(() => {}, 60000)\n',
  })
  try {
    const result = await runTests(dir, { command: 'node sleep.js', timeoutSec: 1 })
    assert.equal(result.ok, false)
    assert.equal(result.timedOut, true)
    assert.ok(result.durationMs < 15000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
