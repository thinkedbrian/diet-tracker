# 🐙 GitHub에 올리고 웹사이트로 만들기 (처음부터 끝까지)

이 문서만 따라 하면 `diet-tracker` 폴더가 GitHub에 올라가고,
`https://내아이디.github.io/diet-tracker/` 주소로 **휴대폰에서도 접속되는 웹앱**이 됩니다.

---

## 0단계 — 준비물 확인

터미널(PowerShell)에서:

```bash
git --version
```

버전이 나오면 OK. `git을 찾을 수 없습니다`가 나오면 <https://git-scm.com/download/win> 에서 설치하세요
(설치 중 선택지는 전부 기본값 그대로 두면 됩니다).

처음 쓰는 거라면 이름과 이메일을 한 번만 등록합니다. (커밋 기록에 남는 정보)

```bash
git config --global user.name "내이름"
```
```bash
git config --global user.email "eagles1119@naver.com"
```

---

## 1단계 — GitHub에서 빈 저장소 만들기

1. <https://github.com> 로그인 → 오른쪽 위 **+** → **New repository**
2. **Repository name**: `diet-tracker`
3. **Public** 선택 (GitHub Pages 무료 배포를 쓰려면 Public이 편합니다)
4. ⚠️ **"Add a README file" 체크는 해제** — 이미 README가 있으니 비어 있어야 충돌이 안 납니다.
5. **Create repository** 클릭

만들어진 주소를 복사해 둡니다: `https://github.com/내아이디/diet-tracker.git`

---

## 2단계 — 내 컴퓨터 폴더를 git 저장소로 만들기

```bash
cd C:\Users\think\OneDrive\Documents\pjs\diet-tracker
```

```bash
git init
```
> 이 폴더를 git이 관리하기 시작합니다. 숨김 폴더 `.git`이 생깁니다.

```bash
git add .
```
> 현재 폴더의 모든 파일을 "올릴 목록"에 담습니다. (`.gitignore`에 적힌 건 제외)

```bash
git status
```
> 뭐가 올라갈지 확인. 초록색으로 파일들이 보이면 정상입니다.

```bash
git commit -m "AI 다이어트 기록장 첫 커밋"
```
> 현재 상태를 하나의 "저장 지점"으로 기록합니다. `-m` 뒤가 그 설명입니다.

---

## 3단계 — GitHub와 연결하고 올리기

```bash
git branch -M main
```
> 기본 브랜치 이름을 `main`으로 맞춥니다. (GitHub 기본값)

```bash
git remote add origin https://github.com/내아이디/diet-tracker.git
```
> `내아이디` 부분을 실제 GitHub 아이디로 바꾸세요.
> 이미 등록했다는 오류가 나면 `git remote set-url origin <주소>` 로 바꾸면 됩니다.

```bash
git push -u origin main
```
> 실제로 업로드합니다. 처음에는 로그인 창이 뜹니다 → **Sign in with your browser** 로 진행하면 가장 쉽습니다.

올라갔는지 확인: 브라우저에서 `https://github.com/내아이디/diet-tracker` 를 열어 파일이 보이면 성공입니다.

---

## 4단계 — GitHub Pages로 웹사이트 만들기

1. 저장소 페이지 상단의 **Settings** 클릭
2. 왼쪽 메뉴에서 **Pages** 클릭
3. **Source**: `Deploy from a branch`
4. **Branch**: `main` / 폴더는 `/ (root)` 선택 → **Save**
5. 1~2분 기다린 뒤 새로고침하면 주소가 나타납니다

```
https://내아이디.github.io/diet-tracker/
```

이 주소를 휴대폰 브라우저에서 열고 **홈 화면에 추가**하면 앱처럼 쓸 수 있습니다.

> 💡 휴대폰과 PC의 기록은 **공유되지 않습니다.** 각 기기의 브라우저에 따로 저장돼요.
> 옮기고 싶으면 PC에서 `JSON 내보내기` → 휴대폰에서 `JSON 가져오기`를 쓰세요.

---

## 5단계 — 수정한 내용을 다시 올리기 (앞으로 매번 쓰는 3줄)

음식을 추가하거나 코드를 고쳤다면:

```bash
git add .
```
```bash
git commit -m "마라탕, 샤브샤브 추가"
```
```bash
git push
```

push하고 1분쯤 지나면 GitHub Pages 사이트에도 자동 반영됩니다.
(바뀐 게 안 보이면 `Ctrl + Shift + R` 로 강력 새로고침)

---

## 🔧 자주 만나는 문제

| 증상 | 원인과 해결 |
|---|---|
| `fatal: not a git repository` | 폴더를 잘못 찾아간 것. `cd`로 `diet-tracker` 폴더로 이동 후 다시 실행 |
| `remote origin already exists` | 이미 연결됨. `git remote set-url origin <새주소>` 로 덮어쓰기 |
| `Updates were rejected` | GitHub 쪽에 내 컴퓨터엔 없는 커밋이 있음. `git pull --rebase origin main` 후 다시 `git push` |
| push할 때 비밀번호가 안 먹힘 | GitHub는 2021년부터 비밀번호 대신 **토큰**을 씁니다. 로그인 창에서 "Sign in with your browser" 선택이 제일 편함 |
| Pages 주소가 404 | ① 1~2분 더 기다리기 ② 저장소가 **Public**인지 확인 ③ Branch가 `main` / `(root)`인지 확인 ④ 파일 이름이 정확히 `index.html`인지 확인 |
| Pages에 옛날 화면이 보임 | 브라우저 캐시. `Ctrl + Shift + R` |
| 한글이 깨져 보임 | `index.html` 첫 부분의 `<meta charset="UTF-8">`가 지워지지 않았는지 확인 |

---

## 📚 git 명령어 요약

| 명령어 | 뜻 |
|---|---|
| `git init` | 이 폴더를 git 저장소로 시작 |
| `git status` | 지금 뭐가 바뀌었는지 보기 |
| `git add .` | 바뀐 파일 전부를 커밋 목록에 올리기 |
| `git commit -m "설명"` | 저장 지점 만들기 |
| `git log --oneline` | 지금까지의 저장 지점 목록 |
| `git push` | GitHub로 올리기 |
| `git pull` | GitHub에서 내려받기 |
| `git diff` | 마지막 커밋 이후 바뀐 내용 보기 |
| `git restore 파일명` | 그 파일의 수정을 되돌리기 |

---

## 🎁 (선택) 저장소를 더 그럴듯하게

- **About** 란에 한 줄 설명과 Pages 주소를 넣으면 보기 좋습니다.
- **Topics**에 `javascript`, `health`, `diet`, `no-dependencies` 같은 태그를 달아 두세요.
- 나중에 기능을 추가할 때는 `git switch -c feature/새기능` 으로 브랜치를 따서 작업하면,
  망가뜨릴 걱정 없이 실험할 수 있습니다.
