import './style.css';
import {
  allSubmitted, answerQuiz, backToLobby, createRoom, decide, GameError, joinTeam, leaveTeam, nextRound,
  removeTeam, resolveRound, revealDurationMs, rollDice, setPaused, startGame, updateSettings,
} from './game/rules';
import { DEFAULT_ROUND_SECONDS, DEFAULT_ROUNDS, type QuizMode, type Room, type Settings, type TeamDoc } from './game/types';
import { isMuted, play, setMuted } from './lib/sound';
import { FirebaseStore } from './net/firebaseStore';
import { LocalStore } from './net/localStore';
import { readFirebaseConfig, type RoomStore } from './net/store';
import { sceneSvg } from './ui/html';
import {
  animElapsed, animTimeline, clock, renderGame, renderHelp, renderHome, renderLobby, renderMissing,
  type HomeForm, type Role, type ViewCtx,
} from './ui/views';

// ───────────── 저장소 유틸 (실패해도 동작) ─────────────
const safe = {
  get(kind: 'local' | 'session', k: string): string | null {
    try {
      return (kind === 'local' ? localStorage : sessionStorage).getItem(k);
    } catch {
      return null;
    }
  },
  set(kind: 'local' | 'session', k: string, v: string) {
    try {
      (kind === 'local' ? localStorage : sessionStorage).setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

function newId(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// ───────────── 앱 상태 ─────────────
const params = new URLSearchParams(location.search);
const initialCode = (params.get('room') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

let meId = safe.get('session', 'cant-stop8:pid') ?? newId();
safe.set('session', 'cant-stop8:pid', meId);

const state = {
  store: null as RoomStore | null,
  mode: 'loading' as ViewCtx['mode'],
  storeError: null as string | null,
  screen: 'home' as 'home' | 'room',
  role: 'team' as Role,
  code: null as string | null,
  room: null as Room | null,
  teamDoc: null as TeamDoc | null,
  teamDocs: [] as TeamDoc[],
  missing: false,
  busy: false,
  showHelp: false,
  showProb: safe.get('local', 'cant-stop8:prob') === '1',
  toast: null as { text: string; kind: 'info' | 'error' } | null,
  home: {
    tab: 'join',
    code: initialCode,
    name: safe.get('local', 'cant-stop8:team') ?? '',
    quizMode: 'sumWays',
    rounds: DEFAULT_ROUNDS,
    roundSeconds: DEFAULT_ROUND_SECONDS,
  } as HomeForm,
};

const unsubs: (() => void)[] = [];
let toastTimer = 0;
const app = document.getElementById('app')!;

function ctx(): ViewCtx {
  return {
    mode: state.mode,
    storeError: state.storeError,
    role: state.role,
    meId,
    busy: state.busy,
    showProb: state.showProb,
    now: Date.now(),
    teamDoc: state.teamDoc,
    teamDocs: state.teamDocs,
  };
}

// ───────────── 렌더링 ─────────────
let lastDiceKey = '';
const detailsState = new Map<string, boolean>();
app.addEventListener('toggle', (e) => {
  const d = e.target as HTMLDetailsElement;
  if (d.dataset?.key) detailsState.set(d.dataset.key, d.open);
}, true);

/** 화면 구조가 바뀌는 시점을 감지하는 키 — 같으면 시계만 갱신 */
let renderKey = '';
function structuralKey(): string {
  const r = state.room;
  if (!r || state.screen !== 'room') return '';
  const now = Date.now();
  return [r.status, r.phase, r.round, r.paused, now >= r.deadline, animElapsed(r, now) === null].join('|');
}

function render() {
  const c = ctx();
  const focusId = (document.activeElement as HTMLElement | null)?.id;
  let html: string;
  if (state.screen === 'home') html = renderHome(state.home, c);
  else if (state.missing) html = renderMissing();
  else if (!state.room) html = `<main class="home"><div class="banner">방에 연결하는 중…</div></main>`;
  else if (state.room.status === 'lobby') html = renderLobby(state.room, c);
  else html = renderGame(state.room, c);
  if (state.showHelp) html += renderHelp();
  if (state.toast) html += `<div class="toast ${state.toast.kind}" role="${state.toast.kind === 'error' ? 'alert' : 'status'}">${escapeText(state.toast.text)}</div>`;
  app.innerHTML = html;
  renderKey = structuralKey();
  app.querySelectorAll<HTMLDetailsElement>('details[data-key]').forEach((d) => {
    const v = detailsState.get(d.dataset.key ?? '');
    if (v !== undefined) d.open = v;
  });
  const tray = app.querySelector<HTMLElement>('.dice-tray[data-anim]');
  if (tray && tray.dataset.anim !== lastDiceKey) {
    tray.classList.add('animate');
    lastDiceKey = tray.dataset.anim ?? '';
  }
  if (focusId) document.getElementById(focusId)?.focus();
}

function escapeText(s: string) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function toast(text: string, kind: 'info' | 'error' = 'info') {
  state.toast = { text, kind };
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
}

function errMsg(e: unknown): string {
  if (e instanceof GameError) return e.message;
  if (e instanceof Error) {
    if (/permission/i.test(e.message)) return '권한이 없어요 (Firestore 규칙/익명 로그인을 확인하세요).';
    return e.message;
  }
  return String(e);
}

// ───────────── 구독 + 효과음 ─────────────
function onRoom(next: Room | null) {
  const prev = state.room;
  if (!next) {
    state.missing = true;
    state.room = null;
    render();
    return;
  }
  state.missing = false;
  // 선생님이 내보낸 경우: 직전까지 명단에 있다가 빠졌을 때만 처리.
  // (Firestore는 입장 직후 '입장 전' 캐시 스냅샷을 먼저 보낼 수 있어서, 처음부터 없는 경우는 무시)
  const inPrev = !!prev?.teams.some((t) => t.id === meId);
  const inNext = next.teams.some((t) => t.id === meId);
  if (state.role === 'team' && next.status === 'lobby' && inPrev && !inNext) {
    goHome();
    toast('방에서 나왔어요.');
    return;
  }
  state.room = next;
  if (prev) roomSounds(prev, next);
  render();
}

function roomSounds(a: Room, b: Room) {
  if (b.status === 'playing' && b.phase === 'play' && (a.round !== b.round || a.status !== 'playing') && state.role === 'team') {
    play('turn');
  }
  if (b.phase === 'reveal' && b.reveal && a.reveal?.round !== b.reveal.round) {
    const rv = b.reveal;
    play('move');
    const tl = animTimeline(b);
    const mine = state.role === 'team';
    const claim = mine ? rv.claims.some((c) => c.teams.includes(meId)) : rv.claims.length > 0;
    const reset = mine && rv.resets.some((r) => r.teamId === meId);
    if (claim) setTimeout(() => play('claim'), tl.claimAt * 1000);
    else if (reset) setTimeout(() => play('bust'), tl.claimAt * 1000);
    if (b.status === 'finished') setTimeout(() => play('win'), tl.total * 1000);
  }
}

function clearSubs() {
  while (unsubs.length) unsubs.pop()!();
}

function enterRoom(code: string, role: Role) {
  clearSubs();
  state.code = code;
  state.role = role;
  state.screen = 'room';
  state.room = null;
  state.teamDoc = null;
  state.teamDocs = [];
  state.missing = false;
  const u = new URL(location.href);
  u.searchParams.set('room', code);
  if (role === 'watch') u.searchParams.set('watch', '1');
  else u.searchParams.delete('watch');
  history.replaceState(null, '', u);
  const store = state.store!;
  const onErr = (e: unknown) => toast(`연결 오류: ${errMsg(e)}`, 'error');
  unsubs.push(store.subscribeRoom(code, onRoom, onErr));
  if (role === 'team') {
    unsubs.push(store.subscribeTeam(code, meId, (d) => {
      state.teamDoc = d;
      render();
    }, onErr));
  } else {
    unsubs.push(store.subscribeTeams(code, (docs) => {
      state.teamDocs = docs;
      render();
      void drive();
    }, onErr));
  }
  render();
}

function goHome() {
  clearSubs();
  state.screen = 'home';
  state.room = null;
  state.code = null;
  state.teamDoc = null;
  state.teamDocs = [];
  state.missing = false;
  const u = new URL(location.href);
  u.searchParams.delete('room');
  u.searchParams.delete('watch');
  history.replaceState(null, '', u);
  render();
}

// ───────────── 행동 ─────────────
async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (state.busy) return undefined;
  state.busy = true;
  render();
  try {
    return await fn();
  } catch (e) {
    toast(errMsg(e), 'error');
    return undefined;
  } finally {
    state.busy = false;
    render();
  }
}

function roomAct(fn: (r: Room) => Room | null) {
  if (!state.store || !state.code) return;
  const code = state.code;
  void withBusy(async () => onRoom(await state.store!.updateRoom(code, fn)));
}

function teamAct(fn: (doc: TeamDoc | null, room: Room) => TeamDoc, after?: (d: TeamDoc) => void) {
  if (!state.store || !state.code) return;
  const code = state.code;
  void withBusy(async () => {
    const d = await state.store!.updateTeam(code, meId, fn);
    state.teamDoc = d;
    after?.(d);
  });
}

function hostSettings(patch: Partial<Settings>) {
  roomAct((r) => updateSettings(r, meId, patch));
}

// ───────────── 라운드 진행 (선생님 화면이 주도, 다른 화면은 예비) ─────────────
let inflight = false;
let lastDriveTry = 0;

async function drive(force = false) {
  const r = state.room;
  const store = state.store;
  const code = state.code;
  if (!r || !store || !code || r.status !== 'playing' || inflight) return;
  const now = Date.now();
  if (!force && now - lastDriveTry < 1200) return;
  const isHost = state.role === 'host';
  const grace = isHost ? 0 : 8000;
  if (r.phase === 'play') {
    const docs = Object.fromEntries(state.teamDocs.map((d) => [d.id, d]));
    const ready = force || (isHost && allSubmitted(r, docs)) || now >= r.deadline + grace;
    if (!ready) return;
    inflight = true;
    lastDriveTry = now;
    const round = r.round;
    try {
      const out = await store.updateRoomWithTeams(code, (cur, all) =>
        cur.status === 'playing' && cur.phase === 'play' && cur.round === round &&
        (force || allSubmitted(cur, all) || Date.now() >= cur.deadline - 1500)
          ? resolveRound(cur, all)
          : null);
      if (out) onRoom(out);
    } catch (e) {
      if (isHost) toast(errMsg(e), 'error');
    } finally {
      inflight = false;
    }
  } else if (r.phase === 'reveal' && r.reveal && !r.paused) {
    if (now < r.reveal.at + revealDurationMs(r) + (isHost ? 0 : 10000) && !force) return;
    inflight = true;
    lastDriveTry = now;
    const round = r.round;
    try {
      const out = await store.updateRoom(code, (cur) =>
        cur.status === 'playing' && cur.phase === 'reveal' && cur.round === round && !cur.paused ? nextRound(cur) : null);
      onRoom(out);
    } catch (e) {
      if (isHost) toast(errMsg(e), 'error');
    } finally {
      inflight = false;
    }
  }
}

setInterval(() => {
  if (state.screen !== 'room' || !state.room) return;
  void drive();
  if (state.room.status === 'lobby') return;
  if (structuralKey() !== renderKey) {
    render();
  } else {
    const el = app.querySelector('.clock');
    if (el) el.outerHTML = clock(state.room, ctx());
  }
}, 250);

// ───────────── 홈 화면 ─────────────
function validName(): string | null {
  const name = state.home.name.trim();
  if (!name) {
    toast('모둠 이름을 입력해 주세요.', 'error');
    document.getElementById('f-name')?.focus();
    return null;
  }
  safe.set('local', 'cant-stop8:team', name);
  return name;
}

function validCode(): string | null {
  const code = state.home.code.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    toast('방 코드는 영어 4글자예요.', 'error');
    document.getElementById('f-code')?.focus();
    return null;
  }
  return code;
}

async function doCreate() {
  const store = state.store;
  if (!store) return;
  const code = await withBusy(async () => {
    for (let i = 0; i < 6; i++) {
      const c = newCode();
      const room = createRoom(c, meId, { quizMode: state.home.quizMode, rounds: state.home.rounds, roundSeconds: state.home.roundSeconds });
      if (await store.createRoom(room)) return c;
    }
    throw new Error('방 코드를 만들지 못했어요. 다시 시도해 주세요.');
  });
  if (code) enterRoom(code, 'host');
}

async function doJoin() {
  const code = validCode();
  if (!code) return;
  const name = validName();
  if (!name || !state.store) return;
  const store = state.store;
  const teamId = await withBusy(async () => {
    let assigned = meId;
    await store.updateRoom(code, (r) => {
      const res = joinTeam(r, meId, name);
      assigned = res.teamId;
      return res.room;
    });
    return assigned;
  });
  if (!teamId) return;
  if (teamId !== meId) {
    meId = teamId; // 같은 모둠 이름으로 재접속
    safe.set('session', 'cant-stop8:pid', meId);
    toast(`${name}(으)로 다시 접속했어요.`);
  }
  enterRoom(code, 'team');
}

async function doWatch() {
  const code = validCode();
  if (!code || !state.store) return;
  const store = state.store;
  const ok = await withBusy(async () => {
    if (!(await store.roomExists(code))) throw new Error('방을 찾을 수 없어요.');
    return true;
  });
  if (ok) enterRoom(code, 'watch');
}

// ───────────── 이벤트 위임 ─────────────
app.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const key = t.dataset.input;
  if (key === 'name') state.home.name = t.value;
  else if (key === 'code') {
    const v = t.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (v !== t.value) t.value = v;
    state.home.code = v;
  } else if (key === 'rounds' || key === 'roundSeconds') {
    const n = Number(t.value);
    if (Number.isFinite(n) && n > 0) state.home[key] = n;
  }
});

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  const key = t.dataset.input;
  if (key === 'quizMode') {
    state.home.quizMode = t.value as QuizMode;
    render();
  } else if (key === 's-quizMode') hostSettings({ quizMode: t.value as QuizMode });
  else if (key === 's-rounds') hostSettings({ rounds: Number(t.value) });
  else if (key === 's-roundSeconds') hostSettings({ roundSeconds: Number(t.value) });
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = (e.target as HTMLElement).dataset.form;
  if (f === 'create') void doCreate();
  else if (f === 'join') void doJoin();
  else if (f === 'watch') void doWatch();
});

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>('[data-act]');
  if (!el) return;
  if (el.classList.contains('overlay') && target.closest('[data-stop]')) return;
  const v = el.dataset.v ?? '';
  switch (el.dataset.act) {
    case 'tab':
      state.home.tab = v as HomeForm['tab'];
      render();
      document.getElementById(state.home.tab === 'create' ? 'f-name' : 'f-code')?.focus();
      break;
    case 'help':
      state.showHelp = true;
      render();
      break;
    case 'closeHelp':
      state.showHelp = false;
      render();
      break;
    case 'mute':
      setMuted(!isMuted());
      render();
      break;
    case 'prob':
      state.showProb = !state.showProb;
      safe.set('local', 'cant-stop8:prob', state.showProb ? '1' : '0');
      render();
      break;
    case 'leave':
      if (state.room && state.role === 'team' && state.room.status === 'lobby') {
        void state.store?.updateRoom(state.room.code, (r) => leaveTeam(r, meId)).catch(() => {});
      }
      goHome();
      break;
    // 선생님
    case 'kick':
      roomAct((r) => removeTeam(r, meId, v));
      break;
    case 'start':
      roomAct((r) => startGame(r, meId));
      break;
    case 'again':
      roomAct((r) => startGame(backToLobby(r, meId), meId));
      break;
    case 'pause':
      roomAct((r) => setPaused(r, meId, true));
      break;
    case 'next':
      roomAct((r) => (r.phase === 'reveal' && r.status === 'playing' ? nextRound(setPaused(r, meId, false)) : setPaused(r, meId, false)));
      break;
    case 'forceReveal':
      void drive(true);
      break;
    // 모둠
    case 'roll':
      teamAct((d, r) => rollDice(r, meId, d), () => play('roll'));
      break;
    case 'answer':
      teamAct((d, r) => answerQuiz(r, meId, d, Number(v)), (d) => play(d.quiz?.picked === d.quiz?.answer ? 'correct' : 'wrong'));
      break;
    case 'choose':
      teamAct((d, r) => decide(r, meId, d, { kind: 'move', cols: v.split(',').map(Number) }), () => play('move'));
      break;
    case 'withdraw':
      teamAct((d, r) => decide(r, meId, d, { kind: 'withdraw', cols: [Number(v)] }));
      break;
    case 'pass':
      teamAct((d, r) => decide(r, meId, d, { kind: 'pass', cols: [] }));
      break;
  }
});

// 이동 선택지에 손가락/마우스를 올리면 해당 등산로 강조
app.addEventListener('pointerover', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-preview]');
  app.querySelectorAll('.col.preview').forEach((c) => c.classList.remove('preview'));
  if (!el) return;
  for (const c of (el.dataset.preview ?? '').split(',')) app.querySelector(`.col[data-col="${c}"]`)?.classList.add('preview');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.showHelp) {
    state.showHelp = false;
    render();
  }
});

// ───────────── 시작 ─────────────
async function boot() {
  // 산 풍경 배경 (한 번만)
  const scene = document.createElement('div');
  scene.className = 'scene';
  scene.innerHTML = sceneSvg();
  document.body.prepend(scene);
  render();
  const cfg = readFirebaseConfig();
  const store: RoomStore = cfg ? new FirebaseStore(cfg) : new LocalStore();
  try {
    await store.init();
    state.store = store;
    state.mode = store.kind;
  } catch (e) {
    state.mode = 'error';
    state.storeError = errMsg(e);
    render();
    return;
  }
  if (initialCode && params.get('watch') === '1') {
    enterRoom(initialCode, 'watch');
    return;
  }
  // 새로고침: 이미 들어와 있던 방이면 바로 복귀
  if (initialCode) {
    try {
      const room = await new Promise<Room | null>((resolve) => {
        let done = false;
        const u = store.subscribeRoom(initialCode, (r) => {
          if (done) return;
          done = true;
          setTimeout(() => u(), 0);
          resolve(r);
        }, () => resolve(null));
      });
      if (room?.hostId === meId) return enterRoom(initialCode, 'host');
      if (room?.teams.some((t) => t.id === meId)) return enterRoom(initialCode, 'team');
    } catch {
      /* 홈으로 */
    }
  }
  render();
  document.getElementById(initialCode ? 'f-name' : 'f-code')?.focus();
}

void boot();
