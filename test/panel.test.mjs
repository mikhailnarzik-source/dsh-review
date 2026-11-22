/**
 * Панель в левом меню (`main` + `sidebar.panellist`).
 *
 * Проверяется контракт общий для плагинов: main-панель регистрируется всегда и
 * рендерит существующие настройки плагина в центрированной странице с шапкой
 * (эмодзи, название, подзаголовок), без блоков плагин-менеджера; строка левой
 * панели (`sidebar.panellist`, id `plugin-review`) — только когда панель
 * закреплена в состоянии «Оформления интерфейса»; событие
 * `dsh-polish:panels-changed` перерегистрирует строку.
 *
 * `client.js` исполняется в vm с поддельным `window.__ModuleLoader__`,
 * минимальным React и поддельным localStorage — браузер не нужен.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const SOURCE = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const PLUGIN = 'dsh-review'
const PANEL_ID = 'plugin-review'
const PANEL_ORDER = 22
const PANEL_STATE_ID = 'review'
const PANEL_STATE_KEY = 'dsh-polish:panel-visibility'
const PANELS_CHANGED_EVENT = 'dsh-polish:panels-changed'

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

/** Хранилище настроек видимости панелей: одна строка JSON, как у dsh-polish. */
function makeStorage(initial = null) {
  let raw = initial
  return {
    getItem(key) { return key === PANEL_STATE_KEY ? raw : null },
    setItem(key, value) { if (key === PANEL_STATE_KEY) raw = value },
    removeItem(key) { if (key === PANEL_STATE_KEY) raw = null },
    set(value) { raw = value },
  }
}

/** Состояние «все закреплены» / «ничего не закреплено» одним вызовом. */
function panelState(ids) {
  return JSON.stringify({ visible: ids, pinned: ids })
}

/** Загрузить client.js в vm: вернуть фабрику и поддельное окно. */
function loadClient(storage = makeStorage()) {
  let registration
  const listeners = []
  const sandbox = {
    window: {
      __ModuleLoader__: { load(options) { registration = options } },
      addEventListener(type, listener) { listeners.push({ type, listener }) },
      removeEventListener() {},
    },
    localStorage: storage,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
  }
  vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
  assert.ok(registration !== undefined, 'client.js не вызвал window.__ModuleLoader__.load')
  return { registration, listeners, storage }
}

/** Хост-контекст: locale, слоты с настоящим disposer и подсчётом инъекций. */
function makeContext() {
  const injected = []
  const slots = []
  const locales = []
  const ctx = {
    locale: {
      register(namespace, dictionaries) { locales.push({ namespace, dictionaries }) },
      bind() { return (key) => `t:${key}` },
    },
    slots: {
      inject(name, callback) {
        injected.push(name)
        const dispose = callback()
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
      register(options, component) {
        const record = { options, component }
        slots.push(record)
        return () => {
          const index = slots.indexOf(record)
          if (index >= 0) slots.splice(index, 1)
        }
      },
    },
  }
  return { ctx, injected, slots, locales }
}

/** Применить плагин: фабрика + apply на поддельном контексте. */
function applyPlugin(storage) {
  const { registration, listeners } = loadClient(storage)
  const module = registration.factory((name) => {
    if (name === 'react') return makeReact()
    throw new Error(`неожиданный require: ${name}`)
  })
  const host = makeContext()
  module.apply(host.ctx)
  return { ...host, module, listeners }
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

/** Регистрации строки левой панели для нашей панели. */
function sidebarRows(slots) {
  return slots.filter(
    (item) => item.options.name === 'sidebar.panellist' && item.options.id === PANEL_ID,
  )
}

test('main-панель: ключ plugin-review, шапка и настройки без блоков плагин-менеджера', () => {
  const { slots, injected } = applyPlugin()

  assert.ok(injected.includes('main'), 'слот main объявлен через slots.inject')
  const main = slots.find((item) => item.options.name === 'main' && item.options.key === PANEL_ID)
  assert.ok(main, 'main-панель с ключом plugin-review зарегистрирована')
  assert.equal(typeof main.component, 'function')

  const tree = survey(main.component({}))
  const page = tree.nodes.find((node) => node.props?.style?.maxWidth === 960)
  assert.ok(page, 'нет центрированного контейнера maxWidth 960')
  assert.equal(page.props.style.width, '100%')
  assert.equal(page.props.style.margin, '0 auto')
  assert.equal(page.props.style.padding, '24px 28px 40px')
  assert.equal(page.props.style.boxSizing, 'border-box')
  assert.equal(page.props.style.flexDirection, 'column')
  assert.equal(page.props['data-dsh-panel'], PANEL_ID)

  // Шапка: эмодзи-иконка, название плагина и короткий подзаголовок — ровно одна.
  const headers = tree.nodes.filter((node) => node.type === 'h1')
  assert.equal(headers.length, 1, 'шапка панели не должна дублироваться')
  assert.deepEqual(textsOf(headers[0]), ['t:title'])
  assert.ok(
    tree.nodes.some((node) => (node.children ?? []).includes('📝')),
    'в шапке нет эмодзи-иконки плагина',
  )
  assert.ok(tree.texts.includes('t:panelSubtitle'), 'нет короткого подзаголовка')
  const icon = tree.nodes.find((node) => node.props?.style?.width === 52 && node.props?.style?.height === 52)
  assert.ok(icon, 'нет квадрата-иконки 52×52')

  // Настройки плагина на месте: те же карточки-секции, что в plugins.detail.section.
  assert.ok(tree.texts.includes('t:sectionProject'), 'нет секции «Проект»')
  assert.ok(tree.texts.includes('t:sectionChanges'), 'нет секции «Изменения»')
  assert.ok(
    tree.nodes.some((node) => node.props?.className === 'dshrv-page-grid'),
    'нет сетки настроек',
  )

  // Никаких блоков страницы плагин-менеджера: описания и источника.
  const allText = tree.texts.join(' ')
  for (const word of ['Описание', 'Источник', 'Description', 'Source']) {
    assert.equal(allText.includes(word), false, `на панели не должно быть «${word}»`)
  }
})

test('sidebar: регистрируется только когда панель закреплена', () => {
  // По умолчанию (состояния ещё нет) все панели закреплены — строка есть.
  const fresh = applyPlugin(makeStorage())
  assert.equal(sidebarRows(fresh.slots).length, 1, 'без сохранённого состояния строка есть')
  const rail = sidebarRows(fresh.slots)[0]
  assert.equal(rail.options.id, PANEL_ID)
  assert.equal(rail.options.order, PANEL_ORDER)
  assert.equal(rail.options.locale, 'dshReview')
  assert.equal(typeof rail.options.label, 'function')
  assert.equal(rail.options.label(), 't:title')
  assert.equal(typeof rail.component, 'function')
  const icon = rail.component({ size: 18 })
  assert.equal(icon.type, 'span')
  assert.equal(icon.children[0], '📝')
  assert.equal(icon.props.style.fontSize, 17)

  // Панель откреплена — main остаётся, строки нет.
  const unpinned = applyPlugin(makeStorage(panelState([])))
  assert.equal(sidebarRows(unpinned.slots).length, 0, 'откреплённая панель не попадает в рельс')
  assert.ok(
    unpinned.slots.some((item) => item.options.name === 'main' && item.options.key === PANEL_ID),
    'main-панель регистрируется всегда',
  )

  // Закреплена по id плагина и по id панели (оба формата состояния).
  for (const ids of [[PANEL_STATE_ID], [PANEL_ID]]) {
    const pinned = applyPlugin(makeStorage(panelState(ids)))
    assert.equal(sidebarRows(pinned.slots).length, 1, `строка для pinned=${ids.join(',')}`)
  }
})

test('событие dsh-polish:panels-changed перерегистрирует строку', () => {
  const storage = makeStorage(panelState([]))
  const { slots, listeners } = applyPlugin(storage)
  assert.equal(sidebarRows(slots).length, 0, 'старт без закрепления')

  const changed = listeners.filter((item) => item.type === PANELS_CHANGED_EVENT)
  assert.equal(changed.length, 1, 'подписка на событие панелей одна')
  const fire = () => changed[0].listener()

  // Закрепили: строка появляется один раз.
  storage.set(panelState([PANEL_STATE_ID]))
  fire()
  assert.equal(sidebarRows(slots).length, 1, 'после закрепления строка зарегистрирована')

  // Повторное событие без изменений не плодит дубли.
  fire()
  assert.equal(sidebarRows(slots).length, 1, 'повторное событие не создаёт дубль')

  // Открепили: строка снимается, main остаётся.
  storage.set(panelState([]))
  fire()
  assert.equal(sidebarRows(slots).length, 0, 'после открепления строка снята')
  assert.ok(
    slots.some((item) => item.options.name === 'main' && item.options.key === PANEL_ID),
    'main-панель не снимается',
  )

  // Вернули: снова одна строка.
  storage.set(panelState([PANEL_STATE_ID]))
  fire()
  assert.equal(sidebarRows(slots).length, 1, 'после повторного закрепления строка вернулась')
})

test('plugins.detail.section не сломан: карточка страницы плагина прежняя', () => {
  const { slots } = applyPlugin()
  const detail = slots.find((item) => item.options.name === 'plugins.detail.section')
  assert.ok(detail, 'секция plugins.detail.section зарегистрирована')
  assert.equal(detail.options.id, 'dsh-review-detail')
  assert.equal(detail.options.locale, 'dshReview')

  const tree = survey(detail.component({ subject: { kind: 'bundle', pkg: { name: PLUGIN } } }))
  assert.ok(
    tree.nodes.some((node) => node.props?.className === 'dshrv-page'),
    'на странице плагина осталась своя страница',
  )
  assert.ok(tree.texts.includes('t:heading'), 'шапка страницы плагина на месте')
  const foreign = survey(detail.component({ subject: { kind: 'bundle', pkg: { name: 'dsh-other' } } }))
  assert.equal(foreign.nodes.length, 0, 'чужая страница плагина не рисуется')
})
