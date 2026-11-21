/**
 * Browser half of `dsh-review`.
 *
 * Карточка в списке плагинов: свёрнута по умолчанию, внутри — файлы с
 * незакоммиченными изменениями, построчный diff и откат одного файла.
 * Данные приходят с host-части через POST-маршруты.
 */
window.__ModuleLoader__.load({
  id: 'dsh-review',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    const NS = 'dshReview'
    const STATE_PATH = '/api/dsh-review/state'
    const DIFF_PATH = '/api/dsh-review/diff'
    const REVERT_PATH = '/api/dsh-review/revert'
    const INIT_PATH = '/api/dsh-review/init'

    const en = {
      title: 'Changes review',
      heading: 'Changes review',
      hint: 'Uncommitted files of this project: line diff and reverting a single file.',
      open: 'Open',
      collapse: 'Collapse',
      refresh: 'Refresh',
      empty: 'No uncommitted changes.',
      staged: 'staged',
      untracked: 'new',
      modified: 'modified',
      deleted: 'deleted',
      renamed: 'renamed',
      conflict: 'conflict',
      revert: 'Revert',
      confirmRevert: 'Revert this file?',
      yes: 'Yes, revert',
      no: 'Cancel',
      loading: 'Loading…',
      failed: 'Could not read changes',
      lines: 'lines',
      noGit: 'This project is not a git repository yet.',
      initGit: 'Create git repository',
      initConfirm: 'Create a repository and make the first commit?',
      initDone: 'Repository created',
    }
    const ru = {
      title: 'Ревью изменений',
      heading: 'Ревью изменений',
      hint: 'Незакоммиченные файлы проекта: построчный diff и откат одного файла.',
      open: 'Открыть',
      collapse: 'Свернуть',
      refresh: 'Обновить',
      empty: 'Незакоммиченных изменений нет.',
      staged: 'в индексе',
      untracked: 'новый',
      modified: 'изменён',
      deleted: 'удалён',
      renamed: 'переименован',
      conflict: 'конфликт',
      revert: 'Откатить',
      confirmRevert: 'Откатить этот файл?',
      yes: 'Да, откатить',
      no: 'Отмена',
      loading: 'Загрузка…',
      failed: 'Не удалось получить изменения',
      lines: 'строк',
      noGit: 'Проект пока не под git.',
      initGit: 'Создать репозиторий git',
      initConfirm: 'Создать репозиторий и сделать первый коммит?',
      initDone: 'Репозиторий создан',
    }

    const KIND_LABEL = {
      staged: 'staged',
      untracked: 'untracked',
      modified: 'modified',
      deleted: 'deleted',
      renamed: 'renamed',
      conflict: 'conflict',
    }

    const S = {
      card: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, maxWidth: 720 },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      file: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.22)',
        background: 'rgba(128,128,128,0.05)',
        cursor: 'pointer',
        fontSize: 12.5,
      },
      button: {
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'rgba(128,128,128,0.12)',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
      },
      danger: {
        padding: '4px 10px',
        borderRadius: 8,
        border: '1px solid rgba(209,36,47,0.55)',
        background: 'rgba(209,36,47,0.15)',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      },
      diff: {
        margin: 0,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid rgba(128,128,128,0.28)',
        background: 'rgba(128,128,128,0.07)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5,
        lineHeight: 1.45,
        maxHeight: 360,
        overflow: 'auto',
      },
    }

    let translate = (key) => key

    async function post(path, payload) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

        /** Рамка карточки: тот же вид, что у остальных наших плагинов. */
    function CardFrame({ children }) {
      return h(
        'div',
        {
          style: {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 44px 12px 12px',
            borderRadius: 10,
            border: '1px solid rgba(128,128,128,0.28)',
            background: 'rgba(128,128,128,0.07)',
            boxSizing: 'border-box',
          },
        },
        children,
      )
    }
    /** Кнопка-шеврон: развернуть и свернуть. Виден в любой теме (currentColor). */
    function ToggleIcon({ open, onClick }) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          title: open ? 'Свернуть' : 'Открыть',
          'aria-label': open ? 'Свернуть' : 'Открыть',
          'aria-expanded': open ? 'true' : 'false',
          style: {
            position: 'absolute',
            // Свёрнутая карточка: по центру по вертикали. Развёрнутая: в углу.
            top: open ? 8 : '50%',
            transform: open ? 'none' : 'translateY(-50%)',
            right: 8,
            zIndex: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,0.32)',
            background: 'rgba(128,128,128,0.1)',
            color: 'inherit',
            cursor: 'pointer',
          },
        },
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            'aria-hidden': 'true',
            focusable: 'false',
            style: { transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' },
          },
          h('path', {
            d: 'M6 15l6-6 6 6',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      )
    }


function ChangesCard() {
      const t = (key) => translate(key)
      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [diff, setDiff] = React.useState([])
      const [confirm, setConfirm] = React.useState('')
      const [notice, setNotice] = React.useState('')

      const load = React.useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const result = await post(STATE_PATH, {})
          if (result?.ok === true) setState(result)
          else setError(String(result?.message ?? t('failed')))
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        if (!open) return
        void load()
      }, [open, load])

      const showDiff = async (file) => {
        setSelected(file.path)
        setDiff([])
        try {
          const result = await post(DIFF_PATH, { path: file.path })
          if (result?.ok === true) setDiff(result.lines ?? [])
          else setError(String(result?.message ?? ''))
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }

      const revert = async (file) => {
        try {
          const result = await post(REVERT_PATH, {
            path: file.path,
            untracked: file.kind === 'untracked',
            confirm: true,
          })
          if (result?.ok === true) {
            setConfirm('')
            setSelected(null)
            setDiff([])
            await load()
          } else setError(String(result?.message ?? ''))
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }

      if (!open) {
        return h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.22)',
              background: 'rgba(128,128,128,0.05)',
              fontSize: 13,
            },
          },
          h('span', { style: { fontWeight: 600 } }, t('heading')),
          h('span', { style: { fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('hint')),
          h(ToggleIcon, { open: false, onClick: () => setOpen(true) }),
        )
      }

      const files = state?.files ?? []

      const noticeLine = notice !== '' ? h('span', { style: { fontSize: 12, opacity: 0.75 } }, notice) : null

      return h(
      'div',
      { style: S.card },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 600 } }, t('heading')),
        h(ToggleIcon, { open: true, onClick: () => setOpen(false) }),
      ),
        h(
          'div',
          { style: S.row },
          h('button', { style: S.button, onClick: () => void load() }, loading ? t('loading') : t('refresh')),
          state !== null
            ? h(
                'span',
                { style: { fontSize: 12, opacity: 0.7 } },
                `${state.total} · +${state.added} / −${state.removed}`,
              )
            : null,
        ),
        noticeLine,
        error !== ''
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h('span', { style: { fontSize: 12, color: '#d1242f' } }, error),
              h('span', { style: { fontSize: 12, opacity: 0.7 } }, t('noGit')),
              confirm === '__init__'
                ? h(
                    'div',
                    { style: S.row },
                    h('span', { style: { fontSize: 12 } }, t('initConfirm')),
                    h(
                      'button',
                      {
                        style: S.danger,
                        onClick: async () => {
                          try {
                            const result = await post(INIT_PATH, { confirm: true })
                            if (result?.ok === true) {
                              setError('')
                              setConfirm('')
                              setNotice(t('initDone'))
                              await load()
                            } else setError(String(result?.message ?? ''))
                          } catch (cause) {
                            setError(String(cause?.message ?? cause))
                          }
                        },
                      },
                      t('yes'),
                    ),
                    h('button', { style: S.button, onClick: () => setConfirm('') }, t('no')),
                  )
                : h('button', { style: S.button, onClick: () => setConfirm('__init__') }, t('initGit')),
            )
          : null,
        state !== null && files.length === 0 ? h('span', { style: { fontSize: 12, opacity: 0.7 } }, t('empty')) : null,
        ...files.map((file) =>
          h(
            'div',
            {
              key: file.path,
              style: { display: 'flex', flexDirection: 'column', gap: 6 },
            },
            h(
              'div',
              {
                style: { ...S.file, borderColor: selected === file.path ? 'rgba(80,120,200,0.55)' : 'rgba(128,128,128,0.22)' },
                onClick: () => void showDiff(file),
              },
              h(
                'span',
                {
                  style: {
                    fontSize: 10.5,
                    padding: '1px 6px',
                    borderRadius: 6,
                    background: 'rgba(128,128,128,0.18)',
                    flex: '0 0 auto',
                  },
                },
                t(KIND_LABEL[file.kind] ?? 'modified'),
              ),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.path),
              h(
                'span',
                { style: { marginLeft: 'auto', fontSize: 11.5, opacity: 0.75, flex: '0 0 auto' } },
                `+${file.added} / −${file.removed}`,
              ),
            ),
            selected === file.path
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  h(
                    'pre',
                    { style: S.diff },
                    ...diff.map((entry) =>
                      h(
                        'div',
                        {
                          key: entry.number,
                          style: {
                            color:
                              entry.kind === 'add'
                                ? '#2f9e44'
                                : entry.kind === 'del'
                                  ? '#d1242f'
                                  : entry.kind === 'hunk'
                                    ? 'rgba(120,150,220,0.95)'
                                    : 'inherit',
                            opacity: entry.kind === 'meta' ? 0.6 : 1,
                          },
                        },
                        entry.line === '' ? ' ' : entry.line,
                      ),
                    ),
                  ),
                  confirm === file.path
                    ? h(
                        'div',
                        { style: S.row },
                        h('span', { style: { fontSize: 12 } }, t('confirmRevert')),
                        h('button', { style: S.danger, onClick: () => void revert(file) }, t('yes')),
                        h('button', { style: S.button, onClick: () => setConfirm('') }, t('no')),
                      )
                    : h(
                        'div',
                        { style: S.row },
                        h('button', { style: S.danger, onClick: () => setConfirm(file.path) }, t('revert')),
                      ),
                )
              : null,
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.locale.register(NS, { en, ru })
      translate = ctx.locale.bind(NS)

      try {
        ctx.slots.inject('plugins.item', () =>
          ctx.slots.register(
            {
              name: 'plugins.item',
              id: 'dsh-review',
              order: 59,
              label: () => translate('title'),
              locale: NS,
            },
            () => h(CardFrame, null, h(ChangesCard)),
          ),
        )
      } catch (error) {
        console.error('[dsh-review] карточка недоступна:', error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.NS = NS
    return module.exports
  },
})
