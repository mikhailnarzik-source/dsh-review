/**
 * Проверки рендера страницы плагина (слот `plugins.detail.section`) в едином
 * стиле DSH: контент по центру (maxWidth 960), шапка с иконкой и статус-чипом,
 * карточки-секции, единая система кнопок (спека `.tools/plugin-design-spec-v2.md`),
 * список файлов и адаптив; цвета — только токены темы.
 *
 * `client.js` исполняется в vm с поддельным `window.__ModuleLoader__` и
 * минимальным React: настоящий браузер для проверки разметки не нужен.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const SOURCE = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const PLUGIN = 'dsh-review'

/** Поддельный React: хуки отдают начальные значения или заданные тестом. */
function makeReact(states = []) {
  let index = 0
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const value = index < states.length
        ? states[index]
        : (typeof initial === 'function' ? initial() : initial)
      index += 1
      return [value, () => {}]
    },
    useEffect() {},
    useCallback(fn) { return fn },
    useMemo(fn) { return fn() },
    useRef(value) { return { current: value } },
  }
}

function loadClient() {
  let registration
  const sandbox = {
    window: { __ModuleLoader__: { load(options) { registration = options } } },
    console,
  }
  vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
  assert.ok(registration !== undefined, 'client.js не вызвал window.__ModuleLoader__.load')
  return registration
}

function makeContext() {
  const locales = []
  const slots = []
  const ctx = {
    locale: {
      register(namespace, dictionaries) { locales.push({ namespace, dictionaries }) },
      bind() { return (key) => `t:${key}` },
    },
    slots: {
      inject(name, callback) { callback() },
      register(options, component) { slots.push({ options, component }); return () => {} },
    },
  }
  return { ctx, locales, slots }
}

/** Отрисовать секцию страницы плагина и развернуть все функциональные компоненты. */
function renderDetail(states = []) {
  const registration = loadClient()
  const module = registration.factory((name) => {
    if (name === 'react') return makeReact(states)
    throw new Error(`неожиданный require: ${name}`)
  })
  const { ctx, locales, slots } = makeContext()
  module.apply(ctx)
  const section = slots.find((item) => item.options.name === 'plugins.detail.section')
  assert.ok(section, 'секция plugins.detail.section не зарегистрирована')
  const tree = section.component({ subject: { kind: 'bundle', pkg: { name: PLUGIN } } })
  return { ...survey(tree), locales }
}

/** Обойти дерево: вернуть элементы и тексты, попутно раскрывая компоненты. */
function survey(node, acc = { nodes: [], texts: [] }) {
  if (node === null || node === undefined || node === false || node === true) return acc
  if (typeof node === 'string' || typeof node === 'number') {
    acc.texts.push(String(node))
    return acc
  }
  if (Array.isArray(node)) {
    for (const item of node) survey(item, acc)
    return acc
  }
  if (typeof node !== 'object') return acc
  if (typeof node.type === 'function') {
    survey(node.type({ ...(node.props ?? {}), children: node.children }), acc)
    return acc
  }
  acc.nodes.push(node)
  for (const child of node.children ?? []) survey(child, acc)
  return acc
}

/** Текст внутри одного элемента (без подъёма к родителям). */
function textsOf(node, out = []) {
  for (const child of node.children ?? []) {
    if (typeof child === 'string' || typeof child === 'number') out.push(String(child))
    else if (child !== null && typeof child === 'object') textsOf(child, out)
  }
  return out
}

/** Все <style> страницы одним текстом. */
function pageCss(nodes) {
  return nodes
    .filter((node) => node.type === 'style')
    .flatMap((node) => node.children)
    .join('\n')
}

/** Хук-состояния по порядку: 18 useState в ChangesCard. */
function statesWith(overrides = {}) {
  const base = [
    true, // open
    null, // state
    false, // loading
    '', // error
    null, // selected
    [], // diff
    '', // confirm
    '', // notice
    '', // action
    null, // actionResult
    null, // pending
    [], // projects
    '', // selectedDir
    false, // projectsReady
    '', // projectsError
    null, // branchInfo
    '', // branchError
    null, // prPending
  ]
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value
  return base
}

test('страница: центрированный контейнер maxWidth 960 и адаптив', () => {
  const { nodes } = renderDetail()
  const page = nodes.find((node) => node.props?.style?.maxWidth === 960)
  assert.ok(page, 'нет контейнера maxWidth 960')
  const style = page.props.style
  assert.equal(style.width, '100%')
  assert.equal(style.margin, '0 auto')
  assert.equal(style.padding, '24px 28px 40px')
  assert.equal(style.boxSizing, 'border-box')
  assert.equal(style.display, 'flex')
  assert.equal(style.flexDirection, 'column')
  assert.equal(style.gap, 16)

  const css = pageCss(nodes)
  assert.match(css, /@media \(max-width: 900px\)/, 'на 900 px — одна колонка')
  assert.match(css, /@media \(max-width: 640px\)/, 'на 640 px — компактные поля')
  assert.match(css, /grid-template-columns:1fr/)
})

test('шапка: иконка 52, заголовок 20/600, статус-чип и «Обновить»', () => {
  const { nodes, texts } = renderDetail()
  const icon = nodes.find((node) => node.props?.style?.width === 52 && node.props?.style?.height === 52)
  assert.ok(icon, 'нет квадрата-иконки 52×52')
  assert.equal(icon.props.style.borderRadius, 14)
  assert.ok(texts.includes('📝'), 'в иконке нет эмодзи')

  const title = nodes.find((node) => node.type === 'h1')
  assert.ok(title, 'нет заголовка h1')
  assert.equal(title.props.style.fontSize, 20)
  assert.equal(title.props.style.fontWeight, 600)
  assert.ok(textsOf(title).includes('t:heading'))

  const chip = nodes.find((node) => node.props?.style?.borderRadius === 999)
  assert.ok(chip, 'нет статус-чипа')
  assert.equal(chip.props.style.display, 'inline-flex')
  assert.ok(textsOf(chip).includes('t:statusIdle'))

  const refresh = nodes.find(
    (node) => node.type === 'button' && textsOf(node).includes('t:refresh'),
  )
  assert.ok(refresh, 'нет кнопки «Обновить» в шапке')
  assert.equal(refresh.props.style.height, 32)
  assert.equal(refresh.props.style.borderRadius, 10)
  assert.equal(refresh.props.style.padding, '0 14px')
  assert.equal(refresh.props.style.background, 'transparent')
  assert.equal(typeof refresh.props.onClick, 'function')
})

test('контент: карточки-секции «Проект» и «Изменения» с кнопками 36/10', () => {
  const { nodes } = renderDetail()
  const cards = nodes.filter(
    (node) => node.type === 'section' && node.props?.style?.borderRadius === 14,
  )
  assert.equal(cards.length, 2, `ожидались две карточки-секции, найдено ${cards.length}`)
  for (const card of cards) {
    assert.equal(card.props.style.background, 'var(--dsw-alias-bg-layer-1)')
    assert.equal(card.props.style.border, '1px solid var(--dsw-alias-border-l2)')
    assert.equal(card.props.style.padding, 16)
    assert.equal(card.props.style.gap, 12)
    assert.equal(card.props.style.flexDirection, 'column')
    assert.equal(card.props.style.minWidth, 0)
  }

  const titles = nodes.filter((node) => node.type === 'h2').map((node) => textsOf(node).join(''))
  assert.ok(titles.includes('t:sectionProject'), 'нет секции «Проект»')
  assert.ok(titles.includes('t:sectionChanges'), 'нет секции «Изменения»')

  const bars = nodes.filter(
    (node) => node.props?.style?.width === 3 && node.props?.style?.height === 14,
  )
  assert.equal(bars.length, 2, 'нет акцентных полосок у заголовков секций')

  for (const [key, label] of [['runTests', 't:runTests'], ['commitPush', 't:commitPush'], ['createPr', 't:createPr']]) {
    const button = nodes.find((node) => node.type === 'button' && textsOf(node).includes(label))
    assert.ok(button, `нет кнопки ${key}`)
    assert.equal(button.props.style.height, 36)
    assert.equal(button.props.style.borderRadius, 10)
    assert.equal(typeof button.props.onClick, 'function')
  }

  const grid = nodes.find((node) => node.props?.style?.display === 'grid')
  assert.ok(grid, 'нет сетки «Проект»')
  assert.equal(grid.props.style.gridTemplateColumns, 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))')
  assert.equal(grid.props.style.alignItems, 'stretch')
  assert.equal(grid.props.style.minWidth, 0)
})

test('единая система кнопок: 36/32, радиус 10, мягкие заливки, нет белого на белом', () => {
  // Ветка ошибки: danger-кнопка подтверждения git init.
  const errorBranch = renderDetail(statesWith({ 3: 'нет git', 6: '__init__' }))
  // Ветка PR: primary-кнопка подтверждения.
  const prBranch = renderDetail(statesWith({
    2: false,
    17: { title: 'Заголовок', body: '', base: 'main', head: 'feature', github: { repo: 'owner/repo' } },
  }))

  for (const { nodes, label } of [errorBranch, prBranch]) {
    for (const button of nodes.filter((node) => node.type === 'button')) {
      const style = button.props.style ?? {}
      assert.ok([32, 36].includes(style.height), `${label}: высота кнопки 32 или 36, а не ${style.height}`)
      assert.equal(style.borderRadius, 10, `${label}: радиус кнопки 10`)
      assert.equal(style.display, 'inline-flex', `${label}: кнопка — inline-flex`)
      assert.equal(style.fontWeight, 600, `${label}: кнопка — 600`)
      assert.equal(style.fontSize, 12.5, `${label}: кнопка — 12.5`)
      assert.equal(style.whiteSpace, 'nowrap', `${label}: подпись не переносится`)
      if (textsOf(button).join('').trim() !== '') {
        assert.equal(style.width, undefined, `${label}: нет фиксированной ширины`)
        assert.equal(style.minWidth, undefined, `${label}: нет фиксированной min-width`)
      }
      assert.doesNotMatch(String(style.color ?? ''), /#fff|#ffffff|label-primary-inverted/i, `${label}: нет белого текста`)
    }
  }

  const primary = prBranch.nodes.find(
    (node) => node.type === 'button' && textsOf(node).includes('t:confirm'),
  )
  assert.ok(primary, 'нет primary-кнопки подтверждения PR')
  assert.match(String(primary.props.style.background), /color-mix\(in srgb, ?var\(--dsw-alias-brand-primary\) 18%, ?transparent\)/)
  assert.match(String(primary.props.style.border), /color-mix\(in srgb, ?var\(--dsw-alias-brand-primary\) 55%, ?transparent\)/)
  assert.equal(primary.props.style.color, 'var(--dsw-alias-brand-primary)')

  const danger = errorBranch.nodes.find(
    (node) => node.type === 'button' && textsOf(node).includes('t:yes'),
  )
  assert.ok(danger, 'нет danger-кнопки')
  assert.equal(danger.props.style.background, 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent)')
  assert.equal(danger.props.style.color, 'var(--dsw-alias-state-error-primary)')

  const css = pageCss(errorBranch.nodes)
  assert.match(css, /\.dshrv-page-primary:hover:not\(:disabled\)/, 'есть hover у primary')
  assert.match(css, /\.dshrv-page-danger:hover:not\(:disabled\)/, 'есть hover у danger')
  assert.doesNotMatch(css, /#fff|#ffffff/i, 'в CSS нет белого текста')
})

test('адаптив: перенос кнопок, поля на всю ширину, длинные строки', () => {
  const { nodes } = renderDetail()
  const css = pageCss(nodes)
  assert.match(css, /\.dshrv-page\{overflow-wrap:anywhere;\}/)
  assert.match(css, /\.dshrv-page-actions\{[^}]*flex-wrap:wrap/)
  assert.match(css, /\.dshrv-page-actions\{[^}]*margin-top:auto/, 'футер прижат к низу')

  const headRight = nodes.find((node) => node.props?.className === 'dshrv-page-head-right')
  assert.ok(headRight, 'правая часть шапки переносится')
  assert.equal(headRight.props.style.flexWrap, 'wrap')

  const select = nodes.find((node) => node.type === 'select')
  if (select !== undefined) {
    assert.equal(select.props.style.width, '100%', 'поле не имеет фиксированной ширины')
    assert.equal(select.props.style.maxWidth, undefined)
  }

  const actions = nodes.find((node) => node.props?.className === 'dshrv-page-actions')
  assert.ok(actions, 'строка действий размечена')
  assert.equal(actions.props.style.flexWrap, 'wrap')
  assert.equal(actions.props.style.minWidth, 0)
})

test('изменения: чип с числом файлов, строки списка и empty state', () => {
  const withFiles = renderDetail(statesWith({
    1: {
      total: 2,
      added: 10,
      removed: 3,
      files: [
        { path: 'src/a.js', kind: 'modified', added: 5, removed: 1 },
        { path: 'src/b.js', kind: 'untracked', added: 2, removed: 0 },
      ],
    },
  }))
  const chip = withFiles.nodes.find((node) => node.props?.style?.borderRadius === 999)
  assert.ok(chip, 'нет статус-чипа')
  const chipText = textsOf(chip).join(' ')
  assert.ok(chipText.includes('t:statusChanges') && chipText.includes('2'), 'чип не показывает число файлов')

  const rows = withFiles.nodes.filter((node) => node.props?.className === 'dshrv-page-file')
  assert.equal(rows.length, 2, 'строки списка файлов не отрисованы')
  assert.equal(typeof rows[0].props.onClick, 'function')
  assert.ok(withFiles.texts.includes('src/a.js'))
  assert.ok(withFiles.texts.includes('src/b.js'))
  assert.ok(withFiles.texts.includes('t:modified'))

  const clean = renderDetail(statesWith({
    1: { total: 0, added: 0, removed: 0, files: [] },
    13: true,
  }))
  const cleanChip = clean.nodes.find((node) => node.props?.style?.borderRadius === 999)
  assert.ok(textsOf(cleanChip).includes('t:statusClean'), 'чип не показывает «Чисто»')
  assert.ok(clean.texts.includes('t:empty'), 'нет текста пустого состояния')
  assert.ok(clean.texts.includes('t:emptyHint'), 'нет подсказки пустого состояния')
  const emptyIcon = clean.nodes.find((node) => node.props?.style?.fontSize === 32)
  assert.ok(emptyIcon, 'нет иконки пустого состояния')
})

test('цвета: только токены темы, жёстких hex и белого текста нет', () => {
  const { nodes } = renderDetail()
  const styles = nodes
    .map((node) => node.props?.style)
    .filter((style) => style !== undefined && style !== null)
  const dump = JSON.stringify(styles)
  assert.doesNotMatch(dump, /#[0-9a-fA-F]{3,8}\b/, 'в стилях есть жёсткий hex-цвет')
  assert.doesNotMatch(dump, /label-primary-inverted/, 'нет белого текста через label-primary-inverted')
  assert.match(dump, /var\(--dsw-alias-/, 'в стилях нет токенов темы')
})

test('свёрнутое состояние: только шапка, без карточек', () => {
  const { nodes } = renderDetail(statesWith({ 0: false }))
  assert.ok(nodes.some((node) => node.props?.style?.maxWidth === 960), 'страница осталась')
  assert.equal(
    nodes.filter((node) => node.type === 'section' && node.props?.style?.borderRadius === 14).length,
    0,
    'в свёрнутом виде карточки не показываются',
  )
})

test('словари en и ru содержат одинаковые ключи', () => {
  const { locales } = renderDetail()
  const dictionaries = locales[0].dictionaries
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'ru'])
  assert.deepEqual(
    Object.keys(dictionaries.en).sort(),
    Object.keys(dictionaries.ru).sort(),
    'словари en и ru должны содержать одинаковые ключи',
  )
  for (const key of ['sectionProject', 'sectionChanges', 'statusIdle', 'statusClean', 'statusChanges', 'statusError', 'emptyHint']) {
    assert.ok(key in dictionaries.en, `en: нет ключа ${key}`)
    assert.ok(key in dictionaries.ru, `ru: нет ключа ${key}`)
  }
})
