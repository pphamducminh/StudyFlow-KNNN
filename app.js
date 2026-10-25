(() => {
  'use strict';

  /* 1. Dữ liệu: đọc, kiểm tra và lưu trong trình duyệt. */
  const STORAGE_KEY = 'studyflow.v1';
  const SCHEMA_VERSION = 1;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_SETTINGS = { focusMinutes: 25, breakMinutes: 5, sampleUsed: false };
  let state;
  let currentView = 'today';
  let selectedTaskId = '';
  let selectedMode = 'focus';
  let todayKey = localDate();
  let storageAvailable = true;
  let storageWarningShown = false;
  let initialNotice = '';
  let completingTimer = false;
  let lastTimerMessage = '';
  let dialogReturnFocus = null;
  let confirmReturnFocus = null;
  let confirmResolver = null;
  let lastRenderedSecond = '';

  function freshState() {
    return { schemaVersion: SCHEMA_VERSION, tasks: [], sessions: [], settings: { ...DEFAULT_SETTINGS }, activeTimer: null };
  }

  function uid() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function validNumber(value, minimum = 0) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
  }

  function validTimestamp(value) {
    return validNumber(value) && value <= 8640000000000000;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    return year >= 2000 && year <= 9999 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function normalizeSegments(segments) {
    if (!Array.isArray(segments)) return [];
    return segments.filter((segment) => segment && validTimestamp(segment.start) && validTimestamp(segment.end) && segment.end >= segment.start)
      .map((segment) => ({ start: segment.start, end: segment.end }));
  }

  function normalizeState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid-data');
    if (input.schemaVersion !== SCHEMA_VERSION) throw new Error('unsupported-schema');
    const clean = freshState();
    const taskIds = new Set();
    for (const task of Array.isArray(input.tasks) ? input.tasks : []) {
      if (!task || typeof task.id !== 'string' || !task.id || taskIds.has(task.id) ||
          typeof task.title !== 'string' || !task.title.trim() || typeof task.subject !== 'string' || !task.subject.trim() ||
          !validDate(task.deadline) || !validNumber(task.estimatedSeconds, 0.001)) continue;
      taskIds.add(task.id);
      clean.tasks.push({
        id: task.id, title: task.title.trim().slice(0, 200), subject: task.subject.trim().slice(0, 100),
        deadline: task.deadline, estimatedSeconds: task.estimatedSeconds,
        createdAt: validTimestamp(task.createdAt) ? task.createdAt : Date.now(),
        status: task.status === 'completed' ? 'completed' : 'active'
      });
    }
    const sessionIds = new Set();
    for (const session of Array.isArray(input.sessions) ? input.sessions : []) {
      if (!session || typeof session.id !== 'string' || !session.id || sessionIds.has(session.id) ||
          typeof session.taskId !== 'string' || !validNumber(session.durationSeconds, 0.001) ||
          !validTimestamp(session.endedAt)) continue;
      sessionIds.add(session.id);
      const startedAt = validTimestamp(session.startedAt) ? session.startedAt : session.endedAt - session.durationSeconds * 1000;
      clean.sessions.push({
        id: session.id, taskId: session.taskId,
        subject: typeof session.subject === 'string' ? session.subject : 'Môn học',
        taskTitle: typeof session.taskTitle === 'string' ? session.taskTitle : 'Nhiệm vụ đã xóa',
        startedAt, endedAt: session.endedAt,
        recordedAt: validTimestamp(session.recordedAt) ? session.recordedAt : session.endedAt,
        durationSeconds: session.durationSeconds,
        segments: normalizeSegments(session.segments)
      });
    }
    const settings = input.settings || {};
    clean.settings = {
      focusMinutes: Number.isInteger(settings.focusMinutes) && settings.focusMinutes >= 1 && settings.focusMinutes <= 180 ? settings.focusMinutes : 25,
      breakMinutes: Number.isInteger(settings.breakMinutes) && settings.breakMinutes >= 1 && settings.breakMinutes <= 60 ? settings.breakMinutes : 5,
      sampleUsed: settings.sampleUsed === true
    };
    const timer = input.activeTimer;
    if (timer && typeof timer.id === 'string' && timer.id && ['focus', 'break'].includes(timer.mode) &&
        ['running', 'paused'].includes(timer.status) && validNumber(timer.durationSeconds, 1) && timer.durationSeconds <= 10800 &&
        validNumber(timer.elapsedSeconds) && validTimestamp(timer.startedAt) &&
        (timer.status === 'paused' || validTimestamp(timer.runStartedAt)) &&
        (timer.mode === 'break' || clean.tasks.some((task) => task.id === timer.taskId && task.status === 'active')) &&
        !sessionIds.has(timer.id)) {
      clean.activeTimer = {
        id: timer.id, mode: timer.mode, taskId: timer.mode === 'focus' ? timer.taskId : null,
        subject: typeof timer.subject === 'string' ? timer.subject : '',
        taskTitle: typeof timer.taskTitle === 'string' ? timer.taskTitle : '',
        status: timer.status, durationSeconds: timer.durationSeconds,
        elapsedSeconds: Math.min(timer.elapsedSeconds, timer.durationSeconds), startedAt: timer.startedAt,
        runStartedAt: timer.status === 'running' ? timer.runStartedAt : null,
        segments: normalizeSegments(timer.segments)
      };
    }
    return clean;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === null) return freshState();
      const parsed = JSON.parse(saved);
      const clean = normalizeState(parsed);
      if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.sessions) || clean.tasks.length !== parsed.tasks.length || clean.sessions.length !== parsed.sessions.length || (parsed.activeTimer && !clean.activeTimer)) {
        initialNotice = 'Một phần dữ liệu lưu không hợp lệ đã được bỏ qua. Các dữ liệu còn lại vẫn được giữ.';
      }
      return clean;
    } catch (error) {
      if (error.message === 'unsupported-schema') {
        storageAvailable = false;
        initialNotice = 'Dữ liệu thuộc phiên bản khác. Phiên này hoạt động tạm thời và không ghi đè dữ liệu cũ.';
      } else if (error instanceof SyntaxError || error.message === 'invalid-data') {
        try {
          localStorage.setItem(`${STORAGE_KEY}.recovery`, localStorage.getItem(STORAGE_KEY) || '');
          initialNotice = 'Dữ liệu lưu bị hỏng. Đã mở không gian trống và giữ bản gốc trong bộ nhớ khôi phục của trình duyệt.';
        } catch (_) {
          storageAvailable = false;
          initialNotice = 'Dữ liệu lưu bị hỏng và chưa thể tạo bản khôi phục. Phiên này chỉ lưu tạm, dữ liệu gốc chưa bị ghi đè.';
        }
      } else {
        storageAvailable = false;
        initialNotice = 'Trình duyệt đang chặn lưu dữ liệu. Bạn vẫn có thể dùng ứng dụng trong phiên này; dữ liệu sẽ mất khi tải lại.';
      }
      return freshState();
    }
  }

  function refreshFromStorage() {
    if (!storageAvailable) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) state = normalizeState(JSON.parse(saved));
    } catch (_) { /* Do not discard valid in-memory state if another write is malformed. */ }
  }

  function saveState() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      storageAvailable = false;
      if (!storageWarningShown) {
        storageWarningShown = true;
        toast('Không thể lưu dữ liệu (bộ nhớ đầy hoặc bị chặn). Dữ liệu hiện tại chỉ được giữ trong phiên này.', 'error');
      }
    }
  }

  // Web Locks serialize simultaneous edits and timer completions across tabs where supported.
  // A fresh read also keeps ordinary file:// and older-browser tabs in sync.
  function transact(change) {
    let callbackStarted = false;
    const perform = () => {
      callbackStarted = true;
      refreshFromStorage();
      const changed = change();
      if (changed !== false) saveState();
      renderAll();
    };
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request(STORAGE_KEY, perform).catch((error) => {
        if (!callbackStarted && (error.name === 'SecurityError' || error.name === 'NotSupportedError')) {
          // Some file:// implementations expose Web Locks without allowing their use.
          perform();
          return;
        }
        console.error('StudyFlow:', error);
        toast('Thao tác chưa hoàn tất. Vui lòng thử lại.', 'error');
      });
    }
    try { perform(); } catch (error) {
      console.error('StudyFlow:', error);
      toast('Thao tác chưa hoàn tất. Vui lòng thử lại.', 'error');
    }
    return Promise.resolve();
  }

  /* 2. Lập kế hoạch: ngày địa phương và thời lượng chính xác bằng giây. */
  function localDate(timestamp = Date.now()) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function dayIndex(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  }

  function offsetDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDate(date.getTime());
  }

  function studiedSeconds(taskId) {
    return state.sessions.reduce((sum, session) => sum + (session.taskId === taskId ? session.durationSeconds : 0), 0);
  }

  function secondsForDay(session, dateString = localDate()) {
    const [year, month, day] = dateString.split('-').map(Number);
    const dayStart = new Date(year, month - 1, day).getTime();
    const dayEnd = new Date(year, month - 1, day + 1).getTime();
    const intervals = session.segments.length ? session.segments : [{ start: session.endedAt - session.durationSeconds * 1000, end: session.endedAt }];
    const seconds = intervals.reduce((sum, segment) => sum + Math.max(0, Math.min(segment.end, dayEnd) - Math.max(segment.start, dayStart)) / 1000, 0);
    return Math.min(seconds, session.durationSeconds);
  }

  function planTask(task, dateString = localDate()) {
    const studied = studiedSeconds(task.id);
    const remaining = Math.max(0, task.estimatedSeconds - studied);
    const days = Math.max(0, dayIndex(task.deadline) - dayIndex(dateString) + 1);
    return {
      studied, remaining, days,
      suggested: task.status === 'active' && remaining > 0 && days > 0 ? remaining / days : 0,
      overdue: task.status === 'active' && days === 0,
      ready: task.status === 'active' && remaining === 0,
      percent: Math.min(100, Math.max(0, Math.round(studied / task.estimatedSeconds * 100)))
    };
  }

  function orderedTasks(tasks) {
    return [...tasks].sort((a, b) => a.deadline.localeCompare(b.deadline) || a.createdAt - b.createdAt || a.title.localeCompare(b.title, 'vi'));
  }

  function formatDuration(seconds, precise = false) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0 phút';
    if (seconds < 60) return precise ? `${Math.max(1, Math.round(seconds))} giây` : '< 1 phút';
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} giờ${minutes ? ` ${minutes} phút` : ''}` : `${minutes} phút`;
  }

  function formatClock(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }

  function deadlineLabel(deadline) {
    const difference = dayIndex(deadline) - dayIndex(localDate());
    if (difference === 0) return 'Hạn hôm nay';
    if (difference === 1) return 'Hạn ngày mai';
    const [year, month, day] = deadline.split('-');
    return `Hạn ${day}/${month}${year !== String(new Date().getFullYear()) ? `/${year}` : ''}`;
  }

  /* 3. Timer: timestamp thay vì đếm số lần setInterval. */
  function timerElapsed(timer, now = Date.now()) {
    if (!timer) return 0;
    const running = timer.status === 'running' ? Math.max(0, now - timer.runStartedAt) / 1000 : 0;
    return Math.min(timer.durationSeconds, Math.max(0, timer.elapsedSeconds + running));
  }

  function stopRunningSegment(timer, now) {
    if (timer.status !== 'running') return;
    const allowed = Math.max(0, timer.durationSeconds - timer.elapsedSeconds);
    const elapsed = Math.min(allowed, Math.max(0, now - timer.runStartedAt) / 1000);
    if (elapsed > 0) timer.segments.push({ start: timer.runStartedAt, end: timer.runStartedAt + elapsed * 1000 });
    timer.elapsedSeconds = Math.min(timer.durationSeconds, timer.elapsedSeconds + elapsed);
    timer.runStartedAt = null;
    timer.status = 'paused';
  }

  function startTimer() {
    const settings = readSettingsInputs();
    if (!settings) return;
    const requestedMode = selectedMode;
    const requestedTask = $('task-select').value;
    transact(() => {
      if (state.activeTimer) {
        toast('Bạn đang có một phiên học hoặc nghỉ. Hãy kết thúc hoặc hủy phiên đó trước.', 'warning');
        return false;
      }
      const task = state.tasks.find((item) => item.id === requestedTask && item.status === 'active');
      if (requestedMode === 'focus' && !task) {
        toast('Hãy chọn một nhiệm vụ đang mở để bắt đầu học.', 'warning');
        $('task-select').focus();
        return false;
      }
      Object.assign(state.settings, settings);
      const now = Date.now();
      state.activeTimer = {
        id: uid(), mode: requestedMode, taskId: task && requestedMode === 'focus' ? task.id : null,
        subject: task ? task.subject : '', taskTitle: task ? task.title : '',
        status: 'running', durationSeconds: (requestedMode === 'focus' ? state.settings.focusMinutes : state.settings.breakMinutes) * 60,
        elapsedSeconds: 0, startedAt: now, runStartedAt: now, segments: []
      };
      lastTimerMessage = '';
    });
  }

  function pauseTimer() {
    transact(() => {
      const timer = state.activeTimer;
      if (!timer || timer.status !== 'running') return false;
      if (timerElapsed(timer) >= timer.durationSeconds) { recordFinishedTimer(false); return; }
      stopRunningSegment(timer, Date.now());
      lastTimerMessage = 'Đã tạm dừng. Thời gian nghỉ giữa phiên không được tính.';
    });
  }

  function resumeTimer() {
    transact(() => {
      const timer = state.activeTimer;
      if (!timer || timer.status !== 'paused') return false;
      if (timer.elapsedSeconds >= timer.durationSeconds) { recordFinishedTimer(false); return; }
      timer.runStartedAt = Date.now();
      timer.status = 'running';
      lastTimerMessage = '';
    });
  }

  function recordFinishedTimer(early) {
    const timer = state.activeTimer;
    if (!timer) return false;
    const now = Date.now();
    stopRunningSegment(timer, now);
    const durationSeconds = Math.min(timer.durationSeconds, timer.elapsedSeconds);
    const actualEnd = timer.segments.length ? timer.segments[timer.segments.length - 1].end : now;
    if (timer.mode === 'focus' && durationSeconds > 0 && !state.sessions.some((session) => session.id === timer.id)) {
      const task = state.tasks.find((item) => item.id === timer.taskId);
      state.sessions.push({
        id: timer.id, taskId: timer.taskId, subject: task ? task.subject : timer.subject,
        taskTitle: task ? task.title : timer.taskTitle, startedAt: timer.startedAt,
        endedAt: actualEnd, recordedAt: now, durationSeconds, segments: timer.segments
      });
      lastTimerMessage = `${early ? 'Đã kết thúc sớm' : 'Hoàn tất phiên học'} · Đã ghi nhận ${formatDuration(durationSeconds, true)} tập trung. Bạn có thể chủ động bắt đầu nghỉ hoặc học tiếp.`;
      toast(`Đã ghi nhận ${formatDuration(durationSeconds, true)} vào nhiệm vụ.`, 'success');
      selectedMode = 'break';
    } else if (timer.mode === 'break') {
      lastTimerMessage = early ? 'Đã kết thúc nghỉ. Sẵn sàng cho một phiên học mới?' : 'Hết giờ nghỉ. Sẵn sàng quay lại nhiệm vụ của bạn?';
      selectedMode = 'focus';
      toast('Đã kết thúc phiên nghỉ. Thời gian nghỉ không cộng vào tiến độ.', 'success');
    } else {
      lastTimerMessage = 'Phiên chưa có thời gian tập trung để ghi nhận.';
      selectedMode = 'focus';
    }
    state.activeTimer = null;
    return true;
  }

  function finishTimer(early = true) {
    if (completingTimer) return;
    completingTimer = true;
    const timerId = state.activeTimer && state.activeTimer.id;
    transact(() => {
      if (!state.activeTimer || state.activeTimer.id !== timerId) return false;
      if (!early && timerElapsed(state.activeTimer) < state.activeTimer.durationSeconds) return false;
      return recordFinishedTimer(early);
    }).finally(() => { completingTimer = false; });
  }

  async function cancelTimer() {
    const timerId = state.activeTimer && state.activeTimer.id;
    if (!timerId) return;
    const accepted = await askConfirm('Hủy phiên hiện tại?', 'Toàn bộ thời gian của phiên này sẽ không được ghi nhận vào nhiệm vụ.', 'Hủy phiên', true);
    if (!accepted) return;
    transact(() => {
      if (!state.activeTimer || state.activeTimer.id !== timerId) return false;
      state.activeTimer = null;
      lastTimerMessage = 'Đã hủy phiên. Không có thời gian nào được ghi nhận.';
      toast('Đã hủy phiên hiện tại.', 'warning');
    });
  }

  function tick() {
    const day = localDate();
    if (day !== todayKey) {
      todayKey = day;
      renderAll();
    }
    if (state.activeTimer && timerElapsed(state.activeTimer) >= state.activeTimer.durationSeconds) {
      finishTimer(false);
      return;
    }
    renderTimerClock();
  }

  function readSettingsInputs() {
    const focus = Number($('focus-minutes').value);
    const rest = Number($('break-minutes').value);
    const invalidFocus = !Number.isInteger(focus) || focus < 1 || focus > 180;
    const invalidBreak = !Number.isInteger(rest) || rest < 1 || rest > 60;
    $('focus-minutes').setAttribute('aria-invalid', String(invalidFocus));
    $('break-minutes').setAttribute('aria-invalid', String(invalidBreak));
    $('focus-minutes').setAttribute('aria-describedby', 'settings-error');
    $('break-minutes').setAttribute('aria-describedby', 'settings-error');
    $('settings-error').hidden = !invalidFocus && !invalidBreak;
    if (invalidFocus || invalidBreak) {
      $('settings-error').textContent = 'Tập trung: 1–180 phút. Nghỉ: 1–60 phút. Vui lòng nhập số nguyên.';
      $(invalidFocus ? 'focus-minutes' : 'break-minutes').focus();
      return null;
    }
    $('settings-error').textContent = '';
    return { focusMinutes: focus, breakMinutes: rest };
  }

  /* 4. Render: nội dung người dùng luôn đi qua textContent. */
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `icon ${className}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', '0 0 24 24');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function actionButton(label, action, taskId, style = 'btn-secondary', iconName) {
    const button = node('button', `btn btn-small ${style}`);
    button.type = 'button';
    button.dataset.action = action;
    if (taskId) button.dataset.taskId = taskId;
    if (iconName) button.append(icon(iconName));
    button.append(node('span', '', label));
    return button;
  }

  function iconButton(label, action, taskId, iconName, extraClass = '') {
    const button = node('button', `icon-button ${extraClass}`.trim());
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.taskId = taskId;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(icon(iconName));
    return button;
  }

  function subjectColor(subject) {
    const colors = ['#6366F1', '#0891B2', '#B45309', '#7C3AED', '#059669', '#DB2777'];
    let hash = 0;
    for (const character of subject) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function renderTask(task, context = 'tasks') {
    const plan = planTask(task);
    const completed = task.status === 'completed';
    const card = node('article', `task-card${plan.overdue ? ' is-overdue' : ''}${completed ? ' is-completed' : ''}`);
    const main = node('div', 'task-main');
    const heading = node('div', 'task-heading');
    const tag = node('span', 'subject-tag', task.subject);
    tag.style.setProperty('--subject-color', subjectColor(task.subject));
    heading.append(tag);
    if (completed) heading.append(node('span', 'badge badge-success', 'Đã hoàn thành'));
    else if (plan.ready) heading.append(node('span', 'badge badge-success', 'Đã đủ thời lượng'));
    else if (plan.overdue) heading.append(node('span', 'badge badge-warning', 'Quá hạn'));
    else if (task.deadline === localDate()) heading.append(node('span', 'badge badge-warning', 'Đến hạn hôm nay'));
    main.append(heading, node('h3', 'task-title', task.title));
    const metadata = node('div', 'task-meta');
    const deadline = node('span', 'task-deadline');
    deadline.append(icon('calendar'), document.createTextNode(deadlineLabel(task.deadline)));
    metadata.append(deadline);
    if (context !== 'tasks' && !completed) {
      const suggestion = node('span', `task-suggestion${plan.overdue ? ' is-warning' : ''}`);
      suggestion.append(icon('clock'), document.createTextNode(plan.ready ? 'Chờ bạn xác nhận' : plan.overdue ? `Còn ${formatDuration(plan.remaining)}` : `Hôm nay: ${formatDuration(plan.suggested)}`));
      metadata.append(suggestion);
    }
    main.append(metadata);
    const progressRow = node('div', 'task-progress-row');
    progressRow.append(node('span', 'task-estimate', `${formatDuration(plan.studied)} / ${formatDuration(task.estimatedSeconds)}`), node('span', 'task-percent', `${plan.percent}%`));
    const track = node('div', 'progress-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `Tiến độ ${task.title}`);
    track.setAttribute('aria-valuenow', String(plan.percent));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = node('div', 'progress-fill');
    fill.style.width = `${plan.percent}%`;
    track.append(fill);
    main.append(progressRow, track);
    if (plan.ready) main.append(node('p', 'task-ready-note', 'Đã đủ thời lượng dự kiến. Xác nhận hoàn thành hoặc tăng ước tính nếu bạn cần học thêm.'));
    const footer = node('div', 'task-footer');
    const actions = node('div', 'task-actions');
    if (!completed) actions.append(actionButton('Bắt đầu học', 'study-task', task.id, 'btn-primary', 'play'));
    else actions.append(actionButton('Mở lại', 'reopen-task', task.id, 'btn-secondary', 'refresh'));
    const tools = node('div', 'task-tools');
    if (!completed) tools.append(iconButton('Xác nhận hoàn thành nhiệm vụ', 'complete-task', task.id, 'check'));
    tools.append(iconButton('Sửa nhiệm vụ', 'edit-task', task.id, 'edit'), iconButton('Xóa nhiệm vụ', 'delete-task', task.id, 'trash', 'delete-button'));
    actions.append(tools);
    footer.append(actions);
    card.append(main, footer);
    return card;
  }

  function emptyState(title, description, onboarding = false) {
    const empty = node('div', 'empty-state');
    const illustration = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    illustration.setAttribute('viewBox', '0 0 240 160');
    illustration.setAttribute('class', 'empty-illustration');
    illustration.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#illustration-empty');
    illustration.append(use);
    empty.append(illustration, node('h3', '', title), node('p', '', description));
    if (onboarding) {
      const actions = node('div', 'empty-actions');
      actions.append(actionButton('Thêm nhiệm vụ đầu tiên', 'add-task', '', 'btn-primary', 'plus'));
      if (!state.settings.sampleUsed) actions.append(actionButton('Dùng dữ liệu mẫu', 'sample-data', '', 'btn-ghost', 'arrow-right'));
      empty.append(actions);
    }
    return empty;
  }

  function renderToday() {
    const active = orderedTasks(state.tasks.filter((task) => task.status === 'active'));
    const regular = active.filter((task) => { const plan = planTask(task); return !plan.overdue && !plan.ready; });
    const overdue = active.filter((task) => { const plan = planTask(task); return plan.overdue && !plan.ready; });
    const ready = active.filter((task) => planTask(task).ready);
    const todaySessions = state.sessions.filter((session) => secondsForDay(session, todayKey) > 0);
    const focused = todaySessions.reduce((sum, session) => sum + secondsForDay(session, todayKey), 0);
    const suggested = regular.reduce((sum, task) => sum + planTask(task).suggested, 0);
    $('today-focus-value').textContent = formatDuration(focused);
    $('today-focus-note').textContent = todaySessions.length ? `${todaySessions.length} phiên học đã ghi nhận` : 'Mỗi phút tập trung đều có ý nghĩa';
    $('today-plan-value').textContent = formatDuration(suggested);
    $('today-plan-note').textContent = overdue.length ? `${overdue.length} nhiệm vụ quá hạn cần sắp xếp thêm` : 'Chia đều thời lượng còn lại đến hạn';
    $('active-task-value').textContent = String(active.length).padStart(2, '0');
    $('active-task-note').textContent = ready.length ? `${ready.length} nhiệm vụ chờ xác nhận hoàn thành` : 'Sẵn sàng để bạn từng bước hoàn thành';
    $('today-task-count').textContent = String(regular.length).padStart(2, '0');
    $('nav-task-count').textContent = String(active.length);
    $('today-list').replaceChildren();
    if (!state.tasks.length) $('today-list').append(emptyState('Một nhiệm vụ nhỏ. Một khởi đầu mới.', 'Thêm bài tập hoặc mục tiêu ôn thi. StudyFlow sẽ giúp bạn chia nhỏ việc học mỗi ngày.', true));
    else if (!regular.length) $('today-list').append(emptyState(active.length ? 'Hôm nay đã gọn gàng hơn rồi.' : 'Bạn đã hoàn thành mọi nhiệm vụ!', active.length ? 'Các nhiệm vụ quá hạn hoặc chờ xác nhận được hiển thị riêng bên dưới.' : 'Thêm nhiệm vụ mới khi bạn sẵn sàng cho mục tiêu tiếp theo.'));
    else $('today-list').append(...regular.map((task) => renderTask(task, 'today')));
    $('overdue-section').hidden = !overdue.length;
    $('overdue-list').replaceChildren(...overdue.map((task) => renderTask(task, 'overdue')));
    $('ready-section').hidden = !ready.length;
    $('ready-list').replaceChildren(...ready.map((task) => renderTask(task, 'ready')));
    $('today-session-count').textContent = `${todaySessions.length} phiên`;
    renderSessions($('today-sessions'), todaySessions, true, 3);
  }

  function renderTasks() {
    const search = $('task-search').value.trim().toLocaleLowerCase('vi');
    const status = $('task-status').value;
    const filtered = orderedTasks(state.tasks.filter((task) => {
      const searchable = `${task.title} ${task.subject}`.toLocaleLowerCase('vi');
      const matchesStatus = status === 'all' || task.status === status || (status === 'overdue' && planTask(task).overdue);
      return matchesStatus && searchable.includes(search);
    }));
    $('tasks-result-count').textContent = `${filtered.length} nhiệm vụ`;
    $('task-list').replaceChildren();
    if (!state.tasks.length) $('task-list').append(emptyState('Dành chỗ cho mục tiêu đầu tiên.', 'Thêm nhiệm vụ, chọn deadline và ước tính thời gian. Phần kế hoạch hãy để StudyFlow giúp bạn.', true));
    else if (!filtered.length) $('task-list').append(emptyState('Chưa tìm thấy nhiệm vụ phù hợp.', 'Thử tên môn học khác hoặc thay đổi bộ lọc trạng thái.'));
    else $('task-list').append(...filtered.map((task) => renderTask(task)));
  }

  function renderSessions(container, sessions, compact = false, limit = 8) {
    container.replaceChildren();
    const sorted = [...sessions].sort((a, b) => b.endedAt - a.endedAt).slice(0, limit);
    if (!sorted.length) {
      const empty = node('div', 'sessions-empty');
      empty.append(icon('leaf'), node('p', '', 'Chưa có phiên học nào hôm nay.'), node('span', '', 'Bắt đầu khi bạn sẵn sàng.'));
      container.append(empty);
      return;
    }
    for (const session of sorted) {
      const item = node('div', 'session-item');
      const visual = node('div', 'session-icon');
      visual.append(icon('check'));
      const info = node('div', 'session-info');
      info.append(node('p', 'session-title', compact ? session.subject : session.taskTitle));
      const time = new Date(session.endedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      info.append(node('span', 'session-time', compact ? `Hoàn tất lúc ${time}` : `${session.subject} · ${time}`));
      item.append(visual, info, node('span', 'session-duration', formatDuration(secondsForDay(session, todayKey), true)));
      container.append(item);
    }
  }

  function renderPomodoro() {
    const timer = state.activeTimer;
    const mode = timer ? timer.mode : selectedMode;
    const active = orderedTasks(state.tasks.filter((task) => task.status === 'active'));
    if (timer && timer.mode === 'focus') selectedTaskId = timer.taskId;
    if (!active.some((task) => task.id === selectedTaskId)) selectedTaskId = active.length ? active[0].id : '';
    const select = $('task-select');
    select.replaceChildren();
    if (!active.length) {
      const option = node('option', '', 'Thêm nhiệm vụ để bắt đầu học');
      option.value = '';
      select.append(option);
    } else {
      for (const task of active) {
        const option = node('option', '', `${task.subject} · ${task.title}`);
        option.value = task.id;
        select.append(option);
      }
      select.value = selectedTaskId;
    }
    select.disabled = !!timer || mode === 'break';
    $('focus-minutes').value = String(state.settings.focusMinutes);
    $('break-minutes').value = String(state.settings.breakMinutes);
    $('focus-minutes').disabled = !!timer;
    $('break-minutes').disabled = !!timer;
    for (const button of [$('mode-focus'), $('mode-break')]) {
      const chosen = button.dataset.mode === mode;
      button.classList.toggle('is-active', chosen);
      button.setAttribute('aria-pressed', String(chosen));
      button.disabled = !!timer;
    }
    const task = active.find((item) => item.id === selectedTaskId);
    $('timer-task-name').textContent = mode === 'break' ? 'Thả lỏng và nạp lại năng lượng' : task ? task.title : 'Chọn nhiệm vụ, bắt đầu một bước nhỏ';
    const plan = task ? planTask(task) : null;
    $('pomo-task-progress').style.width = `${plan ? plan.percent : 0}%`;
    const progressTrack = $('pomo-task-progress').parentElement;
    progressTrack.setAttribute('role', 'progressbar');
    progressTrack.setAttribute('aria-label', 'Tiến độ nhiệm vụ được chọn');
    progressTrack.setAttribute('aria-valuemin', '0');
    progressTrack.setAttribute('aria-valuemax', '100');
    progressTrack.setAttribute('aria-valuenow', String(plan ? plan.percent : 0));
    $('pomo-task-detail').textContent = task ? `${task.subject} · ${formatDuration(plan.studied)} / ${formatDuration(task.estimatedSeconds)} · ${plan.percent}%` : 'Thời gian tập trung sẽ được ghi nhận vào nhiệm vụ bạn chọn.';
    $('timer-start').hidden = !!timer;
    $('timer-start').disabled = mode === 'focus' && !task;
    $('timer-start').replaceChildren(icon(mode === 'break' ? 'coffee' : 'play'), node('span', '', mode === 'break' ? 'Bắt đầu nghỉ' : 'Bắt đầu tập trung'));
    $('timer-pause').hidden = !timer || timer.status !== 'running';
    $('timer-resume').hidden = !timer || timer.status !== 'paused';
    $('timer-finish').hidden = !timer;
    $('timer-cancel').hidden = !timer;
    $('timer-message').textContent = lastTimerMessage || (timer ? 'Chuyển màn hình hay tải lại trang, phiên của bạn vẫn được giữ.' : mode === 'break' ? 'Thời gian nghỉ không được tính vào tiến độ học tập.' : 'Hoàn tất phiên học sẽ ghi nhận thời gian. Bạn tự xác nhận khi hoàn thành nhiệm vụ.');
    $('mini-focus-button').textContent = timer ? 'Trở lại phiên hiện tại' : 'Bắt đầu tập trung';
    const todaySessions = state.sessions.filter((session) => secondsForDay(session, todayKey) > 0);
    $('session-count').textContent = `${todaySessions.length} phiên`;
    renderSessions($('session-list'), todaySessions);
    lastRenderedSecond = '';
    renderTimerClock();
  }

  function renderTimerClock() {
    const timer = state.activeTimer;
    const mode = timer ? timer.mode : selectedMode;
    const total = timer ? timer.durationSeconds : (mode === 'focus' ? state.settings.focusMinutes : state.settings.breakMinutes) * 60;
    const elapsed = timer ? timerElapsed(timer) : 0;
    const remaining = Math.max(0, total - elapsed);
    const clock = formatClock(remaining);
    const renderingKey = `${clock}-${mode}-${timer ? timer.status : 'idle'}`;
    if (lastRenderedSecond === renderingKey) return;
    lastRenderedSecond = renderingKey;
    $('timer-display').textContent = clock;
    $('timer-phase').textContent = mode === 'focus' ? 'THỜI GIAN TẬP TRUNG' : 'THỜI GIAN NGHỈ NGƠI';
    $('timer-status').textContent = timer ? timer.status === 'paused' ? 'Đã tạm dừng' : mode === 'focus' ? 'Từng phút, gần mục tiêu hơn' : 'Hít thở và thư giãn một chút' : 'Sẵn sàng khi bạn muốn';
    $('timer-progress').style.strokeDasharray = '703.716';
    $('timer-progress').style.strokeDashoffset = String(703.716 * (elapsed / total));
    $('timer-progress').classList.toggle('is-break', mode === 'break');
    $('mini-timer-label').textContent = timer ? timer.mode === 'focus' ? 'PHIÊN TẬP TRUNG HIỆN TẠI' : 'PHIÊN NGHỈ HIỆN TẠI' : 'MỘT PHIÊN, MỘT BƯỚC TIẾN';
    $('mini-timer-time').textContent = timer ? clock : formatClock(state.settings.focusMinutes * 60);
    $('mini-timer-note').textContent = timer ? timer.status === 'paused' ? 'Phiên của bạn đang tạm dừng' : timer.mode === 'focus' ? 'Cứ tập trung, StudyFlow giữ thời gian' : 'Cho bản thân một khoảng nghỉ' : `${state.settings.focusMinutes} phút tập trung · ${state.settings.breakMinutes} phút nghỉ`;
    $('sidebar-timer').hidden = !timer;
    $('sidebar-timer-time').textContent = clock;
    document.title = timer ? `${clock} · ${mode === 'focus' ? 'Tập trung' : 'Nghỉ ngơi'} · StudyFlow` : 'StudyFlow — Học đúng kế hoạch';
  }

  function renderNavigation() {
    const titles = {
      today: ['Hôm nay, học gì?', 'Học đúng kế hoạch, hoàn thành đúng hạn.'],
      tasks: ['Nhiệm vụ của bạn', 'Sắp xếp việc học, dành chỗ cho những điều quan trọng.'],
      pomodoro: ['Đến giờ tập trung', 'Một nhiệm vụ. Một phiên học. Tiến gần mục tiêu hơn.']
    };
    $('page-title').textContent = titles[currentView][0];
    $('page-description').textContent = titles[currentView][1];
    for (const button of document.querySelectorAll('[data-view]')) {
      const selected = button.dataset.view === currentView;
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const view of ['today', 'tasks', 'pomodoro']) $('view-' + view).hidden = view !== currentView;
    const dateText = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('current-date').textContent = dateText.charAt(0).toUpperCase() + dateText.slice(1);
  }

  function renderAll() {
    todayKey = localDate();
    $('local-storage-label').textContent = storageAvailable ? 'Lưu trên trình duyệt của bạn' : 'Chỉ lưu tạm trong phiên này';
    $('local-storage-status').classList.toggle('is-temporary', !storageAvailable);
    renderNavigation();
    renderToday();
    renderTasks();
    renderPomodoro();
  }

  function navigate(view) {
    if (!['today', 'tasks', 'pomodoro'].includes(view)) return;
    currentView = view;
    renderNavigation();
    if (view === 'pomodoro') renderPomodoro();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function toast(message, kind = 'success') {
    const container = $('toast-container');
    if (!container) return;
    const item = node('div', `toast toast-${kind}`);
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    item.append(icon(kind === 'success' ? 'check-circle' : 'alert'), node('span', '', message));
    container.append(item);
    setTimeout(() => item.remove(), kind === 'error' ? 9000 : 5500);
  }

  /* 5. Biểu mẫu, modal và sự kiện. */
  function openTaskDialog(taskId = '') {
    refreshFromStorage();
    const task = state.tasks.find((item) => item.id === taskId);
    dialogReturnFocus = document.activeElement;
    $('task-form').reset();
    $('task-id').value = task ? task.id : '';
    $('task-dialog-title').textContent = task ? 'Chỉnh sửa nhiệm vụ' : 'Thêm nhiệm vụ mới';
    $('save-task').textContent = task ? 'Lưu thay đổi' : 'Thêm nhiệm vụ';
    $('task-name').value = task ? task.title : '';
    $('task-subject').value = task ? task.subject : '';
    $('task-deadline').value = task ? task.deadline : localDate();
    if (task) $('task-deadline').removeAttribute('min');
    else $('task-deadline').min = localDate();
    $('task-hours').value = task ? String(Math.floor(task.estimatedSeconds / 3600)) : '1';
    $('task-minutes').value = task ? String(Math.floor((task.estimatedSeconds % 3600) / 60)) : '0';
    $('task-form-error').textContent = '';
    $('task-form-error').hidden = true;
    for (const field of ['task-name', 'task-subject', 'task-deadline', 'task-hours', 'task-minutes']) $(field).removeAttribute('aria-invalid');
    $('task-dialog').showModal();
    $('task-name').focus();
  }

  function closeTaskDialog() {
    $('task-dialog').close();
  }

  function submitTask(event) {
    event.preventDefault();
    const id = $('task-id').value;
    const title = $('task-name').value.trim();
    const subject = $('task-subject').value.trim();
    const deadline = $('task-deadline').value;
    const hours = Number($('task-hours').value);
    const minutes = Number($('task-minutes').value);
    let error = '';
    let invalidField = '';
    for (const field of ['task-name', 'task-subject', 'task-deadline', 'task-hours', 'task-minutes']) $(field).removeAttribute('aria-invalid');
    if (!title || !subject) { error = 'Vui lòng nhập tên công việc và môn học.'; invalidField = !title ? 'task-name' : 'task-subject'; }
    else if (title.length > 200 || subject.length > 100) { error = 'Tên công việc tối đa 200 ký tự; môn học tối đa 100 ký tự.'; invalidField = title.length > 200 ? 'task-name' : 'task-subject'; }
    else if (!validDate(deadline)) { error = 'Vui lòng chọn một ngày deadline hợp lệ.'; invalidField = 'task-deadline'; }
    else if (!id && deadline < localDate()) { error = 'Nhiệm vụ mới cần có deadline từ hôm nay trở đi.'; invalidField = 'task-deadline'; }
    else if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 9999 || minutes < 0 || minutes > 59 || hours * 3600 + minutes * 60 <= 0) {
      error = 'Thời lượng phải lớn hơn 0; giờ từ 0–9999, phút từ 0–59.';
      invalidField = !Number.isInteger(minutes) || minutes < 0 || minutes > 59 ? 'task-minutes' : 'task-hours';
    }
    if (error) {
      $('task-form-error').textContent = error;
      $('task-form-error').hidden = false;
      $(invalidField).setAttribute('aria-invalid', 'true');
      $(invalidField).setAttribute('aria-describedby', 'task-form-error');
      $(invalidField).focus();
      return;
    }
    $('task-form-error').hidden = true;
    transact(() => {
      const existing = state.tasks.find((item) => item.id === id);
      if (id && !existing) {
        $('task-form-error').textContent = 'Nhiệm vụ này đã được xóa ở cửa sổ khác.';
        $('task-form-error').hidden = false;
        return false;
      }
      const values = { title, subject, deadline, estimatedSeconds: hours * 3600 + minutes * 60 };
      if (existing) Object.assign(existing, values);
      else state.tasks.push({ id: uid(), ...values, createdAt: Date.now(), status: 'active' });
      closeTaskDialog();
      toast(existing ? 'Đã lưu thay đổi nhiệm vụ.' : 'Đã thêm nhiệm vụ. Kế hoạch của bạn đã được cập nhật.');
    });
  }

  function askConfirm(title, message, acceptText, dangerous = false) {
    if ($('confirm-dialog').open) return Promise.resolve(false);
    confirmReturnFocus = document.activeElement;
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-accept').textContent = acceptText;
    $('confirm-accept').classList.toggle('btn-danger', dangerous);
    $('confirm-accept').classList.toggle('btn-primary', !dangerous);
    $('confirm-dialog').showModal();
    $('confirm-cancel').focus();
    return new Promise((resolve) => { confirmResolver = resolve; });
  }

  function resolveConfirm(accepted) {
    const resolve = confirmResolver;
    confirmResolver = null;
    $('confirm-dialog').close();
    if (resolve) resolve(accepted);
  }

  function taskHasTimer(taskId) {
    return !!state.activeTimer && state.activeTimer.mode === 'focus' && state.activeTimer.taskId === taskId;
  }

  async function deleteTask(taskId) {
    refreshFromStorage();
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (taskHasTimer(taskId)) {
      toast('Hãy kết thúc hoặc hủy phiên hiện tại trước khi xóa nhiệm vụ này.', 'warning');
      return;
    }
    if (!await askConfirm('Xóa nhiệm vụ này?', `“${task.title}” sẽ được xóa. Các phiên học đã ghi nhận vẫn được giữ trong lịch sử.`, 'Xóa nhiệm vụ', true)) return;
    transact(() => {
      if (taskHasTimer(taskId)) {
        toast('Nhiệm vụ vừa bắt đầu một phiên ở cửa sổ khác. Hãy kết thúc phiên trước khi xóa.', 'warning');
        return false;
      }
      state.tasks = state.tasks.filter((item) => item.id !== taskId);
      toast('Đã xóa nhiệm vụ. Lịch sử học tập vẫn được giữ.');
    });
  }

  async function completeTask(taskId) {
    refreshFromStorage();
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== 'active') return;
    if (taskHasTimer(taskId)) {
      toast('Hãy kết thúc hoặc hủy phiên hiện tại trước khi hoàn thành nhiệm vụ.', 'warning');
      return;
    }
    if (!await askConfirm('Hoàn thành nhiệm vụ?', `Bạn đã hoàn thành “${task.title}”? Nhiệm vụ sẽ được đưa ra khỏi kế hoạch học. Thao tác này không cộng thêm thời gian học.`, 'Xác nhận hoàn thành')) return;
    transact(() => {
      if (taskHasTimer(taskId)) {
        toast('Hãy kết thúc phiên hiện tại trước khi hoàn thành nhiệm vụ.', 'warning');
        return false;
      }
      const current = state.tasks.find((item) => item.id === taskId);
      if (!current) return false;
      current.status = 'completed';
      toast('Đã hoàn thành nhiệm vụ. Chúc mừng một bước tiến của bạn!');
    });
  }

  function studyTask(taskId) {
    refreshFromStorage();
    const task = state.tasks.find((item) => item.id === taskId && item.status === 'active');
    if (!task) return;
    if (state.activeTimer) {
      if (state.activeTimer.mode !== 'focus' || state.activeTimer.taskId !== taskId) toast('Bạn đang có một phiên khác. Hãy kết thúc hoặc hủy phiên đó trước khi đổi nhiệm vụ.', 'warning');
    } else {
      selectedTaskId = taskId;
      selectedMode = 'focus';
      lastTimerMessage = '';
    }
    navigate('pomodoro');
  }

  function addSampleData() {
    transact(() => {
      if (state.tasks.length || state.settings.sampleUsed) {
        toast('Dữ liệu mẫu chỉ được thêm chủ động một lần khi danh sách còn trống.', 'warning');
        return false;
      }
      const now = Date.now();
      state.tasks.push(
        { id: uid(), title: 'Ôn tập chương 1: Giới hạn và liên tục', subject: 'Giải tích', deadline: offsetDate(2), estimatedSeconds: 21600, createdAt: now, status: 'active' },
        { id: uid(), title: 'Hoàn thành bài tập cấu trúc dữ liệu', subject: 'Lập trình', deadline: offsetDate(4), estimatedSeconds: 10800, createdAt: now + 1, status: 'active' },
        { id: uid(), title: 'Luyện đọc và ghi chú từ vựng', subject: 'Tiếng Anh', deadline: offsetDate(6), estimatedSeconds: 7200, createdAt: now + 2, status: 'active' }
      );
      state.settings.sampleUsed = true;
      toast('Đã thêm 3 nhiệm vụ mẫu. Chưa có thời gian học nào được ghi nhận.');
    });
  }

  function bindEvents() {
    $('task-dialog').setAttribute('aria-labelledby', 'task-dialog-title');
    $('confirm-dialog').setAttribute('aria-labelledby', 'confirm-title');
    $('confirm-dialog').setAttribute('aria-describedby', 'confirm-message');
    const brand = document.querySelector('.brand[href="#today"]');
    if (brand) brand.addEventListener('click', (event) => { event.preventDefault(); navigate('today'); });
    document.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.view) navigate(target.dataset.view);
      if (target.hasAttribute('data-close-dialog')) {
        if (target.closest('dialog') === $('confirm-dialog')) resolveConfirm(false);
        else closeTaskDialog();
      }
      const taskId = target.dataset.taskId;
      switch (target.dataset.action) {
        case 'add-task': openTaskDialog(); break;
        case 'edit-task': openTaskDialog(taskId); break;
        case 'delete-task': deleteTask(taskId); break;
        case 'complete-task': completeTask(taskId); break;
        case 'reopen-task': transact(() => {
          const task = state.tasks.find((item) => item.id === taskId);
          if (!task) return false;
          task.status = 'active';
          toast('Đã mở lại nhiệm vụ và cập nhật kế hoạch.');
        }); break;
        case 'study-task': studyTask(taskId); break;
        case 'sample-data': addSampleData(); break;
        case 'open-pomodoro': navigate('pomodoro'); break;
        default: break;
      }
      if (target.dataset.mode && !state.activeTimer) {
        const settings = readSettingsInputs();
        if (!settings) return;
        selectedMode = target.dataset.mode;
        lastTimerMessage = '';
        transact(() => {
          if (state.activeTimer) return false;
          Object.assign(state.settings, settings);
        });
      }
    });
    $('task-search').addEventListener('input', renderTasks);
    $('task-status').addEventListener('change', renderTasks);
    $('task-form').addEventListener('submit', submitTask);
    $('task-select').addEventListener('change', () => {
      selectedTaskId = $('task-select').value;
      renderPomodoro();
    });
    for (const input of [$('focus-minutes'), $('break-minutes')]) input.addEventListener('change', () => {
      const settings = readSettingsInputs();
      if (!settings) return;
      transact(() => {
        if (state.activeTimer) return false;
        Object.assign(state.settings, settings);
      });
    });
    $('timer-start').addEventListener('click', startTimer);
    $('timer-pause').addEventListener('click', pauseTimer);
    $('timer-resume').addEventListener('click', resumeTimer);
    $('timer-finish').addEventListener('click', () => finishTimer(true));
    $('timer-cancel').addEventListener('click', cancelTimer);
    $('confirm-accept').addEventListener('click', () => resolveConfirm(true));
    $('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
    $('confirm-dialog').addEventListener('cancel', (event) => { event.preventDefault(); resolveConfirm(false); });
    $('task-dialog').addEventListener('close', () => {
      const target = dialogReturnFocus && dialogReturnFocus.isConnected ? dialogReturnFocus : document.querySelector('[data-action="add-task"]');
      if (target) target.focus();
    });
    $('confirm-dialog').addEventListener('close', () => {
      const target = confirmReturnFocus && confirmReturnFocus.isConnected ? confirmReturnFocus : document.querySelector('[data-action="add-task"]');
      if (target) target.focus();
    });
    // Native modal dialogs trap Tab and handle Escape; backdrop clicks close only outside the dialog box.
    for (const dialog of [$('task-dialog'), $('confirm-dialog')]) dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        if (dialog === $('confirm-dialog')) resolveConfirm(false);
        else closeTaskDialog();
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      if (!storageAvailable) return;
      try {
        state = event.newValue === null ? freshState() : normalizeState(JSON.parse(event.newValue));
        renderAll();
        tick();
      } catch (_) {
        toast('Một cửa sổ khác đã lưu dữ liệu không hợp lệ. Phiên hiện tại vẫn được giữ.', 'warning');
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshFromStorage();
        renderAll();
        tick();
      }
    });
    window.addEventListener('focus', () => {
      refreshFromStorage();
      renderAll();
      tick();
    });
  }

  state = loadState();
  bindEvents();
  renderAll();
  tick();
  setInterval(tick, 250);
  if (initialNotice) toast(initialNotice, 'warning');

  // Read-only diagnostics make the date and planning rules inspectable without modifying application data.
  window.StudyFlow = Object.freeze({
    getState: () => JSON.parse(JSON.stringify(state)),
    localDate, dayIndex, validDate, formatDuration, timerElapsed, secondsForDay,
    planTask: (task, date) => ({ ...planTask(task, date) })
  });
})();
