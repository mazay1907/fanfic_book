/* Читалка: vanilla JS, без зависимостей и внешних запросов.
   Позиция чтения хранится как индекс блока (data-block), а не номер страницы. */
(function () {
  'use strict';

  var K_PROG = 'wr:v1:progress:', K_SET = 'wr:v1:settings', K_LAST = 'wr:v1:lastBook';
  var GAP = 32, FS_MIN = 16, FS_MAX = 26;
  var THEMES = { dark: '#0b0b0d', light: '#f6f3ee', sepia: '#f1e4c8' };

  function $(id) { return document.getElementById(id); }
  var app = $('app'), flow = $('flow'), clip = $('clip'), stage = $('stage');

  /* ---------- безопасное хранилище ---------- */
  var warned = false;
  function warnStorage() {
    if (warned) return;
    warned = true;
    toast('Телефон не разрешает запомнить место');
  }
  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; } catch (e) { warnStorage(); return false; }
  }
  function readJSON(k) {
    var v = lsGet(k);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  /* ---------- состояние ---------- */
  var lib = null, book = null, ci = 0, page = 0, pages = 1, curBlock = 0;
  var blockPage = [], W = 0, H = 0, inReader = false, doneFlag = false;
  var settings = { fontSize: 19, theme: 'dark' };
  var progress = null, saveTimer = 0, toastTimer = 0, resizeTimer = 0;

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function plural(n, a, b, c) {
    var m = n % 100, d = n % 10;
    if (m >= 11 && m <= 14) return c;
    if (d === 1) return a;
    if (d >= 2 && d <= 4) return b;
    return c;
  }

  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }

  /* ---------- настройки ---------- */
  function loadSettings() {
    var s = readJSON(K_SET);
    if (s) {
      if (typeof s.fontSize === 'number' && s.fontSize >= FS_MIN && s.fontSize <= FS_MAX) settings.fontSize = Math.round(s.fontSize);
      if (THEMES[s.theme]) settings.theme = s.theme;
    }
  }
  function saveSettings() { lsSet(K_SET, JSON.stringify(settings)); }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', THEMES[settings.theme]);
    var btns = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-theme-set') === settings.theme);
    }
    $('fs-val').textContent = settings.fontSize;
  }

  /* ---------- прогресс ---------- */
  function chapterIndexByN(n) {
    for (var i = 0; i < book.chapters.length; i++) if (book.chapters[i].n === n) return i;
    return -1;
  }
  function loadProgress() {
    var p = readJSON(K_PROG + book.id);
    if (!p || typeof p.chapter !== 'number' || chapterIndexByN(p.chapter) < 0) return null;
    if (typeof p.block !== 'number' || p.block < 0) p.block = 0;
    return p;
  }
  function percentNow() {
    var total = book.words || 1, before = 0, i;
    for (i = 0; i < ci; i++) before += book.chapters[i].words;
    var cur = book.chapters[ci].words * ((page + 1) / Math.max(pages, 1));
    return Math.min(1, (before + cur) / total);
  }
  function writeProgress() {
    if (!book || !inReader) return;
    var c = book.chapters[ci];
    var prevMax = progress && progress.maxChapter ? progress.maxChapter : 0;
    progress = {
      chapter: c.n, block: curBlock, pageHint: page + 1, pagesHint: pages,
      percent: Math.round(percentNow() * 1000) / 1000,
      maxChapter: Math.max(prevMax, c.n), done: doneFlag, updatedAt: Date.now()
    };
    lsSet(K_PROG + book.id, JSON.stringify(progress));
    lsSet(K_LAST, book.id);
  }
  function saveProgress(now) {
    clearTimeout(saveTimer);
    if (now) writeProgress(); else saveTimer = setTimeout(writeProgress, 400);
  }

  /* ---------- загрузка ---------- */
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // TODO(library): при нескольких книгах показать экран-сетку обложек
  // (по library.json) и вернуть выбранную. Пока книга одна — открываем её.
  function openLibrary(books) {
    return books[0];
  }
  function chooseBook(books) {
    var q = null;
    try { q = new URLSearchParams(window.location.search).get('book'); } catch (e) { q = null; }
    var i, last = lsGet(K_LAST);
    if (q) for (i = 0; i < books.length; i++) if (books[i].id === q) return books[i];
    if (last) for (i = 0; i < books.length; i++) if (books[i].id === last) return books[i];
    if (books.length === 1) return books[0];
    return openLibrary(books);
  }

  function showError(msg) {
    var e = $('cover-error');
    e.textContent = msg;
    e.hidden = false;
  }

  function init() {
    loadSettings();
    applyTheme();
    if (!lsSet('wr:v1:probe', '1')) { /* предупреждение уже показано */ }
    bind();
    getJSON('library.json').then(function (l) {
      lib = l;
      if (!l.books || !l.books.length) throw new Error('empty library');
      var entry = chooseBook(l.books);
      return getJSON(entry.path);
    }).then(function (b) {
      book = b;
      document.title = b.title;
      $('cover-title').textContent = b.title;
      progress = loadProgress();
      doneFlag = !!(progress && progress.done);
      renderCover();
      var m = /^#c(\d+)$/.exec(window.location.hash || '');
      if (m) {
        var idx = chapterIndexByN(parseInt(m[1], 10));
        if (idx >= 0) openReader(idx, 'start');
      }
    }).catch(function () {
      $('cover-title').textContent = 'Не открывается';
      showError('Не удалось загрузить книгу. Проверь интернет и обнови страницу. ' +
        'Если открываешь файл напрямую — нужно открывать по ссылке с сервера.');
    });
  }

  /* ---------- обложка ---------- */
  function renderCover() {
    var n = book.chapters.length;
    $('cover-meta').textContent = n + ' ' + plural(n, 'глава', 'главы', 'глав') + ' · ' + fmt(book.words) + ' ' + plural(book.words, 'слово', 'слова', 'слов');
    var has = !!progress;
    var cont = $('btn-continue');
    cont.hidden = !has;
    if (has) {
      cont.textContent = 'Продолжить чтение' + ' — глава ' + progress.chapter +
        (progress.pageHint ? ', стр. ' + progress.pageHint : '');
    }
    $('btn-start').hidden = has;
    $('btn-restart').hidden = !has;
    showCover();
  }
  function showCover() {
    inReader = false;
    $('reader').hidden = true;
    $('cover').hidden = false;
    closeSheets();
    $('end').hidden = true;
    if (book) { progress = loadProgress() || progress; renderCoverButtons(); }
  }
  function renderCoverButtons() {
    var has = !!progress;
    $('btn-continue').hidden = !has;
    $('btn-start').hidden = has;
    $('btn-restart').hidden = !has;
    if (has) {
      $('btn-continue').textContent = 'Продолжить чтение — глава ' + progress.chapter +
        (progress.pageHint ? ', стр. ' + progress.pageHint : '');
    }
  }

  /* ---------- вёрстка и страницы ---------- */
  function buildChapter(idx) {
    var c = book.chapters[idx], h = [], i, b, a;
    h.push('<header class="chap-head" data-block="-1"><div class="chap-n">Глава ' + c.n + '</div><h1>' + esc(c.title) + '</h1></header>');
    for (i = 0; i < c.blocks.length; i++) {
      b = c.blocks[i];
      a = ' data-block="' + i + '"';
      if (b.t === 'hr') h.push('<hr' + a + '>');
      else if (b.t === 'h2') h.push('<h2' + a + '>' + b.html + '</h2>');
      else if (b.t === 'epigraph') h.push('<blockquote class="epigraph"' + a + '>' + b.html + '</blockquote>');
      else h.push('<p' + a + '>' + b.html + '</p>');
    }
    flow.innerHTML = h.join('');
  }

  function layout() {
    var cw = clip.clientWidth, ch = clip.clientHeight;
    if (!cw || !ch) return false;
    W = cw; H = ch;
    var s = flow.style;
    s.transition = 'none';
    s.width = W + 'px'; s.height = H + 'px';
    s.columnWidth = W + 'px'; s.webkitColumnWidth = W + 'px';
    s.columnGap = GAP + 'px'; s.webkitColumnGap = GAP + 'px';
    s.fontSize = settings.fontSize + 'px';
    var step = W + GAP, fr = flow.getBoundingClientRect();
    var els = flow.querySelectorAll('[data-block]'), maxP = 0, i, el, idx, rs, p, lp;
    blockPage = [];
    for (i = 0; i < els.length; i++) {
      el = els[i];
      idx = parseInt(el.getAttribute('data-block'), 10);
      rs = el.getClientRects();
      if (!rs.length) continue;
      p = Math.max(0, Math.floor((rs[0].left - fr.left + 2) / step));
      lp = Math.max(0, Math.floor((rs[rs.length - 1].left - fr.left + 2) / step));
      if (idx >= 0) blockPage[idx] = p;
      if (lp > maxP) maxP = lp;
      if (p > maxP) maxP = p;
    }
    for (i = 0; i < blockPage.length; i++) if (blockPage[i] === undefined) blockPage[i] = i ? blockPage[i - 1] : 0;
    pages = maxP + 1;
    return true;
  }

  // Какой блок считать «первым на странице p» (его и сохраняем).
  function anchorFor(p) {
    var n = blockPage.length, i;
    if (!n || p <= 0) return 0;
    for (i = 0; i < n; i++) {
      if (blockPage[i] >= p) return blockPage[i] === p ? i : Math.max(0, i - 1);
    }
    return n - 1;
  }

  function goPage(p, animate, keepBlock) {
    page = Math.max(0, Math.min(pages - 1, p));
    flow.style.transition = (animate && !reduceMotion()) ? 'transform 180ms ease' : 'none';
    flow.style.transform = 'translate3d(' + (-page * (W + GAP)) + 'px,0,0)';
    if (!keepBlock) curBlock = anchorFor(page);
    updateBar();
    saveProgress(true);
  }

  function updateBar() {
    var c = book.chapters[ci];
    $('status').textContent = 'Глава ' + c.n + ' из ' + book.chapters.length + ' · стр. ' + (page + 1) + ' из ' + pages;
    $('top-title').textContent = c.title;
    $('strip-fill').style.width = (percentNow() * 100).toFixed(1) + '%';
  }

  function openReader(idx, where) {
    $('cover').hidden = true;
    $('reader').hidden = false;
    $('end').hidden = true;
    inReader = true;
    app.classList.add('bars-on');
    openChapter(idx, where, false);
  }

  // where: 'start' | 'end' | число (индекс блока)
  function openChapter(idx, where, plaque) {
    ci = idx;
    buildChapter(idx);
    layout();
    var target = 0;
    curBlock = 0;
    if (where === 'end') target = pages - 1;
    else if (typeof where === 'number') {
      var b = Math.min(where, Math.max(0, blockPage.length - 1));
      target = blockPage[b] || 0;
    }
    goPage(target, false);
    if (typeof where === 'number') { curBlock = Math.min(where, Math.max(0, blockPage.length - 1)); saveProgress(true); }
    if (plaque) toast('Глава ' + book.chapters[idx].n + '. ' + book.chapters[idx].title, 1800);
  }

  // Поворот экрана / смена кегля: якорь — текущий блок, он не пересчитывается.
  function relayout() {
    if (!inReader) return;
    var b = curBlock;
    if (!layout()) return;
    goPage(blockPage[b] || 0, false, true);
  }

  function next() {
    if (page < pages - 1) { app.classList.remove('bars-on'); goPage(page + 1, true); }
    else if (ci < book.chapters.length - 1) openChapter(ci + 1, 'start', true);
    else showEnd();
  }
  function prev() {
    if (page > 0) { app.classList.remove('bars-on'); goPage(page - 1, true); }
    else if (ci > 0) openChapter(ci - 1, 'end', true);
  }

  function showEnd() {
    doneFlag = true;
    saveProgress(true);
    $('end-note').textContent = book.complete ? 'Книга закончилась.' : 'Продолжение пишется.';
    $('end').hidden = false;
  }

  /* ---------- оглавление и настройки ---------- */
  function closeSheets() {
    $('sheet-toc').hidden = true;
    $('sheet-settings').hidden = true;
  }
  function openToc() {
    var list = $('toc-list'), h = [], i, c, read, cur;
    var maxCh = progress && progress.maxChapter ? progress.maxChapter : 0;
    for (i = 0; i < book.chapters.length; i++) {
      c = book.chapters[i];
      read = c.n < maxCh || (doneFlag && i === book.chapters.length - 1);
      cur = inReader && i === ci;
      h.push('<li><button type="button" data-ch="' + i + '"' + (cur ? ' class="cur" aria-current="true"' : '') + '>' +
        '<span class="num">' + c.n + '</span><span class="ttl">' + esc(c.title) + '</span>' +
        '<span class="chk">' + (read ? '✓' : '') + '</span></button></li>');
    }
    list.innerHTML = h.join('');
    $('sheet-settings').hidden = true;
    $('sheet-toc').hidden = false;
  }
  function gotoChapterFromToc(i) {
    closeSheets();
    $('end').hidden = true;
    if (inReader && i === ci) return;
    var saved = progress && progress.chapter === book.chapters[i].n;
    openReaderOrChapter(i, saved ? progress.block : 'start');
  }
  function openReaderOrChapter(i, where) {
    if (inReader) openChapter(i, where, false); else openReader(i, where);
  }
  function openSettings() {
    $('sheet-toc').hidden = true;
    applyTheme();
    $('sheet-settings').hidden = false;
  }
  function setFont(n) {
    n = Math.max(FS_MIN, Math.min(FS_MAX, n));
    if (n === settings.fontSize) return;
    settings.fontSize = n;
    saveSettings();
    applyTheme();
    relayout();
  }
  function setTheme(t) {
    if (!THEMES[t]) return;
    settings.theme = t;
    saveSettings();
    applyTheme();
    relayout();
  }

  function restart() {
    if (progress && !window.confirm('Начать с первой страницы? Сохранённое место заменится.')) return;
    doneFlag = false;
    if (progress) progress.done = false;
    openReader(0, 'start');
  }

  /* ---------- события ---------- */
  function bind() {
    $('btn-continue').addEventListener('click', function () {
      if (!progress) return;
      openReader(chapterIndexByN(progress.chapter), progress.block);
    });
    $('btn-start').addEventListener('click', function () { openReader(0, 'start'); });
    $('btn-restart').addEventListener('click', restart);
    $('btn-toc-cover').addEventListener('click', openToc);
    $('btn-back').addEventListener('click', function () { saveProgress(true); showCover(); });
    $('btn-toc').addEventListener('click', openToc);
    $('btn-settings').addEventListener('click', openSettings);
    $('toc-cover').addEventListener('click', function () { saveProgress(true); showCover(); });
    $('fs-minus').addEventListener('click', function () { setFont(settings.fontSize - 1); });
    $('fs-plus').addEventListener('click', function () { setFont(settings.fontSize + 1); });
    $('end-restart').addEventListener('click', function () { $('end').hidden = true; doneFlag = false; openReader(0, 'start'); });
    $('end-toc').addEventListener('click', openToc);
    $('end-back').addEventListener('click', function () { $('end').hidden = true; });

    var themeBtns = document.querySelectorAll('[data-theme-set]');
    Array.prototype.forEach.call(themeBtns, function (b) {
      b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-set')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', closeSheets);
    });
    $('toc-list').addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== this && !t.getAttribute('data-ch')) t = t.parentNode;
      if (t && t.getAttribute && t.getAttribute('data-ch') !== null) gotoChapterFromToc(parseInt(t.getAttribute('data-ch'), 10));
    });

    // свайп и тапы по краям
    var sx = 0, sy = 0, tracking = false;
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; tracking = true;
    });
    stage.addEventListener('pointercancel', function () { tracking = false; });
    stage.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
        if (x < 0.3) prev();
        else if (x > 0.7) next();
        else app.classList.toggle('bars-on');
      }
    });
    stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.addEventListener('keydown', function (e) {
      if (!inReader) return;
      if (e.key === 'Escape') { closeSheets(); $('end').hidden = true; return; }
      if (!$('sheet-toc').hidden || !$('sheet-settings').hidden || !$('end').hidden) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); prev(); }
    });

    // iOS: beforeunload ненадёжен, поэтому visibilitychange и pagehide
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveProgress(true);
    });
    window.addEventListener('pagehide', function () { saveProgress(true); });

    function schedule() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 160);
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', function () { setTimeout(schedule, 250); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  }

  init();
})();
