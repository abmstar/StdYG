'use strict';

// 학생용 Apps Script 웹 앱 주소
const DEFAULT_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbxp9ZLOZVmx-yEHEEvaHWEMBtxwaSPN5oTILMO9ED4uPM39J51AUhMKNU6Z7UBIlrTe/exec';

const PREFIX = 'student-timetable.v1.';
const CLASS_NAMES = ['1-1반', '1-2반', '1-3반', '2-1반', '2-2반', '2-3반', '3-1반', '3-2반', '3-3반'];
const $ = (id) => document.getElementById(id);

const store = {
  get(key) {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      $('status').textContent = '기기 저장 공간을 사용할 수 없습니다. 이번 실행에서만 사용할 수 있습니다.';
    }
  },
};

let teacher = store.get('teacher') || '';
const endpoint = DEFAULT_ENDPOINT;
let weekOffset = 0;
let requestVersion = 0;
let installPrompt;
let midnightTimer;

function koreaParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const n = (type) => Number(parts.find((x) => x.type === type).value);
  return { year: n('year'), month: n('month'), day: n('day') };
}

function weekInfo(offset = 0, now = new Date()) {
  const p = koreaParts(now);
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const mon = new Date(today);
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7) + offset * 7);
  const fri = new Date(mon);
  fri.setUTCDate(fri.getUTCDate() + 4);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return {
    sheetName: `${fmt(mon)}~${fmt(fri)}`,
    monday: mon.toISOString().slice(0, 10),
    year: mon.getUTCFullYear(),
    todayIndex: offset === 0 ? (today.getUTCDay() + 6) % 7 : -1,
  };
}

function cacheKey(info) {
  return 'cache.' + JSON.stringify([endpoint, teacher, info.monday]);
}

function readCache(info) {
  try {
    return JSON.parse(store.get(cacheKey(info)));
  } catch {
    return null;
  }
}

function renderMessage(title, body) {
  const box = document.createElement('div');
  box.className = 'notice';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('div');
  text.textContent = body;
  box.append(heading, text);
  $('schedule').replaceChildren(box);
}

function renderTable(data, info) {
  const grid = document.createElement('div');
  grid.className = 'table';
  grid.setAttribute('role', 'table');
  grid.setAttribute('aria-label', teacher + ' ' + info.sheetName + ' 시간표');
  const headers = ['교시', '월', '화', '수', '목', '금'];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 6; c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.setAttribute('role', r === 0 ? 'columnheader' : c === 0 ? 'rowheader' : 'cell');

      if (r === 0) {
        el.classList.add('head');
        el.textContent = headers[c];
      } else if (c === 0) {
        el.classList.add('period');
        el.textContent = r + '교시';
      } else {
        const value = data.schedule[r - 1][c - 1];
        el.textContent = value || '—';
        if (!value) el.classList.add('empty-cell');
      }

      if (c > 0 && c - 1 === info.todayIndex) el.classList.add('today');
      grid.append(el);
    }
  }
  $('schedule').replaceChildren(grid);
}

function stamp(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

// 방법 1: 로그인 쿠키를 보내지 않는 fetch 요청
async function fetchJson(url, params) {
  const requestUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => requestUrl.searchParams.set(key, value));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(requestUrl.href, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('서버 응답을 확인해 주세요.');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// 방법 2: 기존 script 태그 방식 (fetch 실패 시 대비)
function jsonp(url, params) {
  return new Promise((resolve, reject) => {
    const callback = 'timetable_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e8);
    const script = document.createElement('script');
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete window[callback];
    };

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('연결에 실패했습니다. 배포 주소와 웹 앱 접근 권한을 확인하세요.'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.'));
    }, 25000);

    const u = new URL(url);
    Object.entries({ ...params, callback }).forEach(([key, value]) => u.searchParams.set(key, value));
    script.src = u.href;
    document.head.append(script);
  });
}

// fetch를 먼저 시도하고, 연결 단계에서 실패하면 기존 방식으로 다시 시도
async function requestTimetable(params) {
  try {
    return await fetchJson(endpoint, params);
  } catch {
    return await jsonp(endpoint, params);
  }
}

function validEndpoint(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'script.google.com' &&
      /^\/(?:macros\/s|a\/macros\/[^/]+\/s)\/[^/]+\/exec$/.test(u.pathname) &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}

async function loadWeek() {
  const id = ++requestVersion;
  const info = weekInfo(weekOffset);
  
  $('weekTitle').textContent = `${info.year} · ${info.sheetName}`;
  $('previous').disabled = weekOffset === 0;
  $('relative').textContent =
    weekOffset === 0 ? '이번 주' : weekOffset === 1 ? '다음 주' : `${weekOffset}주 후`;
  $('status').textContent = '';

  if (!teacher) {
    renderMessage('학급을 선택해 주세요', '한 번 선택하면 이 기기에 저장됩니다.');
    return;
  }
  if (!validEndpoint(endpoint)) {
    renderMessage('시간표 연결 준비 중입니다', '관리자가 app.js의 DEFAULT_ENDPOINT에 웹 앱 주소를 설정해야 합니다.');
    return;
  }

  const cached = readCache(info);
  if (cached) renderTable(cached, info);
  else renderMessage('시간표를 불러오는 중입니다', teacher + ' · ' + info.sheetName);

  if (!navigator.onLine) {
    if (cached) $('status').textContent = '오프라인 · 저장본 갱신 ' + stamp(cached.fetchedAt);
    else renderMessage('오프라인입니다', '이 학급·주간의 저장된 시간표가 없습니다.');
    return;
  }

  $('status').textContent = cached ? '저장본 표시 중 · 최신 시간표 확인 중…' : '원본 시트를 확인하는 중…';

  try {
    const result = await requestTimetable({ className: teacher, sheet: info.sheetName });
    if (id !== requestVersion) return;

    if (!result.ok) {
      if (result.code === 'SHEET_NOT_FOUND') {
        try {
          localStorage.removeItem(PREFIX + cacheKey(info));
        } catch {}
        renderMessage('해당 주 시간표가 없습니다', info.sheetName + ' 시트가 아직 등록되지 않았습니다.');
        $('status').textContent = '다른 주로 이동할 수 있습니다.';
        return;
      }
      throw new Error(result.message || '데이터를 읽지 못했습니다.');
    }

    if (
      !Array.isArray(result.schedule) ||
      result.schedule.length !== 7 ||
      result.schedule.some((row) => !Array.isArray(row) || row.length !== 5)
    ) {
      throw new Error('응답 데이터 형식을 확인해 주세요.');
    }

    result.fetchedAt = new Date().toISOString();
    store.set(cacheKey(info), JSON.stringify(result));
    renderTable(result, info);
    $('status').textContent =
      `${teacher} · 갱신 ${stamp(result.fetchedAt)}` +
      (result.matches === 0 ? ' · 일치하는 수업이 없습니다. 학급을 확인하세요.' : '');
  } catch (error) {
    if (id !== requestVersion) return;
    if (cached) {
      $('status').textContent = `최신 조회 실패 · 저장본 ${stamp(cached.fetchedAt)} · ${error.message}`;
    } else {
      renderMessage('시간표를 불러오지 못했습니다', error.message);
      $('status').textContent = '인터넷 상태를 확인한 후 새로고침하세요. 문제가 계속되면 관리자에게 문의하세요.';
    }
  }
}

// 이번 주보다 과거로는 이동하지 않음
function move(delta) {
  const next = Math.max(0, weekOffset + delta);
  if (next !== weekOffset) {
    weekOffset = next;
    loadWeek();
  }
}

if (!CLASS_NAMES.includes(teacher)) teacher = '';
$('teacher').value = teacher;

$('teacher').addEventListener('change', () => {
  teacher = $('teacher').value;
  store.set('teacher', teacher);
  loadWeek();
});

$('teacherForm').addEventListener('submit', (event) => {
  event.preventDefault();
  teacher = $('teacher').value.trim();
  store.set('teacher', teacher);
  loadWeek();
});

// 주간 이동 버튼이 없어도 오류가 나지 않도록 처리
const previousButton = $('previous');
const nextButton = $('next');
const thisWeekButton = $('thisWeek');
if (previousButton) previousButton.onclick = () => move(-1);
if (nextButton) nextButton.onclick = () => move(1);
if (thisWeekButton) {
  thisWeekButton.onclick = () => {
    weekOffset = 0;
    loadWeek();
  };
}

$('refresh').onclick = async () => {
  const button = $('refresh');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '조회 중…';
  try {
    await loadWeek();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
};

// 좌우 스와이프
let start;
$('surface').addEventListener('pointerdown', (e) => {
  if (e.isPrimary && e.button === 0) {
    start = { x: e.clientX, y: e.clientY, time: Date.now(), id: e.pointerId };
  }
});
$('surface').addEventListener('pointercancel', () => {
  start = null;
});
$('surface').addEventListener('pointerup', (e) => {
  if (!start || e.pointerId !== start.id) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  const elapsed = Date.now() - start.time;
  start = null;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6 && elapsed < 1200) {
    move(dx > 0 ? 1 : -1);
  }
});

window.addEventListener('online', loadWeek);
window.addEventListener('offline', loadWeek);

function armDateRefresh() {
  clearTimeout(midnightTimer);
  const now = new Date();
  const p = koreaParts(now);
  const next = Date.UTC(p.year, p.month - 1, p.day + 1) - 9 * 3600000;
  midnightTimer = setTimeout(() => {
    loadWeek();
    armDateRefresh();
  }, Math.max(1000, next - now.getTime() + 1000));
}

let lastDay = JSON.stringify(koreaParts());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const day = JSON.stringify(koreaParts());
    if (day !== lastDay) {
      lastDay = day;
      loadWeek();
    }
    armDateRefresh();
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install').style.display = 'block';
});

$('install').onclick = async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    $('install').style.display = 'none';
  }
};

window.addEventListener('appinstalled', () => {
  $('install').style.display = 'none';
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    $('status').textContent += ' · 오프라인 파일 등록 실패';
  });
}

loadWeek();
armDateRefresh();
