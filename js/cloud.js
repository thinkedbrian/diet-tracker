/* ============================================================
 *  cloud.js  —  구글 로그인 + 계정별 클라우드 저장 (Firebase)
 *
 *  · 설정(js/firebase-config.js)이 비어 있으면 아무것도 하지 않고
 *    앱은 기존처럼 "로컬 모드"(이 브라우저에만 저장)로 동작합니다.
 *  · 로그인하면 users/{uid} 문서 하나에 내 기록 전체를 저장/복원합니다.
 *  · app.js 와는 window.App / window.Cloud 두 창구로만 주고받습니다.
 * ============================================================ */

const SDK = 'https://www.gstatic.com/firebasejs/11.6.1/';

/** 설정이 아직 자리표시자인지 검사 */
function isUnconfigured(cfg) {
  if (!cfg) return true;
  return ['apiKey','authDomain','projectId','appId'].some(k =>
    !cfg[k] || /여기에|YOUR_|PASTE|xxxx/i.test(cfg[k]));
}

const cfg = window.FIREBASE_CONFIG;

if (isUnconfigured(cfg)) {
  // 설정 전 — 로컬 모드로 알려주고 종료
  window.App && window.App.setAuthState({ status:'disabled' });
} else {
  bootstrap().catch(err => {
    console.error('[cloud] 초기화 실패', err);
    window.App && window.App.setAuthState({ status:'error', message: err.message });
  });
}

async function bootstrap() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);

  const {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged,
    setPersistence, browserLocalPersistence
  } = authMod;
  const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = fsMod;

  const app  = initializeApp(cfg);
  const auth = getAuth(app);
  const db   = getFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try { await setPersistence(auth, browserLocalPersistence); } catch (e) { /* 무시 */ }

  // 팝업이 막혀 리다이렉트로 로그인한 경우의 결과 처리
  try { await getRedirectResult(auth); } catch (e) { console.warn('[cloud] redirect 결과', e.code || e); }

  let user = null;
  let saveTimer = null;
  let pending = null;

  /* ---------- 저장 ---------- */
  async function flush() {
    if (!pending || !user) return;
    const data = pending; pending = null;
    try {
      App.setSyncState('saving');
      await setDoc(doc(db, 'users', user.uid), {
        profile: data.profile,
        days: data.days,
        updatedAt: serverTimestamp()
      });
      App.setSyncState('saved');
    } catch (e) {
      console.error('[cloud] 저장 실패', e);
      App.setSyncState('error', translate(e.code) || e.message);
    }
  }

  function scheduleSave(data) {
    if (!user) return;
    pending = JSON.parse(JSON.stringify(data));
    App.setSyncState('pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1500);
  }

  // 탭을 닫거나 숨길 때 남은 변경사항을 한 번 더 시도
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); flush(); }
  });

  /* ---------- 불러오기 ---------- */
  async function pull(uid) {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  }

  /* ---------- 로그인 상태 변화 ---------- */
  onAuthStateChanged(auth, async u => {
    user = u;
    if (!u) {
      clearTimeout(saveTimer); pending = null;
      App.setAuthState({ status:'signed-out' });
      return;
    }

    App.setAuthState({
      status:'signed-in',
      user: { uid:u.uid, name:u.displayName || '사용자', email:u.email, photo:u.photoURL }
    });

    try {
      App.setSyncState('loading');
      const remote = await pull(u.uid);
      App.applyCloudData(u.uid, remote);     // 병합은 app.js가 담당
      App.setSyncState('saved');
    } catch (e) {
      console.error('[cloud] 불러오기 실패', e);
      App.setSyncState('error', translate(e.code) || e.message);
    }
  });

  /* ---------- 외부 창구 ---------- */
  window.Cloud = {
    ready: true,
    scheduleSave,
    flush,
    async signIn() {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        // 팝업이 막히거나 지원되지 않으면 리다이렉트 방식으로 재시도
        if (['auth/popup-blocked','auth/operation-not-supported-in-this-environment',
             'auth/cancelled-popup-request'].includes(e.code)) {
          return signInWithRedirect(auth, provider);
        }
        if (e.code === 'auth/popup-closed-by-user') return;   // 사용자가 직접 닫음
        console.error('[cloud] 로그인 실패', e);
        App.setAuthState({ status:'error', message: translate(e.code) || e.message });
      }
    },
    async signOut() {
      clearTimeout(saveTimer);
      await flush();
      await signOut(auth);
    }
  };

  App.setAuthState({ status:'ready' });
}

/** Firebase 오류 코드를 한국어 안내로 */
function translate(code) {
  const map = {
    'auth/unauthorized-domain': '이 주소가 Firebase에 등록돼 있지 않습니다. Authentication → Settings → 승인된 도메인에 추가하세요.',
    'auth/operation-not-allowed': 'Firebase 콘솔에서 Google 로그인 제공업체를 켜지 않았습니다.',
    'auth/network-request-failed': '네트워크 연결을 확인해 주세요.',
    'permission-denied': 'Firestore 보안 규칙에 막혔습니다. firestore.rules 내용을 콘솔에 반영했는지 확인하세요.',
    'unavailable': '네트워크가 불안정합니다. 기록은 이 브라우저에 저장돼 있으니 나중에 다시 동기화됩니다.',
    'failed-precondition': 'Firestore 데이터베이스가 아직 만들어지지 않았습니다.'
  };
  return map[code];
}
