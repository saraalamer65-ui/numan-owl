(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  function onMediaChange(mq, fn) {
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  const pad = (n) => String(n).padStart(2, '0');
  function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const todayKey = () => dayKey(new Date());

  // Arabic count phrase: 0 / 1 / 2 / 3–10 / 11+
  function countTasks(n) {
    if (n === 0) return 'ولا مهمة';
    if (n === 1) return 'مهمة وحدة';
    if (n === 2) return 'مهمتين';
    if (n <= 10) return `${n} مهام`;
    return `${n} مهمة`;
  }

  // Parse "YYYY-MM-DD" as a local date; null if invalid.
  function parseDay(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  function addDays(key, n) {
    const date = parseDay(key);
    date.setDate(date.getDate() + n);
    return dayKey(date);
  }
  // Whole days from `a` to `b` (both day keys).
  function daysBetween(a, b) {
    return Math.round((parseDay(b) - parseDay(a)) / 86400000);
  }

  // ---------- Data model ----------
  const CATEGORIES = { scripts: 'سكريبتات', design: 'تصميم', store: 'المتجر', comms: 'تواصل', other: 'أخرى' };
  const PRIORITIES = { urgent: 'عاجلة', normal: 'عادية', light: 'خفيفة' };
  const PRIORITY_RANK = { urgent: 0, normal: 1, light: 2 };

  const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const isCount = (n) => Number.isInteger(n) && n >= 0;

  // Returns a clean task, or a string describing what is wrong with it.
  function cleanTask(t) {
    if (!t || typeof t !== 'object') return 'ليست كائنًا';
    if (typeof t.id !== 'string' || !t.id) return 'بدون معرّف';
    if (typeof t.title !== 'string' || !t.title.trim()) return 'بدون عنوان';
    if (!(t.category in CATEGORIES)) return 'فئتها غير معروفة';
    if (!(t.priority in PRIORITIES)) return 'أولويتها غير معروفة';
    if (t.due != null && !parseDay(t.due)) return 'موعدها غير صحيح';
    if (typeof t.done !== 'boolean') return 'حالة الإنجاز غير صحيحة';
    return {
      id: t.id,
      title: t.title.trim().slice(0, 200),
      category: t.category,
      priority: t.priority,
      due: t.due || null,
      done: t.done,
      doneAt: t.done && typeof t.doneAt === 'number' ? t.doneAt : (t.done ? Date.now() : null),
      awarded: t.awarded === true,
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
    };
  }

  // Strict check used for imports. Returns { data } or { error }.
  function validateData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'الملف ما فيه بيانات نومان.' };
    if (obj.app !== undefined && obj.app !== 'numan') return { error: 'هذا الملف لتطبيق ثاني، مو لنومان.' };
    if (!Array.isArray(obj.tasks)) return { error: 'الملف ما فيه قائمة مهام.' };
    if (obj.tasks.length > 5000) return { error: 'عدد المهام في الملف كبير بشكل غير منطقي.' };
    const tasks = [];
    const ids = new Set();
    for (let i = 0; i < obj.tasks.length; i++) {
      const res = cleanTask(obj.tasks[i]);
      if (typeof res === 'string') return { error: `المهمة رقم ${i + 1} ${res}.` };
      if (ids.has(res.id)) return { error: `المهمة رقم ${i + 1} مكررة.` };
      ids.add(res.id);
      tasks.push(res);
    }
    const points = obj.points ?? 0;
    const streak = obj.streak ?? 0;
    if (!isCount(points)) return { error: 'النقاط في الملف غير صحيحة.' };
    if (!isCount(streak)) return { error: 'السلسلة في الملف غير صحيحة.' };
    const lastDoneDay = obj.lastDoneDay ?? null;
    if (lastDoneDay !== null && !parseDay(lastDoneDay)) return { error: 'تاريخ آخر إنجاز غير صحيح.' };
    const theme = obj.theme === 'light' || obj.theme === 'dark' ? obj.theme : null;
    return { data: { version: 1, tasks, points, streak, lastDoneDay, theme } };
  }

  // ---------- Storage ----------
  const STORAGE_KEY = 'numan.v1';

  const defaults = () => ({
    version: 1,
    tasks: [],
    points: 0,
    streak: 0,
    lastDoneDay: null,
    theme: null,
  });

  // Returns { data } when something usable is stored, { empty: true } on first run.
  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return { empty: true };
    }
    if (!raw) return { empty: true };
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { data: defaults() };
    }
    if (!parsed || typeof parsed !== 'object') return { data: defaults() };
    // Keep whatever is valid instead of throwing everything away.
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map(cleanTask).filter((t) => typeof t !== 'string')
      : [];
    const res = validateData(Object.assign({}, parsed, { tasks }));
    return { data: res.data || Object.assign(defaults(), { tasks }) };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Storage full or blocked: the page keeps working for this visit.
    }
  }

  function seedTasks() {
    const today = todayKey();
    const now = Date.now();
    const make = (title, category, priority, due, i) => ({
      id: newId() + i, title, category, priority, due,
      done: false, doneAt: null, awarded: false, createdAt: now + i,
    });
    return [
      make('تعديل سكريبت رسالة الترحيب للعملاء', 'scripts', 'urgent', addDays(today, -1), 0),
      make('تصميم بنر عرض نهاية الأسبوع', 'design', 'normal', today, 1),
      make('الرد على رسائل العملاء', 'comms', 'light', null, 2),
      make('رفع المنتجات الجديدة على المتجر', 'store', 'normal', addDays(today, 3), 3),
    ];
  }

  const loaded = loadState();
  const firstRun = Boolean(loaded.empty);
  let state = firstRun ? Object.assign(defaults(), { tasks: seedTasks() }) : loaded.data;
  if (firstRun) saveState();

  // ---------- Theme ----------
  const root = document.documentElement;
  const themeBtn = $('#themeBtn');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function effectiveTheme() {
    if (state.theme) return state.theme;
    if (root.dataset.theme === 'dark' || root.dataset.theme === 'light') return root.dataset.theme;
    return darkScheme.matches ? 'dark' : 'light';
  }

  let themeSetHere = false;

  function applyTheme() {
    if (state.theme) {
      root.dataset.theme = state.theme;
      themeSetHere = true;
    } else if (themeSetHere) {
      delete root.dataset.theme;
      themeSetHere = false;
    }
    const theme = effectiveTheme();
    themeBtn.dataset.show = theme === 'dark' ? 'sun' : 'moon';
    themeBtn.setAttribute('aria-label', theme === 'dark' ? 'التبديل للمظهر الفاتح' : 'التبديل للمظهر الداكن');
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#0b0536' : '#f6f2ff');
  }

  themeBtn.addEventListener('click', () => {
    state.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    saveState();
    applyTheme();
  });
  onMediaChange(darkScheme, applyTheme);

  // ---------- Owl ----------
  const owlBtn = $('#owlBtn');
  const bubble = $('#bubble');
  const sleepBtn = $('#sleepBtn');

  const OWL_LABELS = {
    sleeping: 'نومان نايم، اضغط عشان يصحى',
    awake: 'نومان صاحي، اضغط عشان يكلمك',
    happy: 'نومان مبسوط',
    worried: 'نومان قلقان',
  };

  let owlState = 'sleeping';
  let moodTimer = 0;
  let stretchTimer = 0;

  function setOwl(next) {
    owlState = next;
    owlBtn.dataset.state = next;
    owlBtn.setAttribute('aria-label', OWL_LABELS[next]);
  }

  // Show a mood for a while, then settle back to awake.
  function showMood(mood, ms) {
    clearTimeout(moodTimer);
    setOwl(mood);
    moodTimer = setTimeout(() => setOwl('awake'), ms);
  }

  function say(text) {
    bubble.textContent = text;
    bubble.classList.remove('pop');
    void bubble.offsetWidth; // restart the pop animation
    bubble.classList.add('pop');
  }

  function stretch() {
    clearTimeout(stretchTimer);
    owlBtn.classList.remove('stretching');
    if (reduceMotion.matches) return;
    void owlBtn.offsetWidth;
    owlBtn.classList.add('stretching');
    stretchTimer = setTimeout(() => owlBtn.classList.remove('stretching'), 1200);
  }

  // ---------- Greetings ----------
  const GREETINGS = [
    { from: 4, to: 11, lines: [
      'صباح الخير يا بطل! يلا نشدّ الحيل اليوم',
      'صباح الورد! نومان صحى وجاهز للشغل',
      'صباح الخير! قهوتك جاهزة؟ خلنا نبدأ',
    ] },
    { from: 12, to: 14, lines: [
      'هلا والله! الظهر وصل، وش سوّينا للحين؟',
      'يا هلا! نص اليوم راح، والنص الثاني أحلى',
    ] },
    { from: 15, to: 17, lines: [
      'عصرية سعيدة! وقت الشاهي والإنجاز',
      'هلا بالعصرية! خلنا نخلّص اللي باقي',
    ] },
    { from: 18, to: 22, lines: [
      'مساء الخير! بقى شوي ونسكّر اليوم',
      'مساء الورد! وش رأيك نختم بمهمة خفيفة؟',
    ] },
    { from: 23, to: 27, lines: [
      'سهران للحين؟ أنا البومة هنا مو أنت!',
      'الليل طويل… مهمة وحدة وبعدها نوم، اتفقنا؟',
    ] },
  ];

  function greeting(date = new Date()) {
    let h = date.getHours();
    if (h < 4) h += 24;
    const slot = GREETINGS.find((g) => h >= g.from && h <= g.to) || GREETINGS[0];
    return pick(slot.lines);
  }

  const AWAKE_CHATTER = [
    'أنا صاحي ومركّز معك!',
    'نومان بالخدمة',
    'عيوني عليك… قصدي على مهامك',
  ];

  // Today's open tasks: due today, overdue, or without a date.
  function todaySummary() {
    const today = todayKey();
    const open = state.tasks.filter((t) => !t.done && (!t.due || t.due <= today));
    const overdue = open.filter((t) => t.due && t.due < today).length;
    if (open.length === 0) return 'ما عندك مهام اليوم، رايق!';
    let text = `عندك اليوم ${countTasks(open.length)}`;
    if (overdue > 0) text += `، منها ${overdue === 1 ? 'وحدة متأخرة' : overdue === 2 ? 'ثنتين متأخرة' : `${overdue} متأخرة`}`;
    return text + '.';
  }

  // Join two sentences without doubling punctuation.
  function joinLines(a, b) {
    return /[.!?؟…]$/.test(a) ? `${a} ${b}` : `${a}. ${b}`;
  }

  const OVERDUE_LINES = [
    (t, late) => `ترى «${t}» ${late}… يمديك تخلّصها الحين؟`,
    (t, late) => `أحم أحم… «${t}» ${late}. أنا ما قلت شي بس`,
    (t, late) => `«${t}» ${late} وتناظرك بعيون حزينة. نخلصها؟`,
  ];

  // Gentle nudge about the most pressing overdue task, or '' if none.
  function overdueNudge() {
    const today = todayKey();
    const overdue = state.tasks.filter((t) => isOverdue(t, today)).sort((a, b) => compareTasks(a, b, today));
    if (!overdue.length) return '';
    const first = overdue[0];
    return pick(OVERDUE_LINES)(first.title, dueTag(first, today).text);
  }

  // Speak, and look worried for a moment if something is overdue.
  function talk(opening) {
    const nudge = overdueNudge();
    say(joinLines(opening, todaySummary()) + (nudge ? `\n${nudge}` : ''));
    clearTimeout(moodTimer);
    if (nudge) {
      // Let the wake-up stretch finish first.
      moodTimer = setTimeout(() => showMood('worried', 3500), owlBtn.classList.contains('stretching') ? 1200 : 0);
    }
  }

  function wake() {
    clearTimeout(moodTimer);
    setOwl('awake');
    stretch();
    talk(greeting());
  }

  owlBtn.addEventListener('click', () => {
    if (owlState === 'sleeping') wake();
    else talk(pick(AWAKE_CHATTER));
  });

  sleepBtn.addEventListener('click', () => {
    clearTimeout(moodTimer);
    owlBtn.classList.remove('stretching');
    setOwl('sleeping');
    say('تصبح على خير… نومان راح ينام');
  });

  // ---------- Tasks ----------
  const addForm = $('#addForm');
  const titleInput = $('#taskTitle');
  const categoryInput = $('#taskCategory');
  const dueInput = $('#taskDue');
  const addError = $('#addError');
  const taskList = $('#taskList');
  const emptyState = $('#emptyState');
  const taskPanel = $('#taskPanel');
  const tabs = Array.from(document.querySelectorAll('.tab'));

  const ICONS = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>',
  };

  const EMPTY_TEXT = {
    today: 'ما عندك شي اليوم. أضف مهمة أو ارتاح شوي.',
    upcoming: 'ما فيه مهام قادمة. حط لها موعد بعد اليوم وتطلع هنا.',
    done: 'لسا ما أنجزت شي… يلا أول وحدة!',
  };

  let activeTab = 'today';
  let renderedDay = todayKey();

  const isOverdue = (t, today) => !t.done && Boolean(t.due) && t.due < today;

  // Overdue first, then urgent, then nearest due date (undated last).
  function compareTasks(a, b, today) {
    const overdue = Number(!isOverdue(a, today)) - Number(!isOverdue(b, today));
    if (overdue) return overdue;
    const urgent = Number(a.priority !== 'urgent') - Number(b.priority !== 'urgent');
    if (urgent) return urgent;
    const ad = a.due || '9999-12-31';
    const bd = b.due || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank) return rank;
    return a.createdAt - b.createdAt;
  }

  function tasksFor(tab, today = todayKey()) {
    if (tab === 'done') {
      return state.tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
    }
    return state.tasks
      .filter((t) => !t.done && (tab === 'today' ? !t.due || t.due <= today : t.due && t.due > today))
      .sort((a, b) => compareTasks(a, b, today));
  }

  function formatDay(key) {
    try {
      return parseDay(key).toLocaleDateString('ar-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'long' });
    } catch (e) {
      return key;
    }
  }

  function countDays(n) {
    if (n === 1) return 'يوم';
    if (n === 2) return 'يومين';
    if (n <= 10) return `${n} أيام`;
    return `${n} يوم`;
  }

  function dueTag(t, today) {
    if (t.done) {
      const day = dayKey(new Date(t.doneAt));
      const diff = daysBetween(day, today);
      const text = diff === 0 ? 'أنجزتها اليوم' : diff === 1 ? 'أنجزتها أمس' : `أنجزتها ${formatDay(day)}`;
      return { text, cls: 'due-done' };
    }
    if (!t.due) return { text: 'بدون موعد', cls: '' };
    const diff = daysBetween(today, t.due);
    if (diff < 0) return { text: diff === -1 ? 'متأخرة من أمس' : `متأخرة ${countDays(-diff)}`, cls: 'due-overdue' };
    if (diff === 0) return { text: 'اليوم', cls: 'due-today' };
    if (diff === 1) return { text: 'بكرة', cls: '' };
    if (diff <= 6) return { text: `بعد ${countDays(diff)}`, cls: '' };
    return { text: formatDay(t.due), cls: '' };
  }

  function makeTag(text, cls) {
    const span = document.createElement('span');
    span.className = `tag ${cls}`.trim();
    span.textContent = text;
    return span;
  }

  function renderTask(t, today) {
    const li = document.createElement('li');
    li.className = 'task';
    li.dataset.id = t.id;
    if (t.done) li.classList.add('is-done');
    if (isOverdue(t, today)) li.classList.add('is-overdue');

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'check';
    check.dataset.action = 'toggle';
    check.setAttribute('aria-label', t.done ? `إلغاء إنجاز: ${t.title}` : `إنجاز: ${t.title}`);
    check.innerHTML = `<span class="ring">${ICONS.check}</span>`;

    const body = document.createElement('div');
    body.className = 'task-body';
    const title = document.createElement('p');
    title.className = 'task-title';
    title.textContent = t.title;
    const meta = document.createElement('div');
    meta.className = 'task-meta';
    const cat = makeTag(CATEGORIES[t.category], `cat-${t.category}`);
    const dot = document.createElement('span');
    dot.className = 'dot';
    cat.prepend(dot);
    const due = dueTag(t, today);
    meta.append(cat, makeTag(PRIORITIES[t.priority], `prio-${t.priority}`), makeTag(due.text, due.cls));
    body.append(title, meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.dataset.action = 'delete';
    del.dataset.label = `حذف: ${t.title}`;
    del.setAttribute('aria-label', del.dataset.label);
    del.innerHTML = ICONS.trash;

    li.append(check, body, del);
    return li;
  }

  function render() {
    const today = todayKey();
    renderedDay = today;
    for (const tab of tabs) {
      const name = tab.dataset.tab;
      const selected = name === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(`#count-${name}`).textContent = tasksFor(name, today).length;
    }
    taskPanel.setAttribute('aria-labelledby', `tab-${activeTab}`);
    const list = tasksFor(activeTab, today);
    taskList.replaceChildren(...list.map((t) => renderTask(t, today)));
    emptyState.textContent = EMPTY_TEXT[activeTab];
    emptyState.hidden = list.length > 0;
    renderStats();
  }

  function setTab(name, focus) {
    activeTab = name;
    disarmDelete();
    render();
    if (focus) $(`#tab-${name}`).focus();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => setTab(tab.dataset.tab, false));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      let next = -1;
      // RTL: left arrow moves forward.
      if (e.key === 'ArrowLeft') next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowRight') next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      setTab(tabs[next].dataset.tab, true);
    });
  }

  function findTask(id) {
    return state.tasks.find((t) => t.id === id);
  }

  function taskElement(id) {
    return taskList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  function pulseTask(id) {
    const el = taskElement(id);
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
    el.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    setTimeout(() => el.classList.remove('pulse'), 2800);
  }

  // ---------- Celebration, points, streak ----------
  const pointsValue = $('#pointsValue');
  const streakValue = $('#streakValue');
  const streakLabel = $('#streakLabel');
  const pointsStat = $('#pointsStat');
  const streakStat = $('#streakStat');
  const confettiLayer = $('#confetti');

  const CHEERS = ['يا سلام عليك!', 'كفو!', 'بطل والله!', 'ما شاء الله عليك!', 'كذا الشغل ولا بلاش!', 'أسطورة!'];
  const CONFETTI_COLORS = ['#ff4fd0', '#7b2ff7', '#ffd76a', '#ff9a3c', '#4f8cff', '#2fbf8f'];

  // The streak only counts if the last completion was today or yesterday.
  function currentStreak() {
    const today = todayKey();
    const last = state.lastDoneDay;
    return last === today || last === addDays(today, -1) ? state.streak : 0;
  }

  function renderStats() {
    pointsValue.textContent = state.points;
    const streak = currentStreak();
    streakValue.textContent = streak;
    streakLabel.textContent = streak === 2 ? 'يومين' : streak >= 3 && streak <= 10 ? 'أيام' : 'يوم';
    pointsStat.setAttribute('aria-label', `النقاط: ${state.points}`);
    pointsStat.title = 'النقاط';
    streakStat.setAttribute('aria-label', `أيام متتالية: ${streak}`);
    streakStat.title = 'أيام متتالية فيها إنجاز';
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function addPoints(n) {
    state.points += n;
    bump(pointsStat);
  }

  function updateStreak() {
    const today = todayKey();
    if (state.lastDoneDay === today) return;
    state.streak = state.lastDoneDay === addDays(today, -1) ? state.streak + 1 : 1;
    state.lastDoneDay = today;
    bump(streakStat);
  }

  function confetti() {
    if (reduceMotion.matches) return;
    const pieces = [];
    for (let i = 0; i < 48; i++) {
      const el = document.createElement('i');
      if (i % 3 === 0) el.className = 'round';
      el.style.left = `${Math.random() * 100}%`;
      el.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      el.style.setProperty('--d', `${1.6 + Math.random() * 1.4}s`);
      el.style.setProperty('--delay', `${Math.random() * 0.35}s`);
      el.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
      el.style.setProperty('--spin', `${(Math.random() - 0.5) * 1080}deg`);
      pieces.push(el);
    }
    confettiLayer.append(...pieces);
    setTimeout(() => pieces.forEach((el) => el.remove()), 3600);
  }

  // Happy owl + confetti + a cheer line.
  function celebrate(line) {
    owlBtn.classList.remove('stretching');
    showMood('happy', 2800);
    confetti();
    say(line);
  }

  // Called after a task is marked done. Points are awarded once per task.
  function onTaskCompleted(task) {
    updateStreak();
    let line = pick(CHEERS);
    if (!task.awarded) {
      const pts = task.priority === 'urgent' ? 15 : 10;
      task.awarded = true;
      addPoints(pts);
      line += ` +${pts === 10 ? '10 نقاط' : `${pts} نقطة`} على «${task.title}».`;
    } else {
      line += ` «${task.title}» خلصت (نقاطها محسوبة من قبل).`;
    }
    saveState();
    renderStats();
    celebrate(line);
  }

  // ---------- "What should I start with?" ----------
  function suggestReason(t, today) {
    if (isOverdue(t, today)) return 'لأنها متأخرة';
    if (t.priority === 'urgent') return 'لأنها عاجلة';
    if (t.due === today) return 'لأن موعدها اليوم';
    if (t.due) return 'لأنها الأقرب موعدًا';
    return 'لأنها أول شي في قائمتك';
  }

  $('#suggestBtn').addEventListener('click', () => {
    const today = todayKey();
    const open = state.tasks.filter((t) => !t.done).sort((a, b) => compareTasks(a, b, today));
    if (owlState === 'sleeping') {
      setOwl('awake');
      stretch();
    }
    if (!open.length) {
      showMood('happy', 2000);
      say('ما عندك شي مفتوح! أضف مهمة أو خذ لك قهوة.');
      return;
    }
    const top = open[0];
    const tab = top.due && top.due > today ? 'upcoming' : 'today';
    if (tab !== activeTab) setTab(tab, false);
    pulseTask(top.id);
    say(`ابدأ بـ«${top.title}»، ${suggestReason(top, today)}. أنا معك!`);
  });

  function completeTask(task) {
    task.done = true;
    task.doneAt = Date.now();
    saveState();
    render();
    onTaskCompleted(task);
  }

  function undoTask(task) {
    task.done = false;
    task.doneAt = null;
    saveState();
    render();
    say(`رجّعت «${task.title}» لقائمتك.`);
  }

  // Delete needs a second tap on the same button.
  let armedDelete = null;
  let armTimer = 0;

  function disarmDelete() {
    clearTimeout(armTimer);
    if (!armedDelete) return;
    armedDelete.classList.remove('armed');
    armedDelete.innerHTML = ICONS.trash;
    armedDelete.setAttribute('aria-label', armedDelete.dataset.label);
    armedDelete = null;
  }

  function armDelete(btn) {
    disarmDelete();
    armedDelete = btn;
    btn.classList.add('armed');
    btn.textContent = 'متأكد؟ احذف';
    btn.setAttribute('aria-label', `اضغط مرة ثانية للتأكيد. ${btn.dataset.label}`);
    armTimer = setTimeout(disarmDelete, 4000);
  }

  taskList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = btn.closest('.task');
    const task = li && findTask(li.dataset.id);
    if (!task) return;

    if (btn.dataset.action === 'toggle') {
      disarmDelete();
      if (task.done) undoTask(task);
      else completeTask(task);
      return;
    }
    if (btn.dataset.action === 'delete') {
      if (armedDelete !== btn) {
        armDelete(btn);
        return;
      }
      armedDelete = null;
      clearTimeout(armTimer);
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      saveState();
      render();
      taskPanel.tabIndex = -1;
      taskPanel.focus();
      say(`حذفت «${task.title}».`);
    }
  });

  document.querySelectorAll('.quick-dates [data-due]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const today = todayKey();
      const map = { today, tomorrow: addDays(today, 1), none: '' };
      dueInput.value = map[btn.dataset.due];
    });
  });

  function showAddError(text) {
    addError.textContent = text;
    addError.hidden = !text;
    titleInput.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  titleInput.addEventListener('input', () => {
    if (!addError.hidden) showAddError('');
  });

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      showAddError('اكتب عنوان المهمة أول.');
      titleInput.focus();
      return;
    }
    const due = dueInput.value && parseDay(dueInput.value) ? dueInput.value : null;
    const priority = addForm.elements.priority.value;
    const task = {
      id: newId(),
      title: title.slice(0, 200),
      category: categoryInput.value in CATEGORIES ? categoryInput.value : 'other',
      priority: priority in PRIORITIES ? priority : 'normal',
      due,
      done: false,
      doneAt: null,
      awarded: false,
      createdAt: Date.now(),
    };
    state.tasks.push(task);
    saveState();
    showAddError('');
    titleInput.value = '';

    const today = todayKey();
    const upcoming = due && due > today;
    activeTab = upcoming ? 'upcoming' : 'today';
    render();
    pulseTask(task.id);
    say(upcoming ? `سجّلتها في القادمة: «${task.title}».` : `سجّلتها لليوم: «${task.title}».`);
    titleInput.focus();
  });

  // Re-render when the day changes (tab left open overnight).
  function refreshIfNewDay() {
    if (todayKey() !== renderedDay) render();
  }
  setInterval(refreshIfNewDay, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshIfNewDay();
  });

  // ---------- Export / import ----------
  const exportBtn = $('#exportBtn');
  const importBtn = $('#importBtn');
  const importFile = $('#importFile');
  const importConfirm = $('#importConfirm');
  const importConfirmText = $('#importConfirmText');
  const dataStatus = $('#dataStatus');
  let pendingImport = null;

  function setStatus(text, kind) {
    dataStatus.textContent = text;
    dataStatus.className = `status ${kind || ''}`.trim();
  }

  exportBtn.addEventListener('click', () => {
    try {
      const payload = Object.assign({ app: 'numan', exportedAt: new Date().toISOString() }, state);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `numan-${todayKey()}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`نزّلت الملف numan-${todayKey()}.json`, 'ok');
    } catch (e) {
      setStatus('ما قدرت أنزّل الملف في هذا المتصفح.', 'err');
    }
  });

  importBtn.addEventListener('click', () => {
    setStatus('');
    importFile.click();
  });

  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    importFile.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setStatus('الملف كبير زيادة. ملفات نومان عادة صغيرة.', 'err');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      setStatus('هذا مو ملف JSON صالح. اختر ملفًا صدّرته من نومان.', 'err');
      return;
    }
    const res = validateData(parsed);
    if (res.error) {
      setStatus(`ما استوردت شي: ${res.error}`, 'err');
      return;
    }
    pendingImport = res.data;
    importConfirmText.textContent =
      `الملف فيه ${countTasks(res.data.tasks.length)} و${res.data.points} نقطة. ` +
      `بيستبدل بياناتك الحالية (${countTasks(state.tasks.length)}). نكمل؟`;
    importConfirm.hidden = false;
    $('#importYes').focus();
  });

  $('#importYes').addEventListener('click', () => {
    if (!pendingImport) return;
    state = pendingImport;
    pendingImport = null;
    importConfirm.hidden = true;
    saveState();
    applyTheme();
    render();
    setStatus(`تم الاستيراد: ${countTasks(state.tasks.length)}.`, 'ok');
    say('استوردت بياناتك، كل شي في مكانه!');
    importBtn.focus();
  });

  $('#importNo').addEventListener('click', () => {
    pendingImport = null;
    importConfirm.hidden = true;
    setStatus('لغيت الاستيراد، بياناتك ما تغيرت.');
    importBtn.focus();
  });

  // ---------- Start ----------
  applyTheme();
  setOwl('sleeping');
  render();
  if (firstRun) say('نومان نايم… حطيت لك 4 مهام تجريبية تحت عشان تشوف الشكل. اضغط عليه يصحى');
})();
