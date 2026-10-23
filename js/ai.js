/* ============================================================
 *  ai.js  —  내장 분석 엔진
 *
 *  외부 API 없이 브라우저 안에서 동작하는 규칙기반 AI 엔진.
 *    1) 자연어 음식 기록 → 음식/수량 추출 → 칼로리·탄단지 계산
 *    2) 자연어 운동 기록 → 운동/시간 추출 → MET 공식으로 소모 칼로리 계산
 *    3) 개인 신체정보 → BMR·TDEE·목표 칼로리 계산
 *    4) 남은 칼로리에 맞춘 식단 추천 / 운동 추천
 * ============================================================ */

const AI = (() => {

  /* ------------------------------------------------------------
   * 0. 문자열 도구
   * ---------------------------------------------------------- */

  // 비교용 정규화: 공백·특수문자 제거, 소문자화
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_.,!?~()[\]]/g, '');
  }

  // 자모 단위 2-gram 유사도 (Dice coefficient) — 오타에 강하다
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const grams = s => {
      const out = [];
      for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
      return out;
    };
    const ga = grams(a), gb = grams(b);
    const pool = gb.slice();
    let hit = 0;
    ga.forEach(g => {
      const idx = pool.indexOf(g);
      if (idx >= 0) { hit++; pool.splice(idx, 1); }
    });
    return (2 * hit) / (ga.length + gb.length);
  }

  /* ------------------------------------------------------------
   * 1. 수량 파싱
   * ---------------------------------------------------------- */

  const KOR_NUM = {
    '반':0.5, '한':1, '하나':1, '일':1, '두':2, '둘':2, '이':2, '세':3, '셋':3, '삼':3,
    '네':4, '넷':4, '사':4, '다섯':5, '오':5, '여섯':6, '육':6, '일곱':7, '여덟':8,
    '아홉':9, '열':10
  };

  // 양을 뜻하는 수식어
  const SIZE_MOD = [
    { re:/곱빼기|곱배기|라지|대|킹|점보/, mul:1.5 },
    { re:/많이|듬뿍|산더미/,             mul:1.4 },
    { re:/조금|약간|살짝|미니|스몰|작은/, mul:0.6 },
    { re:/반\s*공기|반공기/,             mul:0.5 }
  ];

  const UNITS = ['공기','인분','그릇','개','조각','잔','캔','줄','장','봉지','줌','병','마리','판','컵','쪽','토막','스푼'];

  /**
   * "김치찌개 1인분" / "밥 반공기" / "닭가슴살 200g" 같은 한 조각에서
   * 수량·단위·음식이름을 떼어낸다.
   */
  function splitQuantity(chunk) {
    let text = chunk.trim();
    let qty = null, unit = null, grams = null, mul = 1;

    // 1) 그램 / ml 표기
    const gm = text.match(/(\d+(?:\.\d+)?)\s*(g|그램|그람|ml|밀리|cc)/i);
    if (gm) {
      grams = parseFloat(gm[1]);
      text = text.replace(gm[0], ' ');
    }

    // 2) 숫자 + 단위
    if (grams === null) {
      const nm = text.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + UNITS.join('|') + ')?'));
      if (nm && nm[1]) {
        qty = parseFloat(nm[1]);
        unit = nm[2] || null;
        text = text.replace(nm[0], ' ');
      }
    }

    // 3) 한글 수량 ("두 공기", "세 조각", "반 공기")
    if (qty === null && grams === null) {
      const km = text.match(new RegExp('(' + Object.keys(KOR_NUM).join('|') + ')\\s*(' + UNITS.join('|') + ')'));
      if (km) {
        qty = KOR_NUM[km[1]];
        unit = km[2];
        text = text.replace(km[0], ' ');
      }
    }

    // 4) 크기 수식어
    SIZE_MOD.forEach(m => {
      if (m.re.test(text)) { mul *= m.mul; text = text.replace(m.re, ' '); }
    });

    const name = text.replace(/\s+/g, ' ').trim();
    return { name, qty, unit, grams, mul };
  }

  /* ------------------------------------------------------------
   * 2. 음식 매칭
   * ---------------------------------------------------------- */

  function matchFood(name) {
    const q = norm(name);
    if (!q) return null;
    let best = null, bestScore = 0;

    FOOD_DB.forEach(food => {
      const keys = [food.n].concat(food.a || []);
      keys.forEach(key => {
        const k = norm(key);
        let score;
        if (q === k)                 score = 1.00;
        else if (q.includes(k))      score = 0.92 - Math.min(0.2, (q.length - k.length) * 0.02);
        else if (k.includes(q))      score = q.length >= 2 ? 0.86 : 0.4;
        else                         score = similarity(q, k) * 0.8;

        if (score > bestScore) { bestScore = score; best = food; }
      });
    });

    if (bestScore < 0.45) return null;
    return { food: best, score: +bestScore.toFixed(2) };
  }

  // 수량·단위를 뜻하는 낱말인지 (음식 이름의 시작으로 보면 안 되는 단어)
  function isQuantityWord(word) {
    const w = norm(word);
    if (!w) return true;
    if (/^\d/.test(w)) return true;
    if (UNITS.includes(w)) return true;
    if (KOR_NUM[w] !== undefined) return true;
    return /^(아침|점심|저녁|야식|간식|오전|오후|새벽|곱빼기|곱배기|라지|조금|약간|살짝|많이|듬뿍)$/.test(w);
  }

  /**
   * 쉼표 없이 이어 쓴 문장을 음식 단위로 쪼갠다.
   * "닭가슴살 200g 샐러드 1인분" → ["닭가슴살 200g", "샐러드 1인분"]
   */
  function segmentChunk(chunk) {
    const words = chunk.split(/\s+/).filter(Boolean);
    const segs = [];
    let cur = [];
    words.forEach((word, idx) => {
      const bare = word.replace(/\d+(\.\d+)?\s*(g|그램|그람|ml|밀리|cc)?/gi, '').trim();
      const starts = idx > 0 && cur.length > 0 && !isQuantityWord(bare) &&
                     (() => { const m = matchFood(bare); return m && m.score >= 0.85; })();
      if (starts) { segs.push(cur.join(' ')); cur = []; }
      cur.push(word);
    });
    if (cur.length) segs.push(cur.join(' '));
    return segs;
  }

  /**
   * 자연어 식사 기록 전체를 분석한다.
   * 예) "아침에 쌀밥 한 공기랑 김치찌개 1인분, 계란 2개 먹었다"
   */
  function analyzeMeal(text) {
    const rough = String(text || '')
      .replace(/먹었[다어음]|먹음|섭취|그리고|이랑|랑\s|하고\s|과\s|와\s/g, ',')
      .split(/[,\n+·/]| 그리고 /)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const chunks = [];
    rough.forEach(r => segmentChunk(r).forEach(s => chunks.push(s)));

    const items = [];
    chunks.forEach(chunk => {
      // 시간대 단어만 있는 조각은 건너뛴다
      if (/^(아침|점심|저녁|야식|간식|오전|오후|새벽)$/.test(norm(chunk))) return;
      const cleaned = chunk.replace(/^(아침|점심|저녁|야식|간식|오전|오후|새벽)에?\s*/, '');
      const q = splitQuantity(cleaned);
      if (!q.name) return;

      const m = matchFood(q.name);

      if (!m) {
        // DB에 없는 음식 → 보수적으로 추정값을 넣고 사용자가 고칠 수 있게 표시
        items.push({
          input: chunk.trim(), name: q.name, qty: q.qty || 1, unit: q.unit || '인분',
          kcal: 350, carb: 40, protein: 12, fat: 14,
          confidence: 0.2, guessed: true, dbName: null
        });
        return;
      }

      const f = m.food;
      let factor;
      let unitLabel, qtyLabel;

      if (q.grams !== null) {
        factor = q.grams / f.g;
        unitLabel = 'g'; qtyLabel = q.grams;
      } else {
        const qty = q.qty === null ? 1 : q.qty;
        factor = qty;
        unitLabel = q.unit || f.u;
        qtyLabel = q.mul === 1 ? qty : +(qty * q.mul).toFixed(2);
      }
      factor *= q.mul;

      items.push({
        input: chunk.trim(),
        name: f.n,
        dbName: f.n,
        qty: qtyLabel,
        unit: unitLabel,
        kcal:    Math.round(f.k * factor),
        carb:   +(f.c * factor).toFixed(1),
        protein:+(f.p * factor).toFixed(1),
        fat:    +(f.f * factor).toFixed(1),
        confidence: m.score,
        guessed: false,
        tags: f.t
      });
    });

    return { items, total: sumItems(items) };
  }

  function sumItems(items) {
    return items.reduce((a, i) => ({
      kcal: a.kcal + (+i.kcal || 0),
      carb: +(a.carb + (+i.carb || 0)).toFixed(1),
      protein: +(a.protein + (+i.protein || 0)).toFixed(1),
      fat: +(a.fat + (+i.fat || 0)).toFixed(1)
    }), { kcal:0, carb:0, protein:0, fat:0 });
  }

  /* ------------------------------------------------------------
   * 3. 운동 분석
   * ---------------------------------------------------------- */

  function matchExercise(name) {
    const q = norm(name);
    if (!q) return null;
    let best = null, bestScore = 0;
    EXERCISE_DB.forEach(ex => {
      [ex.n].concat(ex.a || []).forEach(key => {
        const k = norm(key);
        let score;
        if (q === k)            score = 1;
        else if (q.includes(k)) score = 0.9;
        else if (k.includes(q)) score = q.length >= 2 ? 0.85 : 0.4;
        else                    score = similarity(q, k) * 0.8;
        if (score > bestScore) { bestScore = score; best = ex; }
      });
    });
    return bestScore < 0.45 ? null : { ex: best, score: +bestScore.toFixed(2) };
  }

  // MET 공식: kcal = MET x 3.5 x 체중(kg) / 200 x 분
  function burnedKcal(met, weightKg, minutes) {
    return Math.round(met * 3.5 * weightKg / 200 * minutes);
  }

  /** 시간 추출: "30분", "1시간 20분", "한시간", "1시간반" */
  function parseMinutes(text) {
    let min = 0, found = false;
    const h = text.match(/(\d+(?:\.\d+)?)\s*(시간|h|hr)/i);
    if (h) { min += parseFloat(h[1]) * 60; found = true; }
    const korH = text.match(new RegExp('(' + Object.keys(KOR_NUM).join('|') + ')\\s*시간'));
    if (!h && korH) { min += KOR_NUM[korH[1]] * 60; found = true; }
    if (found && /시간\s*반/.test(text)) min += 30;

    const m = text.match(/(\d+(?:\.\d+)?)\s*(분|min)/i);
    if (m) { min += parseFloat(m[1]); found = true; }

    // 세트/횟수만 적은 경우 대략 환산 (1세트 ≈ 2분)
    if (!found) {
      const s = text.match(/(\d+)\s*(세트|set)/i);
      if (s) { min = parseInt(s[1]) * 2; found = true; }
    }
    return found ? min : null;
  }

  /**
   * 자연어 운동 기록 분석
   * 예) "달리기 30분, 스쿼트 4세트, 자전거 1시간"
   */
  function analyzeWorkout(text, weightKg) {
    const w = weightKg || 65;
    const chunks = String(text || '')
      .replace(/했[다어음]|하고|그리고|및/g, ',')
      .split(/[,\n+·/]/)
      .map(s => s.trim()).filter(Boolean);

    const items = [];
    chunks.forEach(chunk => {
      const minutes = parseMinutes(chunk);
      const nameOnly = chunk
        .replace(/\d+(\.\d+)?\s*(시간|분|세트|set|h|hr|min)/gi, ' ')
        .replace(new RegExp('(' + Object.keys(KOR_NUM).join('|') + ')\\s*시간', 'g'), ' ')
        .replace(/반/g, ' ')
        .replace(/\s+/g, ' ').trim();

      const m = matchExercise(nameOnly);
      const mins = minutes === null ? 30 : minutes;

      if (!m) {
        if (!nameOnly) return;
        items.push({
          input: chunk, name: nameOnly, minutes: mins, met: 5.0,
          kcal: burnedKcal(5.0, w, mins), guessed: true, type:'기타', part:'-'
        });
        return;
      }

      items.push({
        input: chunk,
        name: m.ex.n,
        minutes: mins,
        met: m.ex.met,
        kcal: burnedKcal(m.ex.met, w, mins),
        guessed: false,
        assumedTime: minutes === null,
        type: m.ex.type,
        part: m.ex.part,
        confidence: m.score
      });
    });

    return { items, total: items.reduce((a, i) => a + i.kcal, 0) };
  }

  /* ------------------------------------------------------------
   * 4. 신체 계산 (BMR / TDEE / 목표 칼로리)
   * ---------------------------------------------------------- */

  const ACTIVITY = {
    sedentary: { label:'거의 안 움직임 (앉아서 공부/일)', f:1.2 },
    light:     { label:'가벼운 활동 (주 1~3회 운동)',     f:1.375 },
    moderate:  { label:'보통 활동 (주 3~5회 운동)',       f:1.55 },
    active:    { label:'활발함 (주 6~7회 운동)',          f:1.725 },
    athlete:   { label:'매우 활발 (운동선수급)',          f:1.9 }
  };

  const GOALS = {
    lose_fast: { label:'빠른 감량 (주 -0.7kg)', delta:-700 },
    lose:      { label:'감량 (주 -0.4kg)',      delta:-400 },
    maintain:  { label:'체중 유지',             delta:0 },
    gain:      { label:'증량 (주 +0.3kg)',      delta:+300 }
  };

  // Mifflin-St Jeor 공식
  function bmr(profile) {
    const { gender, weight, height, age } = profile;
    const base = 10 * weight + 6.25 * height - 5 * age;
    return Math.round(gender === 'female' ? base - 161 : base + 5);
  }

  function tdee(profile) {
    const f = (ACTIVITY[profile.activity] || ACTIVITY.light).f;
    return Math.round(bmr(profile) * f);
  }

  function targetKcal(profile) {
    const t = tdee(profile) + (GOALS[profile.goal] || GOALS.maintain).delta;
    // 안전 하한선: 기초대사량의 85% 아래로는 내려가지 않게 한다
    const floor = Math.round(bmr(profile) * 0.85);
    return Math.max(t, floor);
  }

  function bmi(profile) {
    const h = profile.height / 100;
    return +(profile.weight / (h * h)).toFixed(1);
  }

  function bmiLabel(v) {
    if (v < 18.5) return '저체중';
    if (v < 23)   return '정상';
    if (v < 25)   return '과체중';
    if (v < 30)   return '경도 비만';
    return '비만';
  }

  // 목표 탄단지 (단백질 체중x1.6g, 지방 25%, 나머지 탄수화물)
  function targetMacros(profile) {
    const kcal = targetKcal(profile);
    const protein = Math.round(profile.weight * 1.6);
    const fat = Math.round(kcal * 0.25 / 9);
    const carb = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, carb, protein, fat };
  }

  /* ------------------------------------------------------------
   * 5. 식단 추천
   * ---------------------------------------------------------- */

  const MEAL_TEMPLATES = [
    { name:'든든한 한식 한 상',   parts:[['잡곡밥',0.7],['된장찌개',1],['닭가슴살',1],['나물',1],['김치',1]] },
    { name:'고단백 구이 세트',     parts:[['잡곡밥',0.7],['고등어구이',1],['샐러드',1],['김치',1]] },
    { name:'연어 샐러드 플레이트', parts:[['연어',1],['샐러드',1.5],['고구마',0.7]] },
    { name:'닭가슴살 포케볼',      parts:[['포케',1]] },
    { name:'오트밀 아침',          parts:[['오트밀',1],['우유',1],['바나나',1]] },
    { name:'계란 토스트 아침',     parts:[['통밀빵',2],['계란',2],['토마토',1]] },
    { name:'그릭요거트 + 과일',    parts:[['요거트',1],['블루베리',1],['견과류',1]] },
    { name:'두부 덮밥',            parts:[['잡곡밥',0.7],['두부',1],['나물',1],['미역국',1]] },
    { name:'회 + 밥 가볍게',       parts:[['생선회',1],['잡곡밥',0.5],['미역국',1]] },
    { name:'메밀소바 한 그릇',     parts:[['메밀소바',1],['계란',1]] },
    { name:'쌀국수 한 그릇',       parts:[['쌀국수',1]] },
    { name:'비빔밥 한 그릇',       parts:[['비빔밥',1]] },
    { name:'불고기 정식',          parts:[['쌀밥',1],['불고기',1],['나물',1],['김치',1]] },
    { name:'프로틴 간단식',        parts:[['프로틴쉐이크',1],['바나나',1],['견과류',1]] },
    { name:'삼계탕 보양식',        parts:[['삼계탕',1],['김치',1]] },
    { name:'초밥 세트',            parts:[['초밥',1],['미역국',1]] },
    { name:'샐러드 + 고구마',      parts:[['샐러드',1.5],['고구마',1],['계란',2]] },
    { name:'순두부 백반',          parts:[['잡곡밥',0.7],['순두부찌개',1],['김치',1]] }
  ];

  function buildMeal(tpl) {
    const items = [];
    tpl.parts.forEach(([name, factor]) => {
      const f = FOOD_DB.find(x => x.n === name);
      if (!f) return;
      items.push({
        name: f.n,
        amount: (factor === 1 ? '1' : factor) + f.u,
        kcal: Math.round(f.k * factor),
        carb: +(f.c * factor).toFixed(1),
        protein: +(f.p * factor).toFixed(1),
        fat: +(f.f * factor).toFixed(1)
      });
    });
    return { name: tpl.name, items, total: sumItems(items) };
  }

  /**
   * 남은 칼로리에 가까운 식단을 추천한다.
   * @param {number} remainKcal 이 끼니에 쓸 수 있는 칼로리
   * @param {number} count      추천 개수
   */
  function recommendMeals(remainKcal, count) {
    const target = Math.max(200, remainKcal || 600);
    const meals = MEAL_TEMPLATES.map(buildMeal);

    meals.forEach(m => {
      const diff = Math.abs(m.total.kcal - target);
      // 칼로리가 비슷하고 단백질 비율이 높은 식단을 우대
      const proteinRatio = m.total.protein * 4 / Math.max(1, m.total.kcal);
      m._score = diff - proteinRatio * 1200;
    });

    meals.sort((a, b) => a._score - b._score);
    return meals.slice(0, count || 3);
  }

  /** 간식 추천: 남은 칼로리 안에 들어오는 가벼운 음식 */
  function recommendSnacks(remainKcal, count) {
    return FOOD_DB
      .filter(f => (f.t.includes('간식') || f.t.includes('과일')) &&
                   f.k <= Math.min(250, Math.max(80, remainKcal)))
      .sort((a, b) => (b.p / Math.max(1, b.k)) - (a.p / Math.max(1, a.k)))
      .slice(0, count || 5)
      .map(f => ({ name: f.n, amount: '1' + f.u, kcal: f.k, protein: f.p }));
  }

  /* ------------------------------------------------------------
   * 6. 운동 추천
   * ---------------------------------------------------------- */

  /**
   * 목표 소모 칼로리를 채우는 데 필요한 시간을 운동별로 계산한다.
   * @param {number} kcalToBurn 태우고 싶은 칼로리
   * @param {number} weightKg   체중
   * @param {string} prefer     '유산소' | '근력' | '' (전체)
   */
  function recommendExercises(kcalToBurn, weightKg, prefer) {
    const w = weightKg || 65;
    const goal = Math.max(50, kcalToBurn || 300);
    return EXERCISE_DB
      .filter(e => !prefer || e.type === prefer)
      .map(e => {
        const perMin = e.met * 3.5 * w / 200;
        const minutes = Math.round(goal / perMin);
        return {
          name: e.n, type: e.type, part: e.part, met: e.met,
          minutes,
          kcal30: Math.round(perMin * 30),
          how: e.how, tip: e.tip, warn: e.warn,
          realistic: minutes <= 90
        };
      })
      .sort((a, b) => a.minutes - b.minutes);
  }

  /** 하루 운동 루틴 추천 (유산소 + 근력 조합) */
  function recommendRoutine(weightKg, level) {
    const w = weightKg || 65;
    const plans = {
      beginner: {
        label:'입문 (주 3회 · 하루 30분)',
        days:[
          { day:'1일차', list:[['걷기',30]] },
          { day:'2일차', list:[['스쿼트',10],['푸시업',8],['플랭크',5]] },
          { day:'3일차', list:[['빨리걷기',30]] }
        ]
      },
      normal: {
        label:'기본 (주 4회 · 하루 45분)',
        days:[
          { day:'1일차 하체', list:[['스쿼트',15],['런지',10],['걷기',20]] },
          { day:'2일차 유산소', list:[['빨리걷기',40]] },
          { day:'3일차 상체', list:[['푸시업',15],['풀업',10],['플랭크',8]] },
          { day:'4일차 유산소', list:[['자전거',40]] }
        ]
      },
      hard: {
        label:'고강도 (주 5회 · 하루 60분)',
        days:[
          { day:'1일차 하체', list:[['스쿼트',20],['데드리프트',20],['계단오르기',15]] },
          { day:'2일차 유산소', list:[['달리기',35],['줄넘기',10]] },
          { day:'3일차 상체', list:[['풀업',15],['푸시업',15],['웨이트',25]] },
          { day:'4일차 HIIT', list:[['HIIT',20],['플랭크',8]] },
          { day:'5일차 유산소', list:[['자전거',50]] }
        ]
      }
    };
    const plan = plans[level] || plans.normal;
    plan.days.forEach(d => {
      d.items = d.list.map(([name, min]) => {
        const e = EXERCISE_DB.find(x => x.n === name);
        return { name, minutes: min, kcal: burnedKcal(e ? e.met : 5, w, min) };
      });
      d.total = d.items.reduce((a, i) => a + i.kcal, 0);
    });
    return plan;
  }

  /* ------------------------------------------------------------
   * 7. 하루 코칭 메시지
   * ---------------------------------------------------------- */

  function coachMessage(day, profile) {
    const target = targetKcal(profile);
    const net = day.intake - day.burned;
    const remain = target - net;
    const msgs = [];

    if (day.intake === 0) {
      msgs.push({ tone:'info', text:'아직 오늘 먹은 걸 기록하지 않았어요. 먹은 그대로 적는 게 다이어트의 90%입니다.' });
      return msgs;
    }

    if (remain > 300)
      msgs.push({ tone:'ok', text:`${remain}kcal 남았어요. 단백질 위주로 한 끼 더 채워도 좋습니다.` });
    else if (remain >= -100)
      msgs.push({ tone:'ok', text:`목표에 거의 딱 맞췄습니다 (${remain >= 0 ? '+' : ''}${remain}kcal). 아주 좋아요.` });
    else
      msgs.push({ tone:'warn', text:`목표보다 ${Math.abs(remain)}kcal 초과했어요. ${Math.round(Math.abs(remain) / (6 * 3.5 * profile.weight / 200))}분 정도 빨리 걷기로 상쇄할 수 있습니다.` });

    const macros = targetMacros(profile);
    if (day.protein < macros.protein * 0.7)
      msgs.push({ tone:'warn', text:`단백질이 ${day.protein}g으로 목표(${macros.protein}g)에 모자라요. 근손실을 막으려면 계란·닭가슴살·그릭요거트를 추가하세요.` });
    if (day.fat > macros.fat * 1.3)
      msgs.push({ tone:'warn', text:`지방이 ${day.fat}g으로 많습니다. 튀김·가공육을 줄이면 같은 양을 먹어도 칼로리가 내려갑니다.` });
    if (day.burned === 0)
      msgs.push({ tone:'info', text:'오늘 운동 기록이 없어요. 10분 걷기라도 적어두면 흐름이 끊기지 않습니다.' });

    return msgs;
  }

  /* ------------------------------------------------------------
   * public API
   * ---------------------------------------------------------- */
  return {
    norm, similarity, matchFood, matchExercise,
    analyzeMeal, analyzeWorkout, sumItems, burnedKcal,
    bmr, tdee, targetKcal, bmi, bmiLabel, targetMacros,
    recommendMeals, recommendSnacks, recommendExercises, recommendRoutine,
    coachMessage,
    ACTIVITY, GOALS
  };
})();

if (typeof window !== 'undefined') window.AI = AI;
