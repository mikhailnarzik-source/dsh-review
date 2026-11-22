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
    const PROJECTS_PATH = '/api/dsh-review/projects'
    const TESTS_PATH = '/api/dsh-review/tests-run'
    const COMMIT_PATH = '/api/dsh-review/git-commit'
    const PUSH_PATH = '/api/dsh-review/git-push'

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
      runTests: 'Run tests',
      commitPush: 'Commit and push',
      working: 'Working…',
      confirmCommitPush: 'Commit and push these changes?',
      filesCount: 'files',
      commitMessage: 'Commit message',
      confirm: 'Confirm',
      cancel: 'Cancel',
      messageRequired: 'Enter a commit message.',
      noChanges: 'Nothing to commit.',
      testsPassed: 'Tests passed',
      testsFailed: 'Tests failed',
      testsTimeout: 'Tests timed out',
      commitCreated: 'Commit',
      commitFailed: 'Commit failed',
      pushed: 'Pushed',
      pushFailed: 'Push failed',
      remoteLabel: 'remote',
      branchLabel: 'branch',
      codeLabel: 'code',
      durationLabel: 'duration',
      outputTruncated: 'Output truncated: head and tail shown.',
      ms: 'ms',
      sec: 's',
      projectDirLabel: 'Directory',
      workspaceRoot: 'workspace root',
      noProjects: 'No package.json with scripts.test, gradlew or *.sln/*.csproj found.',
      needChooseProject: 'Several test directories found — choose one in the list.',
      projectDirResult: 'directory',
      projectsFailed: 'Could not list test directories',
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
      runTests: 'Прогнать тесты',
      commitPush: 'Закоммитить и запушить',
      working: 'Выполняется…',
      confirmCommitPush: 'Закоммитить и запушить эти изменения?',
      filesCount: 'файлов',
      commitMessage: 'Сообщение коммита',
      confirm: 'Подтвердить',
      cancel: 'Отмена',
      messageRequired: 'Введите сообщение коммита.',
      noChanges: 'Нет изменений для коммита.',
      testsPassed: 'Тесты прошли',
      testsFailed: 'Тесты упали',
      testsTimeout: 'Тесты не уложились в таймаут',
      commitCreated: 'Коммит',
      commitFailed: 'Коммит не создан',
      pushed: 'Push выполнен',
      pushFailed: 'Push не выполнен',
      remoteLabel: 'remote',
      branchLabel: 'ветка',
      codeLabel: 'код',
      durationLabel: 'длительность',
      outputTruncated: 'Вывод обрезан: показаны начало и хвост.',
      ms: 'мс',
      sec: 'с',
      projectDirLabel: 'Каталог',
      workspaceRoot: 'корень воркспейса',
      noProjects: 'Не найден package.json с scripts.test, gradlew или *.sln/*.csproj.',
      needChooseProject: 'Несколько каталогов с тестами — выберите один в списке.',
      projectDirResult: 'каталог',
      projectsFailed: 'Не удалось получить список каталогов',
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
      panel: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.28)',
        background: 'rgba(128,128,128,0.06)',
      },
      input: {
        flex: '1 1 260px',
        minWidth: 200,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12.5,
      },
      muted: { fontSize: 12, opacity: 0.72 },
      select: {
        maxWidth: 340,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12.5,
      },
      fileName: {
        margin: 0,
        padding: '6px 8px',
        borderRadius: 8,
        background: 'rgba(128,128,128,0.08)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5,
        lineHeight: 1.4,
        maxHeight: 132,
        overflow: 'auto',
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
      const [action, setAction] = React.useState('')
      const [actionResult, setActionResult] = React.useState(null)
      const [pending, setPending] = React.useState(null)
      const [projects, setProjects] = React.useState([])
      const [selectedDir, setSelectedDir] = React.useState('')
      const [projectsReady, setProjectsReady] = React.useState(false)
      const [projectsError, setProjectsError] = React.useState('')

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

      // Список каталогов с тестами: заполняется при монтировании и по «Обновить».
      const loadProjects = React.useCallback(async () => {
        try {
          const data = await post(PROJECTS_PATH, {})
          const candidates = data?.ok === true && Array.isArray(data.candidates) ? data.candidates : []
          setProjects(candidates)
          setProjectsError(data?.ok === true ? '' : String(data?.message ?? t('projectsFailed')))
          setSelectedDir((previous) => {
            if (candidates.some(candidate => candidate.rel === previous)) return previous
            return candidates[0]?.rel ?? ''
          })
        } catch (cause) {
          setProjectsError(String(cause?.message ?? cause))
        } finally {
          setProjectsReady(true)
        }
      }, [])

      React.useEffect(() => {
        void loadProjects()
      }, [loadProjects])

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

      const formatDuration = (durationMs) => {
        const ms = Number(durationMs)
        if (!Number.isFinite(ms) || ms < 0) return '—'
        if (ms < 1000) return `${Math.round(ms)} ${t('ms')}`
        return `${(ms / 1000).toFixed(1)} ${t('sec')}`
      }

      const dirLabel = (dir) => {
        if (typeof dir !== 'string' || dir === '') return '—'
        return dir === '.' ? t('workspaceRoot') : dir
      }

      // «Прогнать тесты»: маршрут сам определяет команду и обрезает вывод.
      const runTestsAction = async () => {
        if (action !== '') return
        setAction('tests')
        setActionResult(null)
        setNotice('')
        try {
          const payload = selectedDir !== '' ? { dir: selectedDir } : {}
          const data = await post(TESTS_PATH, payload)
          if (data?.needsChoice === true) {
            const candidates = Array.isArray(data.candidates) ? data.candidates : []
            if (candidates.length > 0) {
              setProjects(candidates)
              setSelectedDir((previous) => {
                if (candidates.some(candidate => candidate.rel === previous)) return previous
                return candidates[0].rel
              })
            }
            setActionResult({
              ok: false,
              title: t('needChooseProject'),
              details: candidates.map(candidate => `${candidate.label} — ${candidate.rel}`),
              output: '',
              truncated: false,
            })
            return
          }
          if (typeof data?.command !== 'string') {
            setActionResult({
              ok: false,
              title: String(data?.message ?? t('failed')),
              details: [],
              output: '',
              truncated: false,
            })
            return
          }
          const ok = data?.ok === true
          const title = ok
            ? t('testsPassed')
            : data?.timedOut === true
              ? t('testsTimeout')
              : t('testsFailed')
          const counts = data?.passed !== null || data?.failed !== null
            ? `passed: ${data?.passed ?? '—'}, failed: ${data?.failed ?? '—'}`
            : ''
          setActionResult({
            ok,
            title,
            details: [
              `${t('projectDirResult')}: ${dirLabel(data?.dir)}`,
              `${data?.command ?? '—'}`,
              `${t('codeLabel')}: ${data?.exitCode ?? '—'}; ${t('durationLabel')}: ${formatDuration(data?.durationMs)}${counts !== '' ? `; ${counts}` : ''}`,
            ],
            output: typeof data?.output === 'string' ? data.output : '',
            truncated: data?.truncated === true,
          })
        } catch (cause) {
          setActionResult({ ok: false, title: String(cause?.message ?? cause), details: [], output: '', truncated: false })
        } finally {
          setAction('')
        }
      }

      // Шаг 1 commit+push: свежий список файлов и обязательное подтверждение.
      const beginCommitAndPush = async () => {
        if (action !== '') return
        setAction('prepare')
        setActionResult(null)
        setNotice('')
        try {
          const snapshot = await post(STATE_PATH, {})
          if (snapshot?.ok !== true) {
            setActionResult({ ok: false, title: String(snapshot?.message ?? t('failed')), details: [], output: '', truncated: false })
            return
          }
          setState(snapshot)
          const paths = (snapshot.files ?? []).map(file => file.path)
          if (paths.length === 0) {
            setNotice(t('noChanges'))
            return
          }
          setPending({ files: paths, message: '' })
        } catch (cause) {
          setActionResult({ ok: false, title: String(cause?.message ?? cause), details: [], output: '', truncated: false })
        } finally {
          setAction('')
        }
      }

      // Шаг 2: пользователь подтвердил список и ввёл сообщение — commit, затем push.
      const submitCommitAndPush = async () => {
        if (pending === null || action !== '') return
        const message = pending.message.trim()
        if (message === '') {
          setNotice(t('messageRequired'))
          return
        }
        setAction('commit')
        setNotice('')
        setActionResult(null)
        try {
          const commit = await post(COMMIT_PATH, { message, paths: 'all', confirm: true })
          if (commit?.ok !== true) {
            setActionResult({
              ok: false,
              title: String(commit?.message ?? t('commitFailed')),
              details: Array.isArray(commit?.files) && commit.files.length > 0
                ? [`${commit.files.length} ${t('filesCount')}: ${commit.files.slice(0, 10).join(', ')}`]
                : [],
              output: typeof commit?.output === 'string' ? commit.output : '',
              truncated: false,
            })
            await load()
            return
          }
          const push = await post(PUSH_PATH, { confirm: true })
          const ok = push?.ok === true
          setActionResult({
            ok,
            title: ok ? t('pushed') : `${t('commitCreated')} ✓ / ${t('pushFailed')}`,
            details: [
              `${t('commitCreated')}: ${commit?.commit ?? '—'}; ${t('filesCount')}: ${Array.isArray(commit?.files) ? commit.files.length : 0}`,
              `${t('remoteLabel')}: ${push?.remote ?? '—'}; ${t('branchLabel')}: ${push?.branch ?? '—'}; ${t('codeLabel')}: ${push?.exitCode ?? '—'}`,
              ...ok ? [] : [String(push?.message ?? '')],
            ],
            output: [commit?.output, push?.output].filter(part => typeof part === 'string' && part !== '').join('\n'),
            truncated: false,
          })
          setPending(null)
          await load()
        } catch (cause) {
          setActionResult({ ok: false, title: String(cause?.message ?? cause), details: [], output: '', truncated: false })
          await load()
        } finally {
          setAction('')
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

      const busy = action !== ''
      const actionButtonStyle = { ...S.button, opacity: busy ? 0.55 : 1, cursor: busy ? 'default' : 'pointer' }
      const noProjects = projectsReady && projects.length === 0 && projectsError === ''
      const canRunTests = !busy && !noProjects
      const projectSelect = projects.length > 0
        ? h(
            'label',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } },
            h('span', { style: { opacity: 0.72 } }, t('projectDirLabel')),
            h(
              'select',
              {
                style: S.select,
                value: selectedDir,
                disabled: busy,
                onChange: (event) => setSelectedDir(event.target.value),
              },
              ...projects.map(candidate => h(
                'option',
                { key: candidate.rel, value: candidate.rel },
                `${candidate.label} — ${candidate.rel === '.' ? t('workspaceRoot') : candidate.rel}`,
              )),
            ),
          )
        : null
      const projectsHint = noProjects
        ? h('span', { style: { fontSize: 12, opacity: 0.72 } }, t('noProjects'))
        : null
      const projectsErrorLine = projectsError !== ''
        ? h('span', { style: { fontSize: 12, color: '#d1242f' } }, projectsError)
        : null
      const actionsRow = h(
        'div',
        { style: S.row },
        projectSelect,
        h(
          'button',
          { style: { ...actionButtonStyle, opacity: canRunTests ? actionButtonStyle.opacity : 0.55 }, disabled: !canRunTests, onClick: () => void runTestsAction() },
          action === 'tests' ? t('working') : t('runTests'),
        ),
        h(
          'button',
          { style: actionButtonStyle, disabled: busy, onClick: () => void beginCommitAndPush() },
          action === 'prepare' ? t('working') : t('commitPush'),
        ),
      )

      const pendingBlock = pending === null
        ? null
        : h(
            'div',
            { style: S.panel },
            h(
              'span',
              { style: { fontSize: 12.5, fontWeight: 600 } },
              `${t('confirmCommitPush')} ${pending.files.length} ${t('filesCount')}`,
            ),
            h(
              'pre',
              { style: S.fileName },
              pending.files.slice(0, 20).join('\n') + (pending.files.length > 20 ? `\n… +${pending.files.length - 20}` : ''),
            ),
            h('input', {
              style: S.input,
              value: pending.message,
              placeholder: t('commitMessage'),
              onChange: (event) => setPending({ ...pending, message: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Enter') void submitCommitAndPush()
              },
            }),
            h(
              'div',
              { style: S.row },
              h(
                'button',
                { style: { ...S.button, opacity: busy ? 0.55 : 1 }, disabled: busy, onClick: () => void submitCommitAndPush() },
                action === 'commit' ? t('working') : t('confirm'),
              ),
              h(
                'button',
                { style: S.button, disabled: busy, onClick: () => setPending(null) },
                t('cancel'),
              ),
            ),
          )

      const resultBlock = actionResult === null
        ? null
        : h(
            'div',
            { style: S.panel },
            h(
              'span',
              { style: { fontSize: 12.5, fontWeight: 600, color: actionResult.ok ? '#2f9e44' : '#d1242f' } },
              actionResult.title,
            ),
            ...(actionResult.details ?? []).map((line, index) => h('span', { key: `detail-${index}`, style: S.muted }, line)),
            typeof actionResult.output === 'string' && actionResult.output !== ''
              ? h('pre', { style: { ...S.diff, maxHeight: 240 } }, actionResult.output)
              : null,
            actionResult.truncated === true ? h('span', { style: S.muted }, t('outputTruncated')) : null,
          )

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
          h('button', { style: S.button, onClick: () => { void load(); void loadProjects() } }, loading ? t('loading') : t('refresh')),
          state !== null
            ? h(
                'span',
                { style: { fontSize: 12, opacity: 0.7 } },
                `${state.total} · +${state.added} / −${state.removed}`,
              )
            : null,
        ),
        actionsRow,
        projectsHint,
        projectsErrorLine,
        pendingBlock,
        resultBlock,
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

    /** Содержимое карточки на странице своего плагина. */
    function DetailCard_dshreview(props) {
      const subject = props?.subject
      const packageName =
        subject?.kind === 'bundle' && typeof subject?.pkg?.name === 'string'
          ? subject.pkg.name
          : typeof subject?.id === 'string'
            ? subject.id
            : ''
      if (packageName !== 'dsh-review') return null
      const content = () => h(CardFrame, null, h(ChangesCard))
      return typeof content === 'function' ? content(props) : content
    }

    function apply(ctx) {
      ctx.locale.register(NS, { en, ru })
      translate = ctx.locale.bind(NS)

      try {
              try {
        ctx.slots.inject('plugins.detail.section', () =>
          ctx.slots.register(
            {
              name: 'plugins.detail.section',
              id: 'dsh-review-detail',
              order: 45,
              locale: NS,
            },
            DetailCard_dshreview,
          ),
        )
      } catch (error) {
        console.error('[dsh-review] секция страницы недоступна:', error)
      }
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
