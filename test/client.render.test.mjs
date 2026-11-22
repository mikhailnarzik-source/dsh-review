/**
 * Проверки рендера страницы плагина (слот `plugins.detail.section`) в едином
 * стиле DSH: контент по центру (maxWidth 960), шапка с иконкой и статус-чипом,
 * карточки-секции, единая система кнопок и чипов (спека
 * `.tools/plugin-design-spec-v2.md`), карточка «Проект» одной колонкой,
 * список файлов и адаптив 1280/1024/768/480; цвета — только токены темы.
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

/** Все чипы-статусы страницы в порядке появления. */
function chips(nodes) {
  return nodes.filter(
    (node) => typeof node.props?.className === 'string'
      && node.props.className.split(' ')[0] === 'dshrv-page-chip',
  )
}

/** Чип по подписи (текст внутри одного элемента). */
function chipByText(nodes, label) {
  return chips(nodes).find((node) => textsOf(node).join('').trim() === label)
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

const PROJECT_CANDIDATES = [
  { rel: '.publish/dsh-review', label: 'dsh-review' },
  { rel: '.', label: 'workspace' },
]

/** Состояние «есть из чего выбирать и всё загружено»: каталог, ветка, файлы. */
function loadedStates(overrides = {}) {
  return statesWith({
    1: {
      total: 2,
      added: 10,
      removed: 3,
      files: [
        { path: 'src/a.js', kind: 'modified', added: 5, removed: 1 },
        { path: 'b.js', kind: 'untracked', added: 1, removed: 0 },
      ],
    },
    11: PROJECT_CANDIDATES,
    12: '.publish/dsh-review',
    13: true,
    15: { ok: true, branch: 'main', ahead: 1, behind: 0 },
    ...overrides,
  })
}

test('страница: центрированный контейнер maxWidth 960 и адаптив 1280/1024/768/480', () => {
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
  // Четыре контрольные ширины: у каждой — свои правила, страница не вылезает.
  for (const width of [1024, 900, 768, 640, 480]) {
    assert.match(css, new RegExp(`@media \\(max-width: ${width}px\\)`), `нет правил для ${width} px`)
  }
  assert.match(css, /@media \(max-width: 480px\)\{[^}]*\.dshrv-page\{padding:14px 12px 24px/)
  assert.match(css, /@media \(max-width: 640px\)\{[^}]*\.dshrv-page\{padding:16px 14px 28px/)
  assert.match(css, /@media \(max-width: 768px\)\{[^}]*\.dshrv-page\{padding:18px 16px 32px/)
  assert.match(css, /@media \(max-width: 1024px\)\{[^}]*\.dshrv-page\{padding:22px 24px 38px/)
  // Карточка «Проект» — одна колонка: сетки auto-fit больше нет.
  assert.doesNotMatch(css, /dshrv-page-grid/, 'старая сетка «Проекта» не должна использоваться')
  assert.match(css, /\.dshrv-page-project\{display:flex;flex-direction:column;/)
})

test('шапка: иконка 52, заголовок 20/600, чип-кнопка 32 и «Обновить»', () => {
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

  const chip = chipByText(nodes, 't:statusIdle')
  assert.ok(chip, 'нет статус-чипа в шапке')
  const chipStyle = chip.props.style
  assert.equal(chipStyle.display, 'inline-flex')
  assert.equal(chipStyle.height, 32, 'чип в шапке — 32 px, как маленькая кнопка')
  assert.equal(chipStyle.borderRadius, 10)
  assert.equal(chipStyle.padding, '0 12px')
  assert.match(chipStyle.border, /^1px solid /)
  assert.equal(chipStyle.fontSize, 12.5)
  assert.equal(chipStyle.fontWeight, 600)
  assert.equal(chipStyle.gap, 6)
  assert.equal(chipStyle.whiteSpace, 'nowrap')
  assert.equal(chipStyle.color, 'var(--dsw-alias-label-secondary)', 'нейтральный тон — токен темы')
  assert.equal(chip.props.role, 'status')

  const dot = (chip.children ?? []).find((child) => child.props?.className === 'dshrv-page-chip-dot')
  assert.ok(dot, 'у чипа нет точки-индикатора')
  assert.equal(dot.props.style.width, 6)
  assert.equal(dot.props.style.height, 6)
  assert.equal(dot.props.style.borderRadius, '50%')

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

test('чипы-статусы шапки: 32 px и тон по смыслу (success / warn / error / neutral)', () => {
  const cases = [
    { states: {}, tone: 'neutral', label: 't:statusIdle' },
    { states: { 2: true }, tone: 'warn', label: 't:loading' },
    { states: { 1: { total: 2, added: 1, removed: 0, files: [] } }, tone: 'warn', label: 't:statusChanges: 2' },
    { states: { 1: { total: 0, added: 0, removed: 0, files: [] } }, tone: 'success', label: 't:statusClean' },
    { states: { 3: 'нет git' }, tone: 'error', label: 't:statusError' },
  ]
  for (const item of cases) {
    const { nodes } = renderDetail(statesWith(item.states))
    const chip = chipByText(nodes, item.label)
    assert.ok(chip, `нет чипа «${item.label}»`)
    assert.match(chip.props.className, new RegExp(`dshrv-page-chip-${item.tone}$`), `${item.label}: тон ${item.tone}`)
    assert.equal(chip.props.style.height, 32)
    if (item.tone !== 'neutral') {
      assert.match(chip.props.style.background, /^color-mix\(in srgb, ?var\(--dsw-alias-state-/, `${item.label}: мягкая заливка`)
      assert.match(chip.props.style.border, /^1px solid color-mix\(in srgb, ?var\(--dsw-alias-state-/)
    }
    const dot = (chip.children ?? []).find((child) => child.props?.className === 'dshrv-page-chip-dot')
    assert.ok(dot, `${item.label}: нет точки`)
    assert.equal(dot.props.style.width, 6)
  }
})

test('карточка «Проект»: колонка, подпись отдельным блоком, select на всю ширину', () => {
  const { nodes } = renderDetail(loadedStates())

  const project = nodes.find((node) => node.props?.className === 'dshrv-page-project')
  assert.ok(project, 'нет колонки «Проекта»')
  assert.equal(project.props.style.display, 'flex')
  assert.equal(project.props.style.flexDirection, 'column')
  assert.equal(project.props.style.minWidth, 0)
  assert.equal(project.props.style.gap, 12)

  const label = nodes.find((node) => node.props?.className === 'dshrv-page-project-field')
  assert.ok(label, 'нет блока подписи «Каталог»')
  assert.equal(label.type, 'label')
  assert.equal(label.props.style.display, 'flex')
  assert.equal(label.props.style.flexDirection, 'column', 'подпись и поле — колонкой, а не строкой')
  assert.equal(label.props.style.minWidth, 0)
  assert.equal(label.props.style.width, '100%')
  assert.equal(label.props.style.gap, 6)

  const [labelText, select] = label.children
  assert.equal(labelText.type, 'span')
  assert.equal(labelText.props.className, 'dshrv-page-project-label')
  assert.equal(textsOf(labelText).join(''), 't:projectDirLabel')
  assert.equal(labelText.props.style.whiteSpace, 'nowrap', 'подпись не переносится')
  assert.equal(labelText.props.style.overflowWrap, 'normal', 'короткое слово не рвётся посередине')
  assert.equal(labelText.props.style.wordBreak, 'normal')

  assert.equal(select.type, 'select', 'select — отдельный элемент после подписи')
  const selectStyle = select.props.style
  assert.equal(selectStyle.width, '100%', 'select на всю ширину')
  assert.equal(selectStyle.maxWidth, '100%')
  assert.equal(selectStyle.minWidth, 0)
  assert.equal(selectStyle.height, 34)
  assert.equal(selectStyle.boxSizing, 'border-box')
  assert.equal(select.props.value, '.publish/dsh-review')
  assert.equal((select.children ?? []).length, PROJECT_CANDIDATES.length, 'в списке все каталоги')

  // Порядок в колонке: подпись с полем → чип ветки → кнопки.
  const children = project.children
  assert.equal(children[0], label)
  assert.equal(typeof children[1].type, 'function', 'после поля идёт чип ветки')
  assert.equal(children[children.length - 1].props?.className, 'dshrv-page-actions')
  assert.ok(
    nodes.every((node) => node.props?.style?.display !== 'grid'),
    'колонка «Проекта» не должна быть сеткой',
  )
})

test('карточка «Проект»: чип ветки 36 и три кнопки 36/10 в один ряд', () => {
  const { nodes } = renderDetail(loadedStates())

  const branch = chipByText(nodes, 't:branchLinePrefix: main · 1↑/0↓')
  assert.ok(branch, 'нет чипа «Ветка: main · 1↑/0↓»')
  assert.match(branch.props.className, /chips?-info$|dshrv-page-chip-info$/)
  assert.equal(branch.props.style.height, 36, 'статус-блок в секции — 36 px, как кнопки')
  assert.equal(branch.props.style.borderRadius, 10)
  assert.equal(branch.props.style.alignSelf, 'flex-start', 'чип не растягивается на всю карточку')

  const actions = nodes.find((node) => node.props?.className === 'dshrv-page-actions')
  assert.ok(actions, 'нет строки действий «Проекта»')
  assert.equal(actions.props.style.display, 'flex')
  assert.equal(actions.props.style.flexWrap, 'wrap', 'кнопки переносятся')
  assert.equal(actions.props.style.gap, 8)
  assert.equal(actions.props.style.minWidth, 0)

  const buttons = (actions.children ?? []).filter((child) => child.type === 'button')
  assert.equal(buttons.length, 3, 'в «Проекте» ровно три кнопки в одном ряду')
  const labels = buttons.map((button) => textsOf(button).join(''))
  assert.deepEqual(labels, ['t:runTests', 't:commitPush', 't:createPr'])
  for (const button of buttons) {
    assert.equal(button.props.style.height, 36)
    assert.equal(button.props.style.borderRadius, 10)
    assert.equal(button.props.style.padding, '0 14px')
    assert.equal(button.props.style.whiteSpace, 'nowrap')
    assert.equal(button.props.style.width, undefined, 'ширина кнопки — по тексту')
    assert.equal(typeof button.props.onClick, 'function')
  }

  const css = pageCss(nodes)
  assert.match(css, /\.dshrv-page-actions\{[^}]*flex-wrap:wrap/)
  // На узком экране кнопки растягиваются: 640 px — по две в ряд, 480 px — по одной.
  assert.match(css, /@media \(max-width: 640px\)\{.*\.dshrv-page-actions \.dshrv-page-button\{flex:1 1 calc\(50% - 4px\)/)
  assert.match(css, /@media \(max-width: 480px\)\{.*\.dshrv-page-actions \.dshrv-page-button\{flex:1 1 100%/)
})

test('чипы-кнопки: 32 в шапке, 36 в секциях, радиус 10, padding 0 12, шрифт 600 12.5', () => {
  const { nodes } = renderDetail(loadedStates())
  const list = chips(nodes)
  assert.equal(list.length, 5, 'чипы: шапка, ветка, сводка, два вида файлов')

  const header = list[0]
  assert.equal(header.props.style.height, 32)
  for (const chip of list.slice(1)) {
    assert.equal(chip.props.style.height, 36, 'чипы внутри секций — 36 px')
  }

  for (const chip of list) {
    const style = chip.props.style
    assert.equal(style.display, 'inline-flex')
    assert.equal(style.alignItems, 'center')
    assert.equal(style.gap, 6)
    assert.equal(style.borderRadius, 10)
    assert.equal(style.padding, '0 12px')
    assert.match(style.border, /^1px solid /)
    assert.equal(style.fontSize, 12.5)
    assert.equal(style.fontWeight, 600)
    assert.equal(style.lineHeight, 1)
    assert.equal(style.whiteSpace, 'nowrap')
    assert.equal(style.boxSizing, 'border-box')
    assert.equal(style.maxWidth, '100%')
    const dot = (chip.children ?? []).find((child) => child.props?.className === 'dshrv-page-chip-dot')
    assert.ok(dot, 'у каждого чипа есть точка-индикатор слева')
    assert.equal(dot.props.style.width, 6)
    assert.equal(dot.props.style.height, 6)
    const text = (chip.children ?? [])[1]
    assert.equal(text.props.className, 'dshrv-page-chip-text')
    assert.equal(text.props.style.overflow, 'hidden', 'длинная подпись чипа обрезается, а не ломает строку')
  }

  // Цвета по смыслу: сводка изменений — warn, успешный файл — success.
  assert.match(chipByText(nodes, '2 t:filesCount · +10 / −3').props.className, /dshrv-page-chip-warn$/)
  const css = pageCss(nodes)
  assert.match(css, /\.dshrv-page-chip\{[^}]*overflow-wrap:normal/)
  assert.doesNotMatch(css, /border-radius:999/)
})

test('чипы вида файла: подпись и тон по смыслу', () => {
  const { nodes } = renderDetail(statesWith({
    1: {
      total: 6,
      added: 10,
      removed: 3,
      files: [
        { path: 'a.js', kind: 'modified', added: 1, removed: 0 },
        { path: 'b.js', kind: 'untracked', added: 1, removed: 0 },
        { path: 'c.js', kind: 'conflict', added: 0, removed: 0 },
        { path: 'd.js', kind: 'staged', added: 0, removed: 0 },
        { path: 'e.js', kind: 'deleted', added: 0, removed: 1 },
        { path: 'f.js', kind: 'renamed', added: 0, removed: 0 },
      ],
    },
    13: true,
  }))
  const expected = [
    ['t:modified', 'warn'],
    ['t:untracked', 'success'],
    ['t:conflict', 'error'],
    ['t:staged', 'info'],
    ['t:deleted', 'error'],
    ['t:renamed', 'info'],
  ]
  for (const [label, tone] of expected) {
    const chip = chipByText(nodes, label)
    assert.ok(chip, `нет чипа «${label}»`)
    assert.match(chip.props.className, new RegExp(`dshrv-page-chip-${tone}$`), `${label}: тон ${tone}`)
    assert.equal(chip.props.style.height, 36)
    assert.equal(chip.props.style.borderRadius, 10)
  }
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

test('изменения: чип-сводка 36, строки списка и empty state', () => {
  const withFiles = renderDetail(loadedStates())
  const summary = chipByText(withFiles.nodes, '2 t:filesCount · +10 / −3')
  assert.ok(summary, 'нет чипа-сводки в секции «Изменения»')
  assert.equal(summary.props.style.height, 36)
  assert.match(summary.props.className, /dshrv-page-chip-warn$/)

  const rows = withFiles.nodes.filter((node) => node.props?.className === 'dshrv-page-file')
  assert.equal(rows.length, 2, 'строки списка файлов не отрисованы')
  assert.equal(typeof rows[0].props.onClick, 'function')
  assert.ok(withFiles.texts.includes('src/a.js'))
  assert.ok(withFiles.texts.includes('b.js'))
  assert.ok(withFiles.texts.includes('t:modified'))
  assert.ok(withFiles.texts.includes('t:untracked'))

  const clean = renderDetail(statesWith({
    1: { total: 0, added: 0, removed: 0, files: [] },
    13: true,
  }))
  const cleanChip = chipByText(clean.nodes, 't:statusClean')
  assert.ok(cleanChip, 'чип не показывает «Чисто»')
  assert.match(cleanChip.props.className, /dshrv-page-chip-success$/)
  const cleanSummary = chipByText(clean.nodes, '0 t:filesCount · +0 / −0')
  assert.ok(cleanSummary, 'нет сводки «Чисто»')
  assert.match(cleanSummary.props.className, /dshrv-page-chip-success$/)
  assert.ok(clean.texts.includes('t:empty'), 'нет текста пустого состояния')
  assert.ok(clean.texts.includes('t:emptyHint'), 'нет подсказки пустого состояния')
  const emptyIcon = clean.nodes.find((node) => node.props?.style?.fontSize === 32)
  assert.ok(emptyIcon, 'нет иконки пустого состояния')
})

test('цвета: только токены темы, жёстких hex и белого текста нет', () => {
  const { nodes } = renderDetail(loadedStates())
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
  for (const key of ['sectionProject', 'sectionChanges', 'statusIdle', 'statusClean', 'statusChanges', 'statusError', 'emptyHint', 'filesCount', 'branchLinePrefix', 'projectDirLabel']) {
    assert.ok(key in dictionaries.en, `en: нет ключа ${key}`)
    assert.ok(key in dictionaries.ru, `ru: нет ключа ${key}`)
  }
})
