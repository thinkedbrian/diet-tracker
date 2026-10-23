/* ============================================================
 *  firebase-config.js  —  구글 로그인 / 클라우드 저장 설정
 *
 *  ⚠️ 아직 설정 전이면 아래 값을 그대로 두세요.
 *     그 상태에서는 로그인 버튼이 "로컬 모드"로 표시되고,
 *     앱은 지금까지처럼 이 브라우저에만 기록을 저장합니다.
 *
 *  설정하는 법은 FIREBASE.md 문서를 그대로 따라 하면 됩니다.
 *  Firebase 콘솔에서 복사한 값을 아래에 붙여넣기만 하면 끝입니다.
 *
 *  ※ 이 값들은 공개돼도 괜찮습니다. 비밀번호가 아니라 "주소"에 가깝고,
 *     실제 보호는 Firestore 보안 규칙(firestore.rules)이 담당합니다.
 * ============================================================ */

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDlfgClL5xtxITrQnQw7xFtf2WUkxyyPbo",
  authDomain:        "diet-tracker-27324.firebaseapp.com",
  projectId:         "diet-tracker-27324",
  storageBucket:     "diet-tracker-27324.firebasestorage.app",
  messagingSenderId: "1062270107663",
  appId:             "1:1062270107663:web:8954b400977d4c8bd7a37a"
};
