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

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Storage full or blocked: the page keeps working for this visit.
    }
  }

  let state = Object.assign(defaults(), loadState() || {});

  // ---------- Theme ----------
  const root = document.documentElement;
  const themeBtn = $('#themeBtn');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function effectiveTheme() {
    if (state.theme) return state.theme;
    if (root.dataset.theme === 'dark' || root.dataset.theme === 'light') return root.dataset.theme;
    return darkScheme.matches ? 'dark' : 'light';
  }

  function applyTheme() {
    if (state.theme) root.dataset.theme = state.theme;
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

  function wake() {
    clearTimeout(moodTimer);
    setOwl('awake');
    stretch();
    say(joinLines(greeting(), todaySummary()));
  }

  owlBtn.addEventListener('click', () => {
    if (owlState === 'sleeping') {
      wake();
    } else {
      say(joinLines(pick(AWAKE_CHATTER), todaySummary()));
    }
  });

  sleepBtn.addEventListener('click', () => {
    clearTimeout(moodTimer);
    owlBtn.classList.remove('stretching');
    setOwl('sleeping');
    say('تصبح على خير… نومان راح ينام');
  });

  // ---------- Start ----------
  applyTheme();
  setOwl('sleeping');
})();
