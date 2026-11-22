/**
 * Browser half of `dsh-review`.
 *
 * Страница плагина: в центрированном контейнере — проект с тестами, файлы с
 * незакоммиченными изменениями, построчный diff, откат одного файла, тесты,
 * коммит с push и создание PR.
 * Тот же экран регистрируется как собственная панель в левой меню (`main` +
 * `sidebar.panellist`, ключ `plugin-review`): клик по иконке открывает настройки,
 * а не страницу плагин-менеджера.
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
    const GIT_STATUS_PATH = '/api/dsh-review/git-status'
    const COMMIT_PATH = '/api/dsh-review/git-commit'
    const PUSH_PATH = '/api/dsh-review/git-push'
    const BRANCH_INFO_PATH = '/api/dsh-review/branch-info'
    const PR_CREATE_PATH = '/api/dsh-review/pr-create'
    /**
     * Панель в левой панели: ключ `main` и id строки `sidebar.panellist`
     * совпадают (`plugin-review`) — хост открывает страницу по этому id.
     * `PANEL_ORDER` — позиция в общем списке панелей «Оформления интерфейса»
     * (20 + индекс: карточки 0, сжатие 1, ревью 2, …).
     */
    const PANEL_ID = 'plugin-review'
    const PANEL_EMOJI = '📝'
    const PANEL_ORDER = 22
    /**
     * id плагина в состоянии видимости панелей: его ведёт «Оформление
     * интерфейса» (`dsh-polish`) в localStorage. Пока состояния нет или оно
     * битое, панель считаем закреплённой — так же, как в настройках оформления.
     */
    const PANEL_STATE_ID = 'review'
    const PANEL_STATE_KEY = 'dsh-polish:panel-visibility'
    const PANELS_CHANGED_EVENT = 'dsh-polish:panels-changed'

    const en = {
      title: 'Changes review',
      panelSubtitle: 'Changes, tests, commit and pull request.',
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
      gitStatusFailed: 'Could not read git status',
      repoLabel: 'repo',
      warningsLabel: 'warnings',
      requestTimeout: 'Request timeout',
      hashLabel: 'hash',
      choosePublishHint: 'Choose a directory with its own repository, e.g. .publish/<name>.',
      createPr: 'Create PR',
      prPanelTitle: 'Create pull request',
      prTitle: 'Title',
      prBody: 'Description',
      prBase: 'Base branch',
      prHead: 'Head branch',
      prCreated: 'PR created',
      prExisting: 'PR already exists',
      prNeedTitle: 'Enter a PR title.',
      prBaseHeadSame: 'Head and base are the same — switch to a feature branch.',
      prNoGithub: 'origin is not GitHub — PR is unavailable.',
      prMainWarning: 'You are on the base branch: switch to a feature branch before creating a PR.',
      branchInfoFailed: 'Could not read branch info',
      branchDetached: 'detached HEAD',
      branchLinePrefix: 'Branch',
      sectionProject: 'Project',
      sectionChanges: 'Changes',
      statusIdle: 'Ready',
      statusClean: 'Clean',
      statusChanges: 'Files changed',
      statusError: 'Error',
      emptyHint: 'Edit files in the project and the list appears here.',
    }
    const ru = {
      title: 'Ревью изменений',
      panelSubtitle: 'Изменения, тесты, коммит и pull request.',
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
      gitStatusFailed: 'Не удалось получить состояние git',
      repoLabel: 'репозиторий',
      warningsLabel: 'предупреждения',
      requestTimeout: 'Таймаут запроса',
      hashLabel: 'hash',
      choosePublishHint: 'Выберите каталог с собственным репозиторием, например .publish/<имя>.',
      createPr: 'Создать PR',
      prPanelTitle: 'Создание pull request',
      prTitle: 'Название',
      prBody: 'Описание',
      prBase: 'Базовая ветка',
      prHead: 'Ветка PR',
      prCreated: 'PR создан',
      prExisting: 'PR уже существует',
      prNeedTitle: 'Введите название PR.',
      prBaseHeadSame: 'Ветка PR совпадает с базовой — переключитесь на отдельную ветку.',
      prNoGithub: 'origin не GitHub — создать PR нельзя.',
      prMainWarning: 'Вы на базовой ветке: перед PR переключитесь на отдельную ветку.',
      branchInfoFailed: 'Не удалось получить данные о ветке',
      branchDetached: 'HEAD оторван',
      branchLinePrefix: 'Ветка',
      sectionProject: 'Проект',
      sectionChanges: 'Изменения',
      statusIdle: 'Готово',
      statusClean: 'Чисто',
      statusChanges: 'Файлов изменено',
      statusError: 'Ошибка',
      emptyHint: 'Измените файлы проекта — список появится здесь.',
    }

    const KIND_LABEL = {
      staged: 'staged',
      untracked: 'untracked',
      modified: 'modified',
      deleted: 'deleted',
      renamed: 'renamed',
      conflict: 'conflict',
    }

    /**
     * Тон чипа-статуса по виду файла: мягкая заливка по смыслу, как у кнопок.
     * Новый и добавленный в индекс — успех, изменён — внимание, удалён/конфликт —
     * ошибка, переименован — информация.
     */
    const KIND_TONE = {
      staged: 'info',
      untracked: 'success',
      modified: 'warn',
      deleted: 'error',
      renamed: 'info',
      conflict: 'error',
    }

    /**
     * Единая система кнопок плагина (спека `.tools/plugin-design-spec-v2.md`):
     * высота 36 px (маленькие в шапке — 32), padding 0 14, радиус 10,
     * шрифт 600 12.5, ширина — по тексту. Все варианты — только токены темы.
     *
     * primary — мягкая заливка brand + текст brand. Белый фон с белым текстом
     * запрещён: в тёмной теме brand-primary сам белый, поэтому старые
     * `button-primary-fill` + `label-primary-inverted` давали нечитаемый текст.
     */
    const BTN_BASE = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 36,
      padding: '0 14px',
      borderRadius: 10,
      fontFamily: 'inherit',
      fontSize: 12.5,
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      transition: 'background-color .14s ease, border-color .14s ease, color .14s ease',
    }
    const BTN = {
      base: BTN_BASE,
      primary: {
        ...BTN_BASE,
        border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)',
        color: 'var(--dsw-alias-brand-primary)',
      },
      secondary: {
        ...BTN_BASE,
        border: '1px solid var(--dsw-alias-border-l4)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
      },
      danger: {
        ...BTN_BASE,
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent)',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      small: { ...BTN_BASE, height: 32, padding: '0 12px' },
      icon: {
        ...BTN_BASE,
        width: 32,
        height: 32,
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l4)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
      },
    }

    /**
     * Чип-статус — «кнопка-близнец»: та же геометрия и шрифт, но не кликается.
     * Высота 36 в секциях (32 в шапке и плотных строках), радиус 10,
     * padding 0 12, рамка 1 px, шрифт 600 12.5, точка-индикатор 6 px слева.
     * Заливки — мягкие токены темы: success/warn/error по смыслу, info — brand.
     */
    const CHIP_BASE = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 32,
      padding: '0 12px',
      borderRadius: 10,
      border: '1px solid var(--dsw-alias-border-l4)',
      fontFamily: 'inherit',
      fontSize: 12.5,
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      maxWidth: '100%',
      color: 'var(--dsw-alias-label-secondary)',
      background: 'transparent',
    }
    const CHIP_SECTION = { height: 36 }
    const CHIP_TONES = {
      neutral: {
        border: '1px solid var(--dsw-alias-border-l4)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        dot: 'var(--dsw-alias-label-tertiary)',
      },
      info: {
        border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)',
        color: 'var(--dsw-alias-brand-primary)',
        dot: 'var(--dsw-alias-brand-primary)',
      },
      success: {
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)',
        color: 'var(--dsw-alias-state-success-primary)',
        dot: 'var(--dsw-alias-state-success-primary)',
      },
      warn: {
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)',
        color: 'var(--dsw-alias-state-warn-primary)',
        dot: 'var(--dsw-alias-state-warn-primary)',
      },
      error: {
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)',
        color: 'var(--dsw-alias-state-error-primary)',
        dot: 'var(--dsw-alias-state-error-primary)',
      },
    }

    /**
     * Страница плагина в едином стиле DSH: контент по центру (maxWidth 960),
     * шапка с иконкой и статусом, карточки-секции, адаптив в одну колонку.
     * Цвета — только токены темы; жёстких hex нет.
     */
    const UI = {
      page: {
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--dsw-alias-label-primary)',
        flex: '1 1 auto',
        minHeight: 0,
        maxHeight: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
      },
      body: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },
      head: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
      icon: {
        boxSizing: 'border-box',
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 52,
        height: 52,
        borderRadius: 14,
        fontSize: 26,
        lineHeight: 1,
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent)',
      },
      headText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 240px' },
      title: { margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.25, color: 'var(--dsw-alias-label-primary)' },
      subtitle: {
        margin: 0,
        fontSize: 12.5,
        fontWeight: 400,
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      headRight: { display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '0 0 auto', flexWrap: 'wrap', minWidth: 0 },
      chipDot: { width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto' },
      chipText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      refresh: { ...BTN.secondary, height: 32 },
      iconButton: { ...BTN.icon },
      card: {
        boxSizing: 'border-box',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 14,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      sectionHead: { display: 'flex', alignItems: 'center', gap: 8 },
      bar: { flex: '0 0 auto', width: 3, height: 14, borderRadius: 2, background: 'var(--dsw-alias-brand-primary)' },
      sectionTitle: { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: 'var(--dsw-alias-label-primary)' },
      /** Карточка «Проект» — одна колонка: поле каталога, чип ветки, кнопки. */
      project: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
      fieldBlock: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, width: '100%' },
      fieldLabel: {
        boxSizing: 'border-box',
        minWidth: 0,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        hyphens: 'auto',
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 },
      hint: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
      muted: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
      primary: { ...BTN.primary },
      secondary: { ...BTN.secondary },
      danger: { ...BTN.danger },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        height: 34,
        padding: '0 10px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 12.5,
      },
      textarea: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: 84,
        padding: '8px 10px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 12.5,
        lineHeight: 1.5,
        resize: 'vertical',
      },
      select: {
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        height: 34,
        padding: '0 8px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12.5,
      },
      file: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        padding: '6px 10px',
        borderRadius: 10,
        border: '1px solid transparent',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 12.5,
        cursor: 'pointer',
      },
      fileActive: {
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent)',
      },
      fileName: {
        margin: 0,
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5,
        lineHeight: 1.45,
        maxHeight: 132,
        overflow: 'auto',
      },
      diff: {
        margin: 0,
        boxSizing: 'border-box',
        width: '100%',
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5,
        lineHeight: 1.45,
        maxHeight: 360,
        overflow: 'auto',
      },
      empty: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '28px 12px',
        textAlign: 'center',
      },
      emptyIcon: { fontSize: 32, lineHeight: 1 },
      emptyText: { fontSize: 12.5, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      alert: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 14,
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, var(--dsw-alias-border-l2))',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, var(--dsw-alias-bg-layer-1))',
      },
      alertText: { fontSize: 12.5, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)' },
    }

    /** CSS, который нельзя задать inline: наведение, фокус, disabled и адаптив. */
    const PAGE_CSS = [
      // Чипы-статусы — как кнопки: короткая подпись не рвётся, точка 6 px слева.
      '.dshrv-page-chip{flex:0 0 auto;min-width:0;overflow-wrap:normal;word-break:normal;}',
      '.dshrv-page-chip > .dshrv-page-chip-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      // Кнопки — единая система: ширина по тексту, мягкие заливки из токенов.
      '.dshrv-page-primary,.dshrv-page-button,.dshrv-page-danger,.dshrv-page-refresh,.dshrv-page-icon{flex:0 0 auto;min-width:0;}',
      '.dshrv-page-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent) !important;}',
      '.dshrv-page-button:hover:not(:disabled),.dshrv-page-refresh:hover:not(:disabled),.dshrv-page-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover) !important;}',
      '.dshrv-page-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,transparent) !important;}',
      '.dshrv-page-primary:active:not(:disabled),.dshrv-page-button:active:not(:disabled),.dshrv-page-danger:active:not(:disabled){transform:translateY(1px);}',
      '.dshrv-page-field:focus-visible,.dshrv-page-primary:focus-visible,.dshrv-page-button:focus-visible,.dshrv-page-danger:focus-visible,.dshrv-page-refresh:focus-visible,.dshrv-page-icon:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);outline-offset:1px;}',
      '.dshrv-page-primary:disabled,.dshrv-page-button:disabled,.dshrv-page-danger:disabled,.dshrv-page-refresh:disabled{opacity:.55;cursor:default;}',
      // Карточка «Проект»: одна колонка — подпись над полем, поле на всю ширину.
      '.dshrv-page-project{display:flex;flex-direction:column;gap:12px;min-width:0;}',
      '.dshrv-page-project .dshrv-page-project-field{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0;}',
      '.dshrv-page-project-label{white-space:nowrap;overflow-wrap:normal;word-break:normal;hyphens:auto;}',
      '.dshrv-page-project .dshrv-page-field{width:100%;max-width:100%;min-width:0;}',
      '.dshrv-page-file{transition:background .14s ease;overflow-wrap:anywhere;}',
      '.dshrv-page-file:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent);}',
      // Адаптив: страница не вылезает за экран, строки переносятся.
      '.dshrv-page{overflow-wrap:anywhere;box-sizing:border-box;width:100%;min-width:0;min-height:0;max-height:100%;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;padding-bottom:40px;}',
      '.dshrv-page-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}',
      '@media (max-width: 1024px){.dshrv-page{padding:22px 24px 38px !important;}.dshrv-page-head{gap:12px;}}',
      '@media (max-width: 900px){.dshrv-page{padding:20px 18px 36px !important;}}',
      '@media (max-width: 768px){.dshrv-page{padding:18px 16px 32px !important;}.dshrv-page-head{gap:10px;}.dshrv-page-actions{gap:8px;}}',
      '@media (max-width: 640px){.dshrv-page{padding:16px 14px 28px !important;}.dshrv-page-head-right{flex:1 1 100%;margin-left:0;}.dshrv-page-actions .dshrv-page-button{flex:1 1 calc(50% - 4px);}}',
      '@media (max-width: 480px){.dshrv-page{padding:14px 12px 24px !important;}.dshrv-page-actions .dshrv-page-button{flex:1 1 100%;}}',
    ].join('\n')

    let translate = (key) => key

    /**
     * POST с таймаутом: даже зависший host-запрос не оставляет кнопку
     * в состоянии «Выполняется…» навсегда.
     * @param {string} path маршрут
     * @param {unknown} payload тело
     * @param {number} timeoutMs таймаут, по умолчанию 180 с
     */
    async function post(path, payload, timeoutMs = 180000) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
          ...(controller !== null ? { signal: controller.signal } : {}),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      } catch (cause) {
        if (cause?.name === 'AbortError') {
          const seconds = Math.round(timeoutMs / 1000)
          throw new Error(`${translate('requestTimeout')} (${seconds} ${translate('sec')})`)
        }
        throw cause
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
    }

    /**
     * Чип-статус в единой системе с кнопками: та же высота, радиус, шрифт и
     * рамка, мягкая заливка по смыслу и точка-индикатор 6 px слева.
     * `section` включает высоту 36 (статус-блок внутри карточки-секции).
     */
    function StatusChip({ tone, label, section, title, live, style }) {
      const name = typeof tone === 'string' && CHIP_TONES[tone] !== undefined ? tone : 'neutral'
      const { dot, ...toneStyle } = CHIP_TONES[name]
      return h(
        'span',
        {
          className: `dshrv-page-chip dshrv-page-chip-${name}`,
          style: { ...CHIP_BASE, ...(section === true ? CHIP_SECTION : null), ...toneStyle, ...(style ?? null) },
          ...(title === undefined || title === '' ? {} : { title: String(title) }),
          ...(live === true ? { role: 'status' } : {}),
        },
        h('span', { className: 'dshrv-page-chip-dot', style: { ...UI.chipDot, background: dot } }),
        h('span', { className: 'dshrv-page-chip-text', style: UI.chipText }, label),
      )
    }

    /** Шапка страницы: квадрат с иконкой, заголовок, статус-чип и «Обновить». */
    function PageHeader({ icon, title, subtitle, chipLabel, chipTone, refreshLabel, onRefresh, open, onToggle }) {
      return h(
        'div',
        { className: 'dshrv-page-head', style: UI.head },
        h('div', { style: UI.icon }, icon),
        h(
          'div',
          { style: UI.headText },
          h('h1', { style: UI.title }, title),
          subtitle !== '' ? h('p', { style: UI.subtitle }, subtitle) : null,
        ),
        h(
          'div',
          { className: 'dshrv-page-head-right', style: UI.headRight },
          h(StatusChip, { tone: chipTone, label: chipLabel, live: true }),
          h(
            'button',
            { type: 'button', className: 'dshrv-page-refresh', style: UI.refresh, onClick: onRefresh },
            refreshLabel,
          ),
          onToggle === undefined ? null : h(ToggleIcon, { open, onClick: onToggle }),
        ),
      )
    }

    /** Карточка-секция: акцентная полоска, заголовок 14/600 и содержимое. */
    function SectionCard({ title, titleColor, children }) {
      return h(
        'section',
        { style: UI.card },
        h(
          'div',
          { style: UI.sectionHead },
          h('span', { style: UI.bar }),
          h(
            'h2',
            { style: titleColor === undefined ? UI.sectionTitle : { ...UI.sectionTitle, color: titleColor } },
            title,
          ),
        ),
        children,
      )
    }

    /** Пустое состояние: иконка 32, текст tertiary и подсказка. */
    function EmptyState({ icon, text, hint }) {
      return h(
        'div',
        { style: UI.empty },
        h('span', { style: UI.emptyIcon }, icon),
        h('span', { style: UI.emptyText }, text),
        hint === '' ? null : h('span', { style: UI.hint }, hint),
      )
    }

    /** Кнопка-шеврон: свернуть страницу до шапки или развернуть обратно. */
    function ToggleIcon({ open, onClick }) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          title: open ? translate('collapse') : translate('open'),
          'aria-label': open ? translate('collapse') : translate('open'),
          'aria-expanded': open ? 'true' : 'false',
          className: 'dshrv-page-icon',
          style: UI.iconButton,
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


    /**
     * Страница настроек: на странице плагина рисует себя целиком (шапка, карточки),
     * а в панели левого меню — только содержимое (`bare`), потому что шапку и
     * отступы даёт `ReviewPanelPage`.
     */
    function ChangesCard(props) {
      const bare = props?.bare === true
      const t = (key) => translate(key)
      const [open, setOpen] = React.useState(true)
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
      const [branchInfo, setBranchInfo] = React.useState(null)
      const [branchError, setBranchError] = React.useState('')
      const [prPending, setPrPending] = React.useState(null)

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

      // Ветка выбранного каталога: ahead/behind и данные для PR.
      const loadBranchInfo = React.useCallback(async () => {
        const dir = selectedDir !== '' ? selectedDir : '.'
        try {
          const data = await post(BRANCH_INFO_PATH, { dir }, 60000)
          if (data?.ok === true) {
            setBranchInfo(data)
            setBranchError('')
          } else {
            setBranchInfo(null)
            setBranchError(String(data?.message ?? t('branchInfoFailed')))
          }
        } catch (cause) {
          setBranchInfo(null)
          setBranchError(String(cause?.message ?? cause))
        }
      }, [selectedDir])

      React.useEffect(() => {
        void loadBranchInfo()
      }, [loadBranchInfo])

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

      // Шаг 1 commit+push: git-status выбранного каталога и обязательное подтверждение.
      const beginCommitAndPush = async () => {
        if (action !== '') return
        setAction('prepare')
        setActionResult(null)
        setNotice('')
        setPrPending(null)
        try {
          const dir = selectedDir !== '' ? selectedDir : '.'
          const status = await post(GIT_STATUS_PATH, { dir })
          if (status?.ok !== true) {
            const message = String(status?.message ?? t('gitStatusFailed'))
            const details = [`${t('projectDirResult')}: ${dirLabel(dir)}`]
            if (typeof status?.repoPath === 'string' && status.repoPath !== '') details.push(`${t('repoLabel')}: ${status.repoPath}`)
            else if (typeof status?.repo === 'string' && status.repo !== '') details.push(`${t('repoLabel')}: ${status.repo}`)
            if (/установленная копия|не является git-репозиторием/i.test(message)) details.push(t('choosePublishHint'))
            setActionResult({
              ok: false,
              title: message,
              details,
              output: typeof status?.output === 'string' ? status.output : '',
              truncated: false,
            })
            return
          }
          const files = Array.isArray(status.files) ? status.files : []
          const total = Number.isFinite(status.total) ? status.total : files.length
          if (total === 0) {
            setNotice(t('noChanges'))
            return
          }
          setPending({
            dir,
            repo: typeof status.repo === 'string' ? status.repo : '',
            repoPath: typeof status.repoPath === 'string' ? status.repoPath : '',
            branch: typeof status.branch === 'string' ? status.branch : '',
            files,
            total,
            warnings: Array.isArray(status.warnings) ? status.warnings : [],
            message: '',
          })
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
          const commit = await post(COMMIT_PATH, { dir: pending.dir, message, paths: 'all', confirm: true })
          if (commit?.ok !== true) {
            const failure = String(commit?.message ?? t('commitFailed'))
            const details = []
            if (typeof commit?.repoPath === 'string' && commit.repoPath !== '') {
              details.push(`${t('repoLabel')}: ${commit.repoPath}${commit?.branch ? ` (${commit.branch})` : ''}`)
            } else if (typeof commit?.repo === 'string' && commit.repo !== '') {
              details.push(`${t('repoLabel')}: ${commit.repo}${commit?.branch ? ` (${commit.branch})` : ''}`)
            }
            if (Array.isArray(commit?.files) && commit.files.length > 0) {
              details.push(`${commit.files.length} ${t('filesCount')}: ${commit.files.slice(0, 10).join(', ')}`)
            }
            if (/установленная копия|не является git-репозиторием/i.test(failure)) details.push(t('choosePublishHint'))
            setActionResult({
              ok: false,
              title: failure,
              details,
              output: typeof commit?.output === 'string' ? commit.output : '',
              truncated: false,
            })
            await load()
            return
          }

          // Коммит уже создан: ошибку push показываем результатом, а не исключением.
          let push
          try {
            push = await post(PUSH_PATH, { dir: pending.dir, confirm: true })
          } catch (cause) {
            push = { ok: false, message: String(cause?.message ?? cause) }
          }
          const ok = push?.ok === true
          setActionResult({
            ok,
            title: ok ? t('pushed') : `${t('commitCreated')} ✓ / ${t('pushFailed')}`,
            details: [
              `${t('repoLabel')}: ${commit?.repoPath ?? commit?.repo ?? '—'}${commit?.branch ? ` (${commit.branch})` : ''}`,
              `${t('commitCreated')}: ${commit?.hash ?? commit?.commit ?? '—'}; ${t('filesCount')}: ${commit?.total ?? (Array.isArray(commit?.files) ? commit.files.length : 0)}`,
              `${t('remoteLabel')}: ${push?.remote ?? '—'}; ${t('branchLabel')}: ${push?.branch ?? '—'}; ${t('codeLabel')}: ${push?.exitCode ?? '—'}`,
              ...ok ? [] : [String(push?.message ?? '')],
            ],
            output: [commit?.output, push?.output].filter(part => typeof part === 'string' && part !== '').join('\n'),
            truncated: false,
          })
          setPending(null)
          await load()
          await loadBranchInfo()
        } catch (cause) {
          const details = []
          if (pending.repoPath !== '' || pending.repo !== '') {
            details.push(`${t('repoLabel')}: ${pending.repoPath || pending.repo}${pending.branch !== '' ? ` (${pending.branch})` : ''}`)
          }
          setActionResult({
            ok: false,
            title: String(cause?.message ?? cause),
            details,
            output: '',
            truncated: false,
          })
          await load()
        } finally {
          setAction('')
        }
      }

      // «Создать PR»: свежие данные ветки, затем панель подтверждения.
      const beginPrCreate = async () => {
        if (action !== '') return
        setAction('preparePr')
        setActionResult(null)
        setNotice('')
        setPending(null)
        try {
          const dir = selectedDir !== '' ? selectedDir : '.'
          const data = await post(BRANCH_INFO_PATH, { dir }, 60000)
          if (data?.ok !== true) {
            setActionResult({
              ok: false,
              title: String(data?.message ?? t('branchInfoFailed')),
              details: [`${t('projectDirResult')}: ${dirLabel(dir)}`],
              output: '',
              truncated: false,
            })
            return
          }
          setBranchInfo(data)
          const branch = typeof data.branch === 'string' ? data.branch : ''
          const base = typeof data.baseBranch === 'string' ? data.baseBranch : 'main'
          setPrPending({
            dir,
            branch,
            base,
            head: branch,
            title: branch.replace(/_/g, ' '),
            body: Array.isArray(data.commits) ? data.commits.join('\n') : '',
            github: data.github ?? null,
          })
        } catch (cause) {
          setActionResult({ ok: false, title: String(cause?.message ?? cause), details: [], output: '', truncated: false })
        } finally {
          setAction('')
        }
      }

      // Подтверждение: создаём PR через GitHub API (маршрут берёт токен из credential store).
      const submitPr = async () => {
        if (prPending === null || action !== '') return
        const title = prPending.title.trim()
        if (title === '') {
          setNotice(t('prNeedTitle'))
          return
        }
        setAction('pr')
        setNotice('')
        setActionResult(null)
        try {
          const result = await post(PR_CREATE_PATH, {
            dir: prPending.dir,
            title,
            body: prPending.body,
            base: prPending.base,
            head: prPending.head,
            confirm: true,
          }, 60000)
          if (result?.ok !== true) {
            setActionResult({
              ok: false,
              title: String(result?.message ?? t('branchInfoFailed')),
              details: [`${prPending.head || '—'} → ${prPending.base || '—'}`],
              output: '',
              truncated: false,
            })
            return
          }
          setActionResult({
            ok: true,
            title: `${result.existing === true ? t('prExisting') : t('prCreated')} #${result.number ?? '—'}`,
            details: [
              `${result.repo ?? '—'}: ${result.head ?? '—'} → ${result.base ?? '—'}`,
              ...(typeof result.url === 'string' && result.url !== '' ? [result.url] : []),
            ],
            output: '',
            truncated: false,
          })
          setPrPending(null)
          await loadBranchInfo()
        } catch (cause) {
          setActionResult({ ok: false, title: String(cause?.message ?? cause), details: [], output: '', truncated: false })
        } finally {
          setAction('')
        }
      }

      const files = state?.files ?? []

      const busy = action !== ''
      const noProjects = projectsReady && projects.length === 0 && projectsError === ''
      const canRunTests = !busy && !noProjects
      // Строка «Каталог»: подпись отдельным блоком (не рвётся по слогам),
      // поле — на всю ширину карточки; ниже чип ветки и кнопки в один ряд.
      const projectSelect = projects.length > 0
        ? h(
            'label',
            { className: 'dshrv-page-project-field', style: UI.fieldBlock },
            h('span', { className: 'dshrv-page-project-label', style: UI.fieldLabel }, t('projectDirLabel')),
            h(
              'select',
              {
                className: 'dshrv-page-field',
                style: UI.select,
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
      const projectsHint = noProjects ? h('span', { style: UI.hint }, t('noProjects')) : null
      const projectsErrorLine = projectsError !== ''
        ? h(StatusChip, {
            key: 'projects-error',
            section: true,
            tone: 'error',
            label: projectsError,
            title: projectsError,
            style: { alignSelf: 'flex-start' },
          })
        : null
      const actionsRow = h(
        'div',
        { className: 'dshrv-page-actions', style: UI.row },
        h(
          'button',
          {
            className: 'dshrv-page-button',
            style: { ...UI.secondary, opacity: canRunTests ? 1 : 0.55 },
            disabled: !canRunTests,
            onClick: () => void runTestsAction(),
          },
          action === 'tests' ? t('working') : t('runTests'),
        ),
        h(
          'button',
          {
            className: 'dshrv-page-button',
            style: { ...UI.secondary, opacity: busy ? 0.55 : 1 },
            disabled: busy,
            onClick: () => void beginCommitAndPush(),
          },
          action === 'prepare' ? t('working') : t('commitPush'),
        ),
        h(
          'button',
          {
            className: 'dshrv-page-button',
            style: { ...UI.secondary, opacity: busy ? 0.55 : 1 },
            disabled: busy,
            onClick: () => void beginPrCreate(),
          },
          action === 'preparePr' ? t('working') : t('createPr'),
        ),
      )

      const branchLine = branchInfo?.ok === true
        ? h(StatusChip, {
            key: 'branch-chip',
            section: true,
            style: { alignSelf: 'flex-start' },
            tone: Number.isFinite(branchInfo.behind) && branchInfo.behind > 0 ? 'warn' : 'info',
            label: `${t('branchLinePrefix')}: ${branchInfo.branch ?? '—'} · ${Number.isFinite(branchInfo.ahead) ? branchInfo.ahead : '—'}↑/${Number.isFinite(branchInfo.behind) ? branchInfo.behind : '—'}↓`,
          })
        : branchError !== ''
          ? h(StatusChip, {
              key: 'branch-error',
              section: true,
              style: { alignSelf: 'flex-start' },
              tone: 'error',
              label: branchError,
              title: branchError,
            })
          : null

      const prPanelBlock = prPending === null
        ? null
        : h(
            SectionCard,
            { key: 'pr-panel', title: `${t('prPanelTitle')}: ${prPending.head || '—'} → ${prPending.base || '—'}` },
            prPending.github === null
              ? h('span', { style: { ...UI.hint, color: 'var(--dsw-alias-state-error-primary)' } }, t('prNoGithub'))
              : null,
            prPending.head !== '' && prPending.head === prPending.base
              ? h('span', { style: { ...UI.hint, color: 'var(--dsw-alias-state-error-primary)' } }, t('prMainWarning'))
              : null,
            h('input', {
              className: 'dshrv-page-field',
              style: UI.input,
              value: prPending.title,
              placeholder: t('prTitle'),
              onChange: (event) => setPrPending({ ...prPending, title: event.target.value }),
            }),
            h('textarea', {
              className: 'dshrv-page-field',
              style: UI.textarea,
              value: prPending.body,
              placeholder: t('prBody'),
              onChange: (event) => setPrPending({ ...prPending, body: event.target.value }),
            }),
            h(
              'div',
              { style: UI.row },
              h(
                'label',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                h('span', null, t('prBase')),
                h('input', {
                  className: 'dshrv-page-field',
                  style: { ...UI.input, flex: '1 1 140px', width: 'auto', minWidth: 0 },
                  value: prPending.base,
                  onChange: (event) => setPrPending({ ...prPending, base: event.target.value }),
                }),
              ),
              h(
                'label',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                h('span', null, t('prHead')),
                h('input', {
                  className: 'dshrv-page-field',
                  style: { ...UI.input, flex: '1 1 140px', width: 'auto', minWidth: 0 },
                  value: prPending.head,
                  onChange: (event) => setPrPending({ ...prPending, head: event.target.value }),
                }),
              ),
            ),
            h(
              'div',
              { style: UI.row },
              h(
                'button',
                {
                  className: 'dshrv-page-primary',
                  style: { ...UI.primary, opacity: busy ? 0.55 : 1 },
                  disabled: busy,
                  onClick: () => void submitPr(),
                },
                action === 'pr' ? t('working') : t('confirm'),
              ),
              h(
                'button',
                { className: 'dshrv-page-button', style: UI.secondary, disabled: busy, onClick: () => setPrPending(null) },
                t('cancel'),
              ),
            ),
          )

      const pendingBlock = pending === null
        ? null
        : h(
            SectionCard,
            {
              key: 'pending-panel',
              title: `${t('confirmCommitPush')} ${pending.total} ${t('filesCount')}${pending.branch !== '' ? ` (${pending.branch})` : ''}`,
            },
            h('span', { style: UI.muted }, `${t('repoLabel')}: ${pending.repoPath || pending.repo || '—'}`),
            h('span', { style: UI.muted }, `${t('projectDirResult')}: ${dirLabel(pending.dir)}`),
            ...pending.warnings.map((line, index) => h(
              'span',
              { key: `warning-${index}`, style: { ...UI.hint, color: 'var(--dsw-alias-state-error-primary)' } },
              line,
            )),
            h(
              'pre',
              { style: UI.fileName },
              pending.files.slice(0, 20).join('\n') + (pending.total > Math.min(pending.files.length, 20) ? `\n… +${pending.total - Math.min(pending.files.length, 20)}` : ''),
            ),
            h('input', {
              className: 'dshrv-page-field',
              style: UI.input,
              value: pending.message,
              placeholder: t('commitMessage'),
              onChange: (event) => setPending({ ...pending, message: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Enter') void submitCommitAndPush()
              },
            }),
            h(
              'div',
              { style: UI.row },
              h(
                'button',
                {
                  className: 'dshrv-page-primary',
                  style: { ...UI.primary, opacity: busy ? 0.55 : 1 },
                  disabled: busy,
                  onClick: () => void submitCommitAndPush(),
                },
                action === 'commit' ? t('working') : t('confirm'),
              ),
              h(
                'button',
                { className: 'dshrv-page-button', style: UI.secondary, disabled: busy, onClick: () => setPending(null) },
                t('cancel'),
              ),
            ),
          )

      const resultBlock = actionResult === null
        ? null
        : h(
            SectionCard,
            {
              key: 'result-panel',
              title: actionResult.title,
              titleColor: actionResult.ok
                ? 'var(--dsw-alias-state-success-primary)'
                : 'var(--dsw-alias-state-error-primary)',
            },
            ...(actionResult.details ?? []).map((line, index) => h('span', { key: `detail-${index}`, style: UI.muted }, line)),
            typeof actionResult.output === 'string' && actionResult.output !== ''
              ? h('pre', { style: { ...UI.diff, maxHeight: 240 } }, actionResult.output)
              : null,
            actionResult.truncated === true ? h('span', { style: UI.muted }, t('outputTruncated')) : null,
          )

      const noticeLine = notice !== '' ? h('span', { style: UI.hint }, notice) : null

      // Статус в шапке: ошибка, загрузка, число изменений или чистое дерево.
      const chipTone = error !== ''
        ? 'error'
        : loading
          ? 'warn'
          : state !== null
            ? (Number(state.total) === 0 ? 'success' : 'warn')
            : 'neutral'
      const chipLabel = error !== ''
        ? t('statusError')
        : loading
          ? t('loading')
          : state !== null
            ? (Number(state.total) === 0 ? t('statusClean') : `${t('statusChanges')}: ${state.total}`)
            : t('statusIdle')

      const blocks = bare
        ? []
        : [
            h('style', { key: 'page-css' }, PAGE_CSS),
            h(PageHeader, {
              key: 'page-head',
              icon: '📝',
              title: t('heading'),
              subtitle: t('hint'),
              chipLabel,
              chipTone,
              refreshLabel: loading ? t('loading') : t('refresh'),
              onRefresh: () => {
                void load()
                void loadProjects()
                void loadBranchInfo()
              },
              open,
              onToggle: () => setOpen(!open),
            }),
          ]

      if (!open) {
        return h(
          'div',
          bare
            ? { className: 'dshrv-page-body', style: UI.body }
            : { className: 'dshrv-page', style: UI.page },
          blocks,
        )
      }

      blocks.push(
        error !== ''
          ? h(
              'div',
              { key: 'error', style: UI.alert },
              h('span', { style: UI.alertText }, error),
              h('span', { style: UI.hint }, t('noGit')),
              confirm === '__init__'
                ? h(
                    'div',
                    { style: UI.row },
                    h('span', { style: UI.hint }, t('initConfirm')),
                    h(
                      'button',
                      {
                        className: 'dshrv-page-danger',
                        style: UI.danger,
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
                    h(
                      'button',
                      { className: 'dshrv-page-button', style: UI.secondary, onClick: () => setConfirm('') },
                      t('no'),
                    ),
                  )
                : h(
                    'div',
                    { style: UI.row },
                    h(
                      'button',
                      { className: 'dshrv-page-button', style: UI.secondary, onClick: () => setConfirm('__init__') },
                      t('initGit'),
                    ),
                  ),
            )
          : null,
        h(
          SectionCard,
          { key: 'project', title: t('sectionProject') },
          h(
            'div',
            { className: 'dshrv-page-project', style: UI.project },
            projectSelect,
            branchLine,
            projectsHint,
            projectsErrorLine,
            actionsRow,
          ),
        ),
        prPanelBlock,
        pendingBlock,
        resultBlock,
        h(
          SectionCard,
          { key: 'changes', title: t('sectionChanges') },
          h(
            'div',
            { style: UI.row },
            state !== null
              ? h(StatusChip, {
                  key: 'changes-summary',
                  section: true,
                  tone: Number(state.total) === 0 ? 'success' : 'warn',
                  label: `${state.total} ${t('filesCount')} · +${state.added} / −${state.removed}`,
                })
              : null,
            noticeLine,
          ),
          loading ? h('span', { style: UI.hint }, t('loading')) : null,
          state !== null && files.length === 0
            ? h(EmptyState, { icon: '📄', text: t('empty'), hint: t('emptyHint') })
            : null,
          ...files.map((file) =>
            h(
              'div',
              { key: file.path, style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
              h(
                'div',
                {
                  className: 'dshrv-page-file',
                  style: { ...UI.file, ...(selected === file.path ? UI.fileActive : null) },
                  onClick: () => void showDiff(file),
                },
                h(StatusChip, {
                  section: true,
                  tone: KIND_TONE[file.kind] ?? 'neutral',
                  label: t(KIND_LABEL[file.kind] ?? 'modified'),
                }),
                h(
                  'span',
                  { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflowWrap: 'anywhere' } },
                  file.path,
                ),
                h(
                  'span',
                  { style: { marginLeft: 'auto', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', flex: '0 0 auto' } },
                  `+${file.added} / −${file.removed}`,
                ),
              ),
              selected === file.path
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
                    h(
                      'pre',
                      { style: UI.diff },
                      ...diff.map((entry) =>
                        h(
                          'div',
                          {
                            key: entry.number,
                            style: {
                              color:
                                entry.kind === 'add'
                                  ? 'var(--dsw-alias-state-success-primary)'
                                  : entry.kind === 'del'
                                    ? 'var(--dsw-alias-state-error-primary)'
                                    : entry.kind === 'hunk'
                                      ? 'var(--dsw-alias-brand-primary)'
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
                          { style: UI.row },
                          h('span', { style: UI.hint }, t('confirmRevert')),
                          h('button', { className: 'dshrv-page-danger', style: UI.danger, onClick: () => void revert(file) }, t('yes')),
                          h('button', { className: 'dshrv-page-button', style: UI.secondary, onClick: () => setConfirm('') }, t('no')),
                        )
                      : h(
                          'div',
                          { style: UI.row },
                          h('button', { className: 'dshrv-page-danger', style: UI.danger, onClick: () => setConfirm(file.path) }, t('revert')),
                        ),
                  )
                : null,
            ),
          ),
        ),
      )

      return h(
        'div',
        bare
          ? { className: 'dshrv-page-body', style: UI.body }
          : { className: 'dshrv-page', style: UI.page },
        blocks,
      )
    }

    /** Заголовок панели: эмодзи-иконка, название плагина и короткий подзаголовок. */
    function PanelHeader() {
      return h(
        'div',
        { className: 'dshrv-panel-head', style: UI.head },
        h('span', { style: UI.icon, 'aria-hidden': 'true' }, PANEL_EMOJI),
        h(
          'div',
          { style: UI.headText },
          h('h1', { style: UI.title }, translate('title')),
          h('p', { style: UI.subtitle }, translate('panelSubtitle')),
        ),
      )
    }

    /**
     * Главная панель плагина: та же страница настроек в центрированной колонке
     * (maxWidth 960), но без страницы плагин-менеджера — только шапка плагина и
     * его элементы управления.
     */
    function ReviewPanelPage() {
      return h(
        'section',
        { className: 'dshrv-page', style: UI.page, 'aria-label': translate('title'), 'data-dsh-panel': PANEL_ID },
        h('style', { key: 'page-css' }, PAGE_CSS),
        h(PanelHeader, { key: 'panel-head' }),
        h(ChangesCard, { key: 'settings', bare: true }),
      )
    }

    /** Иконка строки левой панели: эмодзи в размер, который просит хост. */
    function PanelIcon(props) {
      const requested = Number(props?.size)
      const size = Number.isFinite(requested) && requested > 0 ? requested : 16
      return h(
        'span',
        {
          'data-dsh-panel-icon': PANEL_STATE_ID,
          'aria-hidden': true,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            fontSize: Math.round(size * 0.95),
            lineHeight: 1,
          },
        },
        PANEL_EMOJI,
      )
    }

    /** Закреплена ли панель: состояние ведёт «Оформление интерфейса» (dsh-polish). */
    function isPanelPinned() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return true
        const raw = localStorage.getItem(PANEL_STATE_KEY)
        // Пока оформление не сохраняло состояние, все панели видны и закреплены.
        if (raw === null || raw === '') return true
        const state = JSON.parse(raw)
        if (!Array.isArray(state?.pinned)) return true
        return state.pinned.includes(PANEL_STATE_ID) || state.pinned.includes(PANEL_ID)
      } catch {
        return true
      }
    }

    /**
     * Панель в левой панели: `main` регистрируется всегда (она есть и в меню
     * «Ещё»), строка `sidebar.panellist` — только когда панель закреплена.
     * Событие `dsh-polish:panels-changed` приходит из «Оформления интерфейса»
     * после закрепления/открепления: перечитываем состояние и перерегистрируем
     * строку, сняв прошлую регистрацию.
     */
    function registerPanels(ctx) {
      try {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, ReviewPanelPage),
        )
      } catch (error) {
        console.error('[dsh-review] панель в левом меню недоступна:', error)
      }

      let disposeSidebar = null
      const syncSidebar = () => {
        if (typeof disposeSidebar === 'function') {
          try {
            disposeSidebar()
          } catch (error) {
            console.error('[dsh-review] не удалось снять строку левой панели:', error)
          }
          disposeSidebar = null
        }
        if (!isPanelPinned()) return
        try {
          let dispose = null
          const outer = ctx.slots.inject('sidebar.panellist', () => {
            dispose = ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: PANEL_ORDER,
                label: () => translate('title'),
                locale: NS,
              },
              PanelIcon,
            )
            return dispose
          })
          disposeSidebar = typeof dispose === 'function' ? dispose : outer
        } catch (error) {
          disposeSidebar = null
          console.error('[dsh-review] строка в левой панели недоступна:', error)
        }
      }
      syncSidebar()

      try {
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener(PANELS_CHANGED_EVENT, syncSidebar)
        }
      } catch (error) {
        console.error('[dsh-review] событие панелей недоступно:', error)
      }
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
      return h(ChangesCard)
    }

    function apply(ctx) {
      ctx.locale.register(NS, { en, ru })
      translate = ctx.locale.bind(NS)

      // Панель в левом меню: main — всегда, строка sidebar — только если закреплена.
      registerPanels(ctx)

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
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.NS = NS
    return module.exports
  },
})
