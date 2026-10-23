/* ============================================================
 *  app.js  —  화면 제어 · 저장 · 그래프
 * ============================================================ */

(() => {
'use strict';

const GUEST_KEY = 'dietTracker.v1';

const DEFAULT_PROFILE = {
  gender:'male', age:17, height:172, weight:68, goalWeight:63,
  activity:'light', goal:'lose'
};

let currentUid = null;       // 로그인한 사용자 (없으면 게스트)
let state = load();
let curDate = todayStr();
let pendingMeal = null;      // AI 분석 결과 (저장 전)
let pendingWorkout = null;
let statsRange = 7;

/* ------------------------------------------------------------
 * 저장소
 *   로그인 전   : localStorage 'dietTracker.v1'
 *   로그인 후   : localStorage 'dietTracker.v1.<uid>' + Firestore
 *   → 한 컴퓨터를 여러 사람이 써도 기록이 섞이지 않습니다.
 * ---------------------------------------------------------- */
function storeKey(uid) {
  const id = uid === undefined ? currentUid : uid;
  return id ? `${GUEST_KEY}.${id}` : GUEST_KEY;
}

function emptyState() {
  return { profile:{ ...DEFAULT_PROFILE }, days:{} };
}

function load(uid) {
  try {
    const raw = localStorage.getItem(storeKey(uid));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return {
      profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) },
      days: parsed.days || {}
    };
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다.', e);
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(state));
  } catch (e) {
    toast('저장 공간이 부족해 저장하지 못했습니다.');
  }
  // 로그인 상태면 클라우드에도 반영 (cloud.js가 1.5초 모아서 전송)
  if (currentUid && window.Cloud && window.Cloud.ready) window.Cloud.scheduleSave(state);
}

/**
 * 같은 사람의 기록 두 벌을 합친다. (기기 A와 기기 B, 또는 로컬과 클라우드)
 * 끼니·운동은 id로 중복을 제거해 둘 다 살리고,
 * 몸무게와 프로필은 더 최근에 수정된 쪽(base)을 우선한다.
 */
function mergeStates(base, other) {
  if (!other || !other.days) return base;
  const out = {
    profile: { ...DEFAULT_PROFILE, ...(other.profile || {}), ...(base.profile || {}) },
    days: {}
  };
  const dates = new Set([...Object.keys(base.days || {}), ...Object.keys(other.days || {})]);
  dates.forEach(d => {
    const a = base.days[d]  || { weight:null, meals:[], workouts:[] };
    const b = other.days[d] || { weight:null, meals:[], workouts:[] };
    const byId = (x, y) => {
      const seen = new Set(), list = [];
      [...(x||[]), ...(y||[])].forEach(item => {
        const key = item.id || JSON.stringify(item);
        if (seen.has(key)) return;
        seen.add(key); list.push(item);
      });
      return list;
    };
    out.days[d] = {
      weight: a.weight != null ? a.weight : b.weight,
      meals: byId(a.meals, b.meals),
      workouts: byId(a.workouts, b.workouts)
    };
  });
  return out;
}

function hasRecords(s) {
  return s && s.days && Object.keys(s.days).some(d => {
    const v = s.days[d];
    return v && (v.weight || (v.meals && v.meals.length) || (v.workouts && v.workouts.length));
  });
}

/* ------------------------------------------------------------
 * 날짜 도구
 * ---------------------------------------------------------- */
function todayStr(d) {
  const t = d ? new Date(d) : new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}
function shiftDate(str, delta) {
  const [y,m,d] = str.split('-').map(Number);
  const dt = new Date(y, m-1, d + delta);
  return todayStr(dt);
}
function prettyDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  const w = ['일','월','화','수','목','금','토'][new Date(y,m-1,d).getDay()];
  return `${m}/${d}(${w})`;
}

function getDay(date, create) {
  if (!state.days[date] && create) state.days[date] = { weight:null, meals:[], workouts:[] };
  return state.days[date] || { weight:null, meals:[], workouts:[] };
}

/** 해당 날짜의 합계 */
function dayTotals(date) {
  const d = getDay(date);
  const intake = AI.sumItems(d.meals);
  const burned = (d.workouts || []).reduce((a,w) => a + (+w.kcal || 0), 0);
  return {
    intake: intake.kcal, carb: intake.carb, protein: intake.protein, fat: intake.fat,
    burned, net: intake.kcal - burned, weight: d.weight
  };
}

/** 최근 기록된 체중 (해당 날짜 이전까지 포함) */
function latestWeight(beforeDate) {
  const dates = Object.keys(state.days).filter(k => state.days[k].weight).sort();
  const past = beforeDate ? dates.filter(k => k <= beforeDate) : dates;
  if (past.length) return state.days[past[past.length-1]].weight;
  return state.profile.weight;
}

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 9);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ============================================================
 *  탭
 * ========================================================== */
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('#' + btn.dataset.tab).classList.add('active');
    window.scrollTo({ top:0, behavior:'smooth' });
    if (btn.dataset.tab === 'stats')     renderStats();
    if (btn.dataset.tab === 'recommend') renderRecommend();
    if (btn.dataset.tab === 'library')   renderLibrary();
    if (btn.dataset.tab === 'settings')  renderSettings();
  });
});

/* ============================================================
 *  날짜 이동
 * ========================================================== */
$('#curDate').value = curDate;
$('#curDate').addEventListener('change', e => { curDate = e.target.value || todayStr(); renderToday(); });
$('#prevDay').addEventListener('click', () => { curDate = shiftDate(curDate, -1); $('#curDate').value = curDate; renderToday(); });
$('#nextDay').addEventListener('click', () => { curDate = shiftDate(curDate, +1); $('#curDate').value = curDate; renderToday(); });
$('#todayBtn').addEventListener('click', () => { curDate = todayStr(); $('#curDate').value = curDate; renderToday(); });

/* ============================================================
 *  체중
 * ========================================================== */
$('#saveWeight').addEventListener('click', () => {
  const v = parseFloat($('#weightInput').value);
  if (!v || v < 20 || v > 300) return toast('몸무게를 20~300 사이로 입력하세요.');
  getDay(curDate, true).weight = v;
  if (curDate === todayStr()) state.profile.weight = v;   // 최신 체중을 프로필에 반영
  save();
  renderToday();
  toast(`${prettyDate(curDate)} 몸무게 ${v}kg 저장`);
});

/* ============================================================
 *  식사 — AI 분석 → 저장
 * ========================================================== */
$('#analyzeMeal').addEventListener('click', () => {
  const text = $('#mealInput').value.trim();
  if (!text) return toast('먹은 음식을 입력해 주세요.');
  pendingMeal = AI.analyzeMeal(text);
  if (!pendingMeal.items.length) {
    $('#mealPreview').innerHTML = '<p class="empty">음식을 알아내지 못했어요. "쌀밥 한 공기" 처럼 음식 이름과 양을 적어 주세요.</p>';
    return;
  }
  renderMealPreview();
});

$('#clearMeal').addEventListener('click', () => {
  $('#mealInput').value = ''; pendingMeal = null; $('#mealPreview').innerHTML = '';
});

function renderMealPreview() {
  const t = AI.sumItems(pendingMeal.items);
  const rows = pendingMeal.items.map((it, i) => `
    <div class="item">
      <span class="nm">${esc(it.name)}
        <small>${esc(String(it.qty))}${esc(it.unit)} · 탄 ${it.carb}g · 단 ${it.protein}g · 지 ${it.fat}g
        ${it.guessed ? ' · DB에 없어 추정값입니다' : ''}</small>
      </span>
      ${it.guessed || it.confidence < 0.8 ? '<span class="tag low">확인 필요</span>' : ''}
      <input class="kcEdit" type="number" data-i="${i}" value="${it.kcal}"> <span class="kc">kcal</span>
      <button class="del" data-rm="${i}" title="제거">×</button>
    </div>`).join('');

  $('#mealPreview').innerHTML = `
    <h3>🤖 AI 분석 결과 — 칼로리는 직접 고칠 수 있어요</h3>
    ${rows}
    <div class="total-row"><span>합계</span><span>${t.kcal} kcal</span></div>
    <div class="row">
      <button id="saveMeal" class="primary-btn">이대로 기록하기</button>
      <button id="cancelMeal" class="ghost-btn">취소</button>
    </div>`;

  $$('#mealPreview .kcEdit').forEach(inp => inp.addEventListener('input', e => {
    const i = +e.target.dataset.i;
    const it = pendingMeal.items[i];
    const old = it.kcal || 1;
    const nv = +e.target.value || 0;
    const r = nv / old;
    it.carb = +(it.carb * r).toFixed(1);
    it.protein = +(it.protein * r).toFixed(1);
    it.fat = +(it.fat * r).toFixed(1);
    it.kcal = nv;
    const tt = AI.sumItems(pendingMeal.items);
    $('#mealPreview .total-row span:last-child').textContent = tt.kcal + ' kcal';
  }));

  $$('#mealPreview [data-rm]').forEach(b => b.addEventListener('click', e => {
    pendingMeal.items.splice(+e.target.dataset.rm, 1);
    pendingMeal.items.length ? renderMealPreview() : ($('#mealPreview').innerHTML = '', pendingMeal = null);
  }));

  $('#saveMeal').addEventListener('click', () => {
    const type = $('#mealType').value;
    const day = getDay(curDate, true);
    pendingMeal.items.forEach(it => day.meals.push({
      id: uid(), type,
      name: it.name, qty: it.qty, unit: it.unit,
      kcal: +it.kcal, carb: +it.carb, protein: +it.protein, fat: +it.fat
    }));
    save();
    pendingMeal = null;
    $('#mealInput').value = '';
    $('#mealPreview').innerHTML = '';
    renderToday();
    toast('식사를 기록했습니다.');
  });

  $('#cancelMeal').addEventListener('click', () => {
    pendingMeal = null; $('#mealPreview').innerHTML = '';
  });
}

/* ============================================================
 *  운동 — AI 분석 → 저장
 * ========================================================== */
$('#analyzeWorkout').addEventListener('click', () => {
  const text = $('#workoutInput').value.trim();
  if (!text) return toast('운동 내용을 입력해 주세요.');
  const w = latestWeight(curDate);
  pendingWorkout = AI.analyzeWorkout(text, w);
  if (!pendingWorkout.items.length) {
    $('#workoutPreview').innerHTML = '<p class="empty">운동을 알아내지 못했어요. "달리기 30분" 처럼 적어 주세요.</p>';
    return;
  }
  renderWorkoutPreview();
});

$('#clearWorkout').addEventListener('click', () => {
  $('#workoutInput').value = ''; pendingWorkout = null; $('#workoutPreview').innerHTML = '';
});

function renderWorkoutPreview() {
  const w = latestWeight(curDate);
  const total = pendingWorkout.items.reduce((a,i) => a + i.kcal, 0);
  const rows = pendingWorkout.items.map((it,i) => `
    <div class="item">
      <span class="nm">${esc(it.name)}
        <small>${it.minutes}분 · 강도 ${it.met} MET · 체중 ${w}kg 기준
        ${it.assumedTime ? ' · 시간을 안 적어 30분으로 계산' : ''}${it.guessed ? ' · DB에 없어 보통 강도로 추정' : ''}</small>
      </span>
      ${it.guessed || it.assumedTime ? '<span class="tag low">확인 필요</span>' : ''}
      <span class="kc">-${it.kcal} kcal</span>
      <button class="del" data-rm="${i}" title="제거">×</button>
    </div>`).join('');

  $('#workoutPreview').innerHTML = `
    <h3>🤖 소모 칼로리 계산 결과</h3>
    ${rows}
    <div class="total-row"><span>합계</span><span>-${total} kcal</span></div>
    <div class="row">
      <button id="saveWorkout" class="primary-btn">이대로 기록하기</button>
      <button id="cancelWorkout" class="ghost-btn">취소</button>
    </div>`;

  $$('#workoutPreview [data-rm]').forEach(b => b.addEventListener('click', e => {
    pendingWorkout.items.splice(+e.target.dataset.rm, 1);
    pendingWorkout.items.length ? renderWorkoutPreview() : ($('#workoutPreview').innerHTML = '', pendingWorkout = null);
  }));

  $('#saveWorkout').addEventListener('click', () => {
    const day = getDay(curDate, true);
    pendingWorkout.items.forEach(it => day.workouts.push({
      id: uid(), name: it.name, minutes: it.minutes, met: it.met, kcal: it.kcal
    }));
    save();
    pendingWorkout = null;
    $('#workoutInput').value = '';
    $('#workoutPreview').innerHTML = '';
    renderToday();
    toast('운동을 기록했습니다.');
  });

  $('#cancelWorkout').addEventListener('click', () => {
    pendingWorkout = null; $('#workoutPreview').innerHTML = '';
  });
}

/* ============================================================
 *  오늘 화면 렌더
 * ========================================================== */
function renderToday() {
  const day = getDay(curDate);
  const t = dayTotals(curDate);
  const profile = { ...state.profile, weight: latestWeight(curDate) };
  const target = AI.targetKcal(profile);
  const macros = AI.targetMacros(profile);

  $('#sumIntake').textContent = t.intake;
  $('#sumBurned').textContent = t.burned;
  $('#sumNet').textContent    = t.net;
  $('#sumTarget').textContent = target;

  const remain = target - t.net;
  $('#ringRemain').textContent = remain;
  drawRing(Math.max(0, Math.min(1.35, t.net / target)));

  // 탄단지 바
  setMacro('Carb', t.carb, macros.carb);
  setMacro('Protein', t.protein, macros.protein);
  setMacro('Fat', t.fat, macros.fat);

  // 체중
  $('#weightInput').value = day.weight || '';
  const prevDates = Object.keys(state.days).filter(k => k < curDate && state.days[k].weight).sort();
  if (day.weight && prevDates.length) {
    const prev = state.days[prevDates[prevDates.length-1]].weight;
    const diff = +(day.weight - prev).toFixed(1);
    const el = $('#weightDiff');
    el.textContent = `직전 기록(${prettyDate(prevDates[prevDates.length-1])} ${prev}kg) 대비 ${diff > 0 ? '+' : ''}${diff}kg`;
    el.className = 'diff ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
  } else {
    $('#weightDiff').textContent = '';
  }

  renderMealList(day);
  renderWorkoutList(day);

  // 코치
  const msgs = AI.coachMessage({ intake:t.intake, burned:t.burned, protein:t.protein, fat:t.fat }, profile);
  $('#coach').innerHTML = msgs.map(m => `<div class="msg ${m.tone}">${esc(m.text)}</div>`).join('');
}

function setMacro(key, cur, goal) {
  $('#m' + key).textContent = cur;
  $('#b' + key).style.width = Math.min(100, (cur / Math.max(1, goal)) * 100) + '%';
}

function renderMealList(day) {
  $('#mealCount').textContent = day.meals.length;
  if (!day.meals.length) { $('#mealList').innerHTML = '<p class="empty">아직 기록이 없습니다.</p>'; return; }

  const order = ['아침','점심','저녁','간식'];
  let html = '';
  order.forEach(type => {
    const list = day.meals.filter(m => m.type === type);
    if (!list.length) return;
    const sub = list.reduce((a,m) => a + m.kcal, 0);
    html += `<div class="group-title">${type} · ${sub}kcal</div>`;
    html += list.map(m => `
      <div class="item">
        <span class="nm">${esc(m.name)}
          <small>${esc(String(m.qty))}${esc(m.unit)} · 탄 ${m.carb}g · 단 ${m.protein}g · 지 ${m.fat}g</small>
        </span>
        <span class="kc">${m.kcal} kcal</span>
        <button class="del" data-del-meal="${m.id}" title="삭제">×</button>
      </div>`).join('');
  });
  const tot = AI.sumItems(day.meals);
  html += `<div class="total-row"><span>총 섭취</span><span>${tot.kcal} kcal</span></div>`;
  $('#mealList').innerHTML = html;

  $$('[data-del-meal]').forEach(b => b.addEventListener('click', e => {
    const id = e.target.dataset.delMeal;
    const d = getDay(curDate, true);
    d.meals = d.meals.filter(m => m.id !== id);
    save(); renderToday(); toast('삭제했습니다.');
  }));
}

function renderWorkoutList(day) {
  $('#workoutCount').textContent = day.workouts.length;
  if (!day.workouts.length) { $('#workoutList').innerHTML = '<p class="empty">아직 기록이 없습니다.</p>'; return; }
  const total = day.workouts.reduce((a,w) => a + w.kcal, 0);
  $('#workoutList').innerHTML = day.workouts.map(w => `
      <div class="item">
        <span class="nm">${esc(w.name)}<small>${w.minutes}분 · ${w.met} MET</small></span>
        <span class="kc">-${w.kcal} kcal</span>
        <button class="del" data-del-wo="${w.id}" title="삭제">×</button>
      </div>`).join('')
    + `<div class="total-row"><span>총 소모</span><span>-${total} kcal</span></div>`;

  $$('[data-del-wo]').forEach(b => b.addEventListener('click', e => {
    const id = e.target.dataset.delWo;
    const d = getDay(curDate, true);
    d.workouts = d.workouts.filter(w => w.id !== id);
    save(); renderToday(); toast('삭제했습니다.');
  }));
}

/* ------------------------------------------------------------
 * 도넛 게이지
 * ---------------------------------------------------------- */
function drawRing(ratio) {
  const cv = $('#ring'), ctx = cv.getContext('2d');
  const cs = getComputedStyle(document.body);
  const w = cv.width, cx = w/2, cy = w/2, r = w/2 - 14;
  ctx.clearRect(0,0,w,w);

  ctx.lineWidth = 16; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(127,140,160,.2)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();

  const over = ratio > 1;
  ctx.strokeStyle = over ? '#e05454' : (cs.getPropertyValue('--brand').trim() || '#2f9e6e');
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + Math.PI*2*Math.min(ratio,1));
  ctx.stroke();

  if (over) {   // 목표 초과분을 안쪽 얇은 링으로 표시
    ctx.lineWidth = 6; ctx.strokeStyle = '#e05454';
    ctx.beginPath();
    ctx.arc(cx, cy, r-14, -Math.PI/2, -Math.PI/2 + Math.PI*2*Math.min(ratio-1, 1));
    ctx.stroke();
  }
}

/* ============================================================
 *  통계
 * ========================================================== */
$$('.range-btn').forEach(b => b.addEventListener('click', () => {
  $$('.range-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  statsRange = +b.dataset.range;
  renderStats();
}));

function rangeDates(n) {
  const out = [];
  for (let i = n-1; i >= 0; i--) out.push(shiftDate(todayStr(), -i));
  return out;
}

function renderStats() {
  const dates = rangeDates(statsRange);
  drawWeightChart(dates);
  drawKcalChart(dates);
  renderWeightSummary();
  renderHistory();
}

function drawWeightChart(dates) {
  const cv = $('#weightChart'), ctx = cv.getContext('2d');
  const pts = dates.map(d => ({ d, w: getDay(d).weight })).filter(p => p.w);
  ctx.clearRect(0,0,cv.width,cv.height);

  if (pts.length < 1) { drawEmpty(ctx, cv, '몸무게 기록이 없습니다.'); return; }

  const pad = { l:46, r:16, t:16, b:28 };
  const W = cv.width - pad.l - pad.r, H = cv.height - pad.t - pad.b;
  const ws = pts.map(p => p.w);
  const goal = state.profile.goalWeight;
  let min = Math.min(...ws, goal || Infinity), max = Math.max(...ws, goal || -Infinity);
  if (max - min < 2) { min -= 1; max += 1; }
  const px = i => pad.l + (pts.length === 1 ? W/2 : (i/(pts.length-1))*W);
  const py = v => pad.t + H - ((v - min)/(max - min))*H;

  // 그리드 + y축
  ctx.strokeStyle = 'rgba(127,140,160,.2)'; ctx.fillStyle = '#8b97a6';
  ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = min + (max-min)*i/4, y = py(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(cv.width-pad.r, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(v.toFixed(1), pad.l-8, y+4);
  }

  // 목표 체중선
  if (goal && goal >= min && goal <= max) {
    ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle = '#e05454';
    ctx.beginPath(); ctx.moveTo(pad.l, py(goal)); ctx.lineTo(cv.width-pad.r, py(goal)); ctx.stroke();
    ctx.fillStyle = '#e05454'; ctx.textAlign = 'left';
    ctx.fillText('목표 ' + goal + 'kg', pad.l+4, py(goal)-6); ctx.restore();
  }

  // 선
  ctx.strokeStyle = '#2f9e6e'; ctx.lineWidth = 2.5; ctx.beginPath();
  pts.forEach((p,i) => i ? ctx.lineTo(px(i), py(p.w)) : ctx.moveTo(px(i), py(p.w)));
  ctx.stroke();

  // 점 + 날짜
  ctx.fillStyle = '#2f9e6e';
  pts.forEach((p,i) => {
    ctx.beginPath(); ctx.arc(px(i), py(p.w), 4, 0, Math.PI*2); ctx.fill();
  });
  ctx.fillStyle = '#8b97a6'; ctx.textAlign = 'center';
  const step = Math.ceil(pts.length / 8);
  pts.forEach((p,i) => { if (i % step === 0 || i === pts.length-1) ctx.fillText(prettyDate(p.d), px(i), cv.height-9); });
}

function drawKcalChart(dates) {
  const cv = $('#kcalChart'), ctx = cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  const rows = dates.map(d => ({ d, ...dayTotals(d) }));
  const any = rows.some(r => r.intake || r.burned);
  if (!any) { drawEmpty(ctx, cv, '식사·운동 기록이 없습니다.'); return; }

  const pad = { l:46, r:16, t:16, b:28 };
  const W = cv.width - pad.l - pad.r, H = cv.height - pad.t - pad.b;
  const target = AI.targetKcal(state.profile);
  const max = Math.max(target * 1.3, ...rows.map(r => Math.max(r.intake, r.burned))) * 1.1;
  const py = v => pad.t + H - (v/max)*H;
  const slot = W / rows.length;

  ctx.strokeStyle = 'rgba(127,140,160,.2)'; ctx.fillStyle = '#8b97a6'; ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = max*i/4, y = py(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(cv.width-pad.r, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(Math.round(v), pad.l-8, y+4);
  }

  rows.forEach((r,i) => {
    const bw = Math.max(4, Math.min(18, slot*0.33));
    const x = pad.l + slot*i + slot/2;
    ctx.fillStyle = '#4b8df8';
    ctx.fillRect(x - bw - 1, py(r.intake), bw, pad.t + H - py(r.intake));
    ctx.fillStyle = '#f2994a';
    ctx.fillRect(x + 1, py(r.burned), bw, pad.t + H - py(r.burned));
  });

  ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle = '#e05454'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.l, py(target)); ctx.lineTo(cv.width-pad.r, py(target)); ctx.stroke(); ctx.restore();

  ctx.fillStyle = '#8b97a6'; ctx.textAlign = 'center';
  const step = Math.ceil(rows.length / 8);
  rows.forEach((r,i) => { if (i % step === 0 || i === rows.length-1) ctx.fillText(prettyDate(r.d), pad.l + slot*i + slot/2, cv.height-9); });
}

function drawEmpty(ctx, cv, msg) {
  ctx.fillStyle = '#8b97a6'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(msg, cv.width/2, cv.height/2);
}

function renderWeightSummary() {
  const dates = Object.keys(state.days).filter(k => state.days[k].weight).sort();
  if (dates.length < 2) { $('#weightSummary').textContent = '몸무게를 2일 이상 기록하면 변화 추이를 알려드립니다.'; return; }
  const first = state.days[dates[0]].weight, last = state.days[dates[dates.length-1]].weight;
  const diff = +(last - first).toFixed(1);
  const days = Math.max(1, (new Date(dates[dates.length-1]) - new Date(dates[0])) / 86400000);
  const perWeek = +(diff / days * 7).toFixed(2);
  const goal = state.profile.goalWeight;
  let txt = `${prettyDate(dates[0])} ${first}kg → ${prettyDate(dates[dates.length-1])} ${last}kg (${diff > 0 ? '+' : ''}${diff}kg, 주당 ${perWeek > 0 ? '+' : ''}${perWeek}kg)`;
  if (goal && perWeek < -0.05 && last > goal) {
    const weeks = Math.ceil((last - goal) / Math.abs(perWeek));
    txt += `<br>이 속도면 목표 ${goal}kg까지 약 ${weeks}주 남았습니다.`;
  } else if (goal && last <= goal) {
    txt += `<br>🎉 목표 체중을 달성했습니다!`;
  }
  $('#weightSummary').innerHTML = txt;
}

function renderHistory() {
  const dates = Object.keys(state.days).sort().reverse();
  if (!dates.length) { $('#historyTable').innerHTML = '<p class="empty">기록이 없습니다.</p>'; return; }
  const target = AI.targetKcal(state.profile);
  const rows = dates.map(d => {
    const t = dayTotals(d);
    return `<tr class="${t.net > target ? 'over' : ''}">
      <td>${prettyDate(d)}</td>
      <td>${t.weight ? t.weight + 'kg' : '-'}</td>
      <td>${t.intake}</td><td>${t.burned}</td><td>${t.net}</td>
      <td>${target - t.net}</td>
    </tr>`;
  }).join('');
  $('#historyTable').innerHTML = `<table>
    <thead><tr><th>날짜</th><th>체중</th><th>섭취</th><th>소모</th><th>순섭취</th><th>목표대비</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ------------------------------------------------------------
 * 백업
 * ---------------------------------------------------------- */
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `diet-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('JSON 파일로 내보냈습니다.');
});

$('#importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (!data.days) throw new Error('형식이 다릅니다');
      if (!confirm('현재 기록을 덮어씁니다. 계속할까요?')) return;
      state = { profile:{ ...DEFAULT_PROFILE, ...(data.profile||{}) }, days:data.days };
      save(); renderToday(); renderStats(); renderSettings();
      toast('가져왔습니다.');
    } catch (err) { toast('올바른 백업 파일이 아닙니다.'); }
    e.target.value = '';
  };
  rd.readAsText(file);
});

$('#resetBtn').addEventListener('click', () => {
  if (!confirm('모든 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  state = { profile:{ ...state.profile }, days:{} };
  save(); renderToday(); renderStats();
  toast('모든 기록을 삭제했습니다.');
});

/* ============================================================
 *  추천
 * ========================================================== */
function renderRecommend() {
  const t = dayTotals(curDate);
  const profile = { ...state.profile, weight: latestWeight(curDate) };
  const remain = Math.max(150, AI.targetKcal(profile) - t.net);
  if (!$('#mealTargetKcal').value) $('#mealTargetKcal').value = Math.round(remain / 50) * 50;
  renderMealRecs();
  renderSnackRecs();
  renderExRecs();
  renderRoutine();
}

$('#refreshMeals').addEventListener('click', renderMealRecs);
function renderMealRecs() {
  const kcal = +$('#mealTargetKcal').value || 600;
  const metas = AI.recommendMeals(kcal, 4);
  $('#mealRecs').innerHTML = metas.map(m => `
    <div class="rec">
      <h3>${esc(m.name)}</h3>
      <div class="kcal">${m.total.kcal} kcal</div>
      <ul>${m.items.map(i => `<li>${esc(i.name)} ${esc(i.amount)} <span style="opacity:.7">${i.kcal}kcal</span></li>`).join('')}</ul>
      <div class="macros">탄 ${m.total.carb}g · 단 ${m.total.protein}g · 지 ${m.total.fat}g</div>
    </div>`).join('');
}

function renderSnackRecs() {
  const t = dayTotals(curDate);
  const profile = { ...state.profile, weight: latestWeight(curDate) };
  const remain = AI.targetKcal(profile) - t.net;
  const snacks = AI.recommendSnacks(Math.max(100, remain), 8);
  $('#snackRecs').innerHTML = (remain < 50
      ? '<p class="empty">오늘은 목표 칼로리를 거의 다 썼어요. 물이나 제로 음료를 권합니다.</p>'
      : snacks.map(s => `<span class="chip">${esc(s.name)} ${esc(s.amount)} · <b>${s.kcal}kcal</b> · 단백질 ${s.protein}g</span>`).join(''));
}

$('#refreshEx').addEventListener('click', renderExRecs);
function renderExRecs() {
  const kcal = +$('#burnTargetKcal').value || 300;
  const w = latestWeight(curDate);
  const list = AI.recommendExercises(kcal, w, $('#preferType').value);
  $('#exRecs').innerHTML = `<table>
    <thead><tr><th>운동</th><th>종류</th><th>강도(MET)</th><th>30분 소모</th><th>${kcal}kcal 필요 시간</th></tr></thead>
    <tbody>${list.map(e => `<tr>
      <td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${e.met}</td>
      <td>${e.kcal30}kcal</td>
      <td>${e.minutes}분${e.realistic ? '' : ' <span style="opacity:.6">(너무 길어요)</span>'}</td>
    </tr>`).join('')}</tbody></table>
    <p class="hint" style="margin-top:10px">체중 ${w}kg 기준으로 계산했습니다.</p>`;
}

$('#refreshRoutine').addEventListener('click', renderRoutine);
function renderRoutine() {
  const w = latestWeight(curDate);
  const plan = AI.recommendRoutine(w, $('#routineLevel').value);
  $('#routineBox').innerHTML = plan.days.map(d => `
    <div class="rec">
      <h3>${esc(d.day)}</h3>
      <div class="kcal">약 ${d.total} kcal 소모</div>
      <ul>${d.items.map(i => `<li>${esc(i.name)} ${i.minutes}분 <span style="opacity:.7">${i.kcal}kcal</span></li>`).join('')}</ul>
    </div>`).join('');
}

/* ============================================================
 *  운동 백과
 * ========================================================== */
$('#exSearch').addEventListener('input', renderLibrary);
$('#exFilter').addEventListener('change', renderLibrary);

function renderLibrary() {
  const w = latestWeight(curDate);
  $('#libWeight').textContent = w;
  const q = AI.norm($('#exSearch').value);
  const type = $('#exFilter').value;

  const list = EXERCISE_DB.filter(e => {
    if (type && e.type !== type) return false;
    if (!q) return true;
    return [e.n].concat(e.a||[]).some(k => AI.norm(k).includes(q)) || AI.similarity(q, e.n) > 0.5;
  });

  if (!list.length) { $('#exLibrary').innerHTML = '<p class="empty">검색 결과가 없습니다.</p>'; return; }

  $('#exLibrary').innerHTML = list.map(e => `
    <article class="ex-card">
      <header><h3>${esc(e.n)}</h3><span class="pill">${esc(e.type)}</span></header>
      <div class="meta">주요 부위: ${esc(e.part)} · 강도 ${e.met} MET</div>
      <div class="burn">30분 하면 약 ${AI.burnedKcal(e.met, w, 30)}kcal 소모 (체중 ${w}kg)</div>
      <ol>${e.how.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="tip">💡 ${esc(e.tip)}</div>
      <div class="warn-line">⚠️ ${esc(e.warn)}</div>
    </article>`).join('');
}

/* ============================================================
 *  내 정보
 * ========================================================== */
(function fillSelects() {
  $('#pActivity').innerHTML = Object.entries(AI.ACTIVITY)
    .map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('#pGoal').innerHTML = Object.entries(AI.GOALS)
    .map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
})();

function renderSettings() {
  const p = state.profile;
  $('#pGender').value = p.gender;
  $('#pAge').value = p.age;
  $('#pHeight').value = p.height;
  $('#pWeight').value = p.weight;
  $('#pGoalWeight').value = p.goalWeight;
  $('#pActivity').value = p.activity;
  $('#pGoal').value = p.goal;

  const bmiV = AI.bmi(p), macros = AI.targetMacros(p);
  $('#cBmi').textContent     = `${bmiV} (${AI.bmiLabel(bmiV)})`;
  $('#cBmr').textContent     = AI.bmr(p) + ' kcal';
  $('#cTdee').textContent    = AI.tdee(p) + ' kcal';
  $('#cTarget').textContent  = AI.targetKcal(p) + ' kcal';
  $('#cProtein').textContent = macros.protein + ' g';
  $('#cFat').textContent     = macros.fat + ' g';
  $('#cCarb').textContent    = macros.carb + ' g';

  const gap = +(p.weight - p.goalWeight).toFixed(1);
  $('#cToGoal').textContent = gap > 0
    ? `${gap}kg (약 ${Math.round(gap * 7700).toLocaleString()}kcal)`
    : (gap === 0 ? '달성!' : `${Math.abs(gap)}kg 더 늘리기`);
}

$('#saveProfile').addEventListener('click', () => {
  const p = {
    gender: $('#pGender').value,
    age: +$('#pAge').value || 17,
    height: +$('#pHeight').value || 170,
    weight: +$('#pWeight').value || 65,
    goalWeight: +$('#pGoalWeight').value || 60,
    activity: $('#pActivity').value,
    goal: $('#pGoal').value
  };
  if (p.height < 100 || p.height > 230) return toast('키를 100~230cm로 입력하세요.');
  if (p.weight < 20 || p.weight > 300)  return toast('체중을 20~300kg로 입력하세요.');
  state.profile = p;
  save();
  renderSettings(); renderToday();
  toast('내 정보를 저장했습니다.');
});

/* ============================================================
 *  구글 로그인 — cloud.js 와 주고받는 창구
 * ========================================================== */

let authStatus = 'loading';   // loading | disabled | ready | signed-in | signed-out | error
let authUser = null;

/** cloud.js가 로그인 상태를 알려줄 때 호출 */
function setAuthState({ status, user, message }) {
  if (status === 'ready') { if (authStatus === 'loading') authStatus = 'signed-out'; renderAuth(); return; }
  authStatus = status;
  if (status === 'signed-in') {
    authUser = user;
  } else if (status === 'signed-out') {
    if (currentUid) {           // 로그아웃 → 게스트 저장소로 전환
      currentUid = null;
      state = load();
      renderToday(); renderSettings();
    }
    authUser = null;
  } else if (status === 'error') {
    toast(message || '로그인 중 문제가 생겼습니다.');
  }
  renderAuth();
}

/**
 * 로그인 직후 cloud.js가 서버 기록을 넘겨준다.
 * remote 가 null 이면 그 계정의 첫 로그인.
 */
function applyCloudData(uid, remote) {
  const wasGuest = !currentUid;
  const guestData = wasGuest ? state : load(null);
  currentUid = uid;

  const cached = load(uid);                        // 이 기기에 남아 있던 같은 계정 기록
  let next = mergeStates(cached, remote || {});

  // 이 계정으로 처음 로그인했는데 로그인 전 기록이 남아 있으면 옮길지 묻는다.
  // 한 번 묻고 나면 다시 묻지 않는다 (같은 컴퓨터를 여러 사람이 쓸 때 서로 섞이지 않게)
  const asked = localStorage.getItem('dietTracker.migrateAsked');
  if (!remote && !asked && !hasRecords(cached) && hasRecords(guestData)) {
    if (confirm('로그인 전에 이 기기에 저장해 둔 기록이 있습니다.\n내 계정으로 옮길까요?\n\n(옮기지 않으면 로그아웃 상태에서만 보입니다)')) {
      next = mergeStates(guestData, next);
      localStorage.removeItem(GUEST_KEY);          // 옮겼으니 게스트 쪽은 비운다
    }
    localStorage.setItem('dietTracker.migrateAsked', '1');
  }

  state = next;
  save();                                          // 합친 결과를 계정 저장소와 클라우드에 기록
  renderToday(); renderSettings();
  if (document.querySelector('#stats').classList.contains('active')) renderStats();
}

/** 동기화 상태 표시 */
function setSyncState(kind, message) {
  const el = $('#syncState');
  if (!el) return;
  const map = {
    loading: ['기록 불러오는 중…', ''],
    pending: ['저장 중…', ''],
    saving:  ['저장 중…', ''],
    saved:   ['☁️ 저장됨', 'ok'],
    error:   ['⚠️ 동기화 실패', 'bad']
  };
  const [text, cls] = map[kind] || ['', ''];
  el.textContent = text;
  el.className = 'sync ' + cls;
  el.title = message || '';
  if (kind === 'error' && message) toast(message);
}

function renderAuth() {
  const box = $('#authBox');
  if (!box) return;

  if (authStatus === 'disabled') {
    box.innerHTML = `<span class="auth-note" title="js/firebase-config.js를 설정하면 구글 로그인이 켜집니다">로컬 모드</span>`;
    return;
  }
  if (authStatus === 'loading') { box.innerHTML = `<span class="auth-note">연결 중…</span>`; return; }

  if (authStatus === 'signed-in' && authUser) {
    box.innerHTML = `
      <span class="sync" id="syncState"></span>
      ${authUser.photo ? `<img class="avatar" src="${esc(authUser.photo)}" alt="">` : ''}
      <span class="auth-name" title="${esc(authUser.email || '')}">${esc(authUser.name)}</span>
      <button id="signOutBtn" class="ghost-btn small">로그아웃</button>`;
    $('#signOutBtn').addEventListener('click', async () => {
      if (!confirm('로그아웃할까요? 기록은 클라우드에 저장돼 있어 다시 로그인하면 돌아옵니다.')) return;
      await window.Cloud.signOut();
      toast('로그아웃했습니다.');
    });
    return;
  }

  box.innerHTML = `<button id="signInBtn" class="google-btn">
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Google로 로그인</button>`;
  $('#signInBtn').addEventListener('click', () => {
    if (!window.Cloud) return toast('아직 연결 중입니다. 잠시 후 다시 눌러 주세요.');
    window.Cloud.signIn();
  });
}

window.App = { setAuthState, applyCloudData, setSyncState };

/* ============================================================
 *  시작
 * ========================================================== */
renderAuth();
renderToday();
renderSettings();
window.addEventListener('resize', () => { if ($('#stats').classList.contains('active')) renderStats(); });

})();
