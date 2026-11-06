import { ANSWER_CHOICES, distinctPairSums, josa, PAIR_INDEXES, sumPairs, sumWays } from '../game/quiz';
import { current, getOptions, rankTeams, revealDurationMs, scoreOf } from '../game/rules';
import {
  COLS, FACES, FLAG_POINTS, HEIGHT, MAX_TEAMS, PIECES,
  type Quiz, type QuizMode, type QuizRecord, type Room, type Team, type TeamDoc, type TeamEvent,
} from '../game/types';
import { qrSvg } from '../lib/qr';
import { isMuted } from '../lib/sound';
import { colorOf, die8, esc, icon, peakLogo } from './html';

export type Role = 'host' | 'watch' | 'team';

export interface HomeForm {
  tab: 'join' | 'create' | 'watch';
  code: string;
  name: string;
  quizMode: QuizMode;
  rounds: number;
  roundSeconds: number;
}

export interface ViewCtx {
  mode: 'firebase' | 'local' | 'loading' | 'error';
  storeError: string | null;
  role: Role;
  meId: string;
  busy: boolean;
  showProb: boolean;
  now: number;
  /** 모둠 태블릿: 내 라운드 문서 */
  teamDoc: TeamDoc | null;
  /** 선생님·관전: 모든 모둠 문서 */
  teamDocs: TeamDoc[];
}

export const QUIZ_MODE_LABEL: Record<QuizMode, string> = {
  sumWays: '합의 경우의 수',
  pairSums: '만들 수 있는 합의 가짓수',
  mixed: '두 유형 섞기',
  off: '퀴즈 없이',
};

// ───────────── 애니메이션 타임라인 (초) ─────────────
const STEP = 0.45; // 모둠 간 간격
const MOVE = 0.7; // 말 이동 시간
const AFTER = 1.0; // 점령·출발점 연출 시간

export function animTimeline(room: Room) {
  const n = room.teams.length;
  const claimAt = n * STEP + MOVE + 0.25;
  return { claimAt, total: claimAt + AFTER };
}

/** 공개 연출 중이면 경과 시간(초), 아니면 null */
export function animElapsed(room: Room, now: number): number | null {
  if (room.phase !== 'reveal' || !room.reveal) return null;
  const el = (now - room.reveal.at) / 1000;
  return el < animTimeline(room).total ? Math.max(0, el) : null;
}

// ───────────── 공통 조각 ─────────────

function teamOf(room: Room, id: string): Team | undefined {
  return room.teams.find((t) => t.id === id);
}
function teamNo(room: Room, id: string): number {
  return room.teams.findIndex((t) => t.id === id) + 1;
}

export function teamChip(room: Room, id: string, extra = ''): string {
  const t = teamOf(room, id);
  if (!t) return '';
  return `<span class="chip" style="--pc:${colorOf(t.color)}"><span class="tok sm">${teamNo(room, id)}</span>${esc(t.name)}${extra}</span>`;
}

function modeBanner(ctx: ViewCtx): string {
  if (ctx.mode === 'local') {
    return `<div class="banner warn" role="status"><strong>로컬 체험 모드</strong> — Firebase 설정 전이라 <b>이 브라우저의 탭끼리만</b> 연결돼요. (설정 방법은 README 참고)</div>`;
  }
  if (ctx.mode === 'error') {
    return `<div class="banner err" role="alert"><strong>서버 연결 실패</strong> — ${esc(ctx.storeError)}<br/>Firebase 설정(익명 로그인, Firestore 규칙)을 확인해 주세요.</div>`;
  }
  if (ctx.mode === 'loading') return `<div class="banner" role="status">서버에 연결하는 중…</div>`;
  return '';
}

function radio(name: string, value: string, checked: boolean, title: string, desc: string): string {
  return `<label class="choice ${checked ? 'on' : ''}">
    <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} data-input="${name}"/>
    <span class="choice-title">${title}</span><span class="choice-desc">${desc}</span>
  </label>`;
}

export function settingsFields(s: { quizMode: QuizMode; rounds: number; roundSeconds: number }, prefix = ''): string {
  return `
  <fieldset class="field"><legend>퀴즈 유형</legend>
    <div class="choices">
      ${radio(prefix + 'quizMode', 'sumWays', s.quizMode === 'sumWays', '합의 경우의 수', '두 주사위 합이 9가 되는 경우는 몇 가지?')}
      ${radio(prefix + 'quizMode', 'pairSums', s.quizMode === 'pairSums', '만들 수 있는 합', '나온 4개 중 2개로 만들 수 있는 서로 다른 합은?')}
      ${radio(prefix + 'quizMode', 'mixed', s.quizMode === 'mixed', '섞어서', '두 유형이 무작위로 나와요')}
      ${radio(prefix + 'quizMode', 'off', s.quizMode === 'off', '퀴즈 없이', '게임만 해요')}
    </div>
  </fieldset>
  <div class="field-row">
    <label class="field"><span class="label">라운드 수</span>
      <input type="number" inputmode="numeric" min="1" max="30" value="${s.rounds}" data-input="${prefix}rounds"/></label>
    <label class="field"><span class="label">라운드 제한 시간(초)</span>
      <input type="number" inputmode="numeric" min="20" max="180" step="10" value="${s.roundSeconds}" data-input="${prefix}roundSeconds"/></label>
  </div>`;
}

// ───────────── 홈 ─────────────

export function renderHome(form: HomeForm, ctx: ViewCtx): string {
  const tab = (id: HomeForm['tab'], label: string, ic: string) =>
    `<button class="tab ${form.tab === id ? 'on' : ''}" role="tab" aria-selected="${form.tab === id}" data-act="tab" data-v="${id}">${ic}${label}</button>`;
  const nameField = `<label class="field"><span class="label">모둠 이름</span>
      <input id="f-name" data-input="name" maxlength="12" autocomplete="off" placeholder="예: 3모둠, 번개팀" value="${esc(form.name)}"/></label>`;
  const codeField = `<label class="field"><span class="label">방 코드 (영어 4글자)</span>
      <input id="f-code" class="code-input" data-input="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD" value="${esc(form.code)}"/></label>`;
  const disabled = ctx.mode === 'loading' || ctx.mode === 'error' || ctx.busy ? 'disabled' : '';
  let body: string;
  if (form.tab === 'join') {
    body = `<form data-form="join">${codeField}${nameField}
      <p class="hint">태블릿 한 대를 모둠원 2~3명이 함께 써요.</p>
      <button class="btn primary big" ${disabled}>모둠으로 입장하기</button></form>`;
  } else if (form.tab === 'create') {
    body = `<form data-form="create">
      <p class="hint top">이 화면(전자칠판)이 <b>선생님 진행 화면</b>이 돼요. QR을 띄우면 모둠 태블릿이 들어와요.</p>
      ${settingsFields(form)}
      <button class="btn primary big" ${disabled}>방 만들기</button></form>`;
  } else {
    body = `<form data-form="watch">${codeField}
      <p class="hint">조작 없이 게임판·순위·퀴즈 결과만 크게 보여주는 화면이에요.</p>
      <button class="btn primary big" ${disabled}>관전 화면 열기</button></form>`;
  }
  return `<main class="home">
    <header class="brand">
      <div class="logo">${die8(9)}${peakLogo()}${die8(5)}</div>
      <h1>캔트 스탑 <span class="ver">모둠 대전</span></h1>
      <p class="tagline">정팔면체 주사위 · 15개의 등산로 · <b>경우의 수</b> 퀴즈</p>
    </header>
    ${modeBanner(ctx)}
    <section class="card home-card">
      <div class="tabs" role="tablist">
        ${tab('join', '모둠 참가', icon('users'))}
        ${tab('create', '방 만들기', icon('plus'))}
        ${tab('watch', '관전', icon('tv'))}
      </div>
      ${body}
    </section>
    <button class="link-btn" data-act="help">${icon('help')} 게임 규칙 보기</button>
  </main>`;
}

// ───────────── 대기실 ─────────────

function joinUrl(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  if (new URLSearchParams(location.search).get('local') === '1') u.searchParams.set('local', '1');
  return u.toString();
}

function teamSlots(room: Room, ctx: ViewCtx): string {
  const kick = (t: Team) =>
    ctx.role === 'host' ? `<button class="icon-btn sm" data-act="kick" data-v="${esc(t.id)}" aria-label="${esc(t.name)} 내보내기">${icon('x')}</button>` : '';
  const rows = room.teams.map((t, i) =>
    `<li class="slot" style="--pc:${colorOf(t.color)}"><span class="tok">${i + 1}</span><span class="tname">${esc(t.name)}</span>${t.id === ctx.meId ? '<span class="tag me">우리</span>' : ''}${kick(t)}</li>`);
  for (let i = room.teams.length; i < MAX_TEAMS; i++) rows.push(`<li class="slot empty"><span class="tok">${i + 1}</span><span class="tname">빈 자리</span></li>`);
  return `<ul class="slots">${rows.join('')}</ul>`;
}

export function renderLobby(room: Room, ctx: ViewCtx): string {
  if (ctx.role === 'team') {
    const me = teamOf(room, ctx.meId);
    return `<main class="lobby team-lobby">
      ${modeBanner(ctx)}
      <section class="card center">
        <p class="eyebrow">방 ${room.code}</p>
        ${me ? `<div class="big-chip" style="--pc:${colorOf(me.color)}"><span class="tok lg">${teamNo(room, me.id)}</span>${esc(me.name)}</div>` : ''}
        <p class="wait"><span class="spinner"></span>선생님이 시작하기를 기다리는 중…</p>
        <div class="roles">
          <p><b>모둠원 역할을 정해 보세요</b> (라운드마다 돌아가며)</p>
          <ul><li>🎲 주사위 굴리기</li><li>✏️ 퀴즈 답 고르기</li><li>🧗 말 이동 고르기</li></ul>
        </div>
        <p class="settings-summary">퀴즈: <b>${QUIZ_MODE_LABEL[room.settings.quizMode]}</b> · ${room.settings.rounds}라운드 · 라운드당 ${room.settings.roundSeconds}초</p>
        <button class="btn ghost" data-act="leave">${icon('exit')} 나가기</button>
      </section>
      <section class="card"><h2>참가 모둠 <span class="count">${room.teams.length}/${MAX_TEAMS}</span></h2>${teamSlots(room, ctx)}</section>
    </main>`;
  }
  const url = joinUrl(room.code);
  let qr = '';
  try {
    qr = qrSvg(url, `방 ${room.code} 참가 QR 코드`);
  } catch {
    qr = '';
  }
  const isHost = ctx.role === 'host';
  return `<main class="lobby console">
    ${modeBanner(ctx)}
    <section class="card invite">
      <p class="eyebrow">태블릿 카메라로 QR을 찍거나 방 코드를 입력하세요</p>
      <div class="invite-row">
        <div class="qr">${qr}</div>
        <div>
          <p class="room-code" aria-label="방 코드 ${room.code.split('').join(' ')}">${room.code.split('').map((c) => `<span>${c}</span>`).join('')}</p>
          <p class="url">${esc(url)}</p>
        </div>
      </div>
    </section>
    <section class="card members">
      <h2>참가 모둠 <span class="count">${room.teams.length}/${MAX_TEAMS}</span></h2>
      ${teamSlots(room, ctx)}
      ${isHost ? `<form data-form="settings" class="settings">${settingsFields(room.settings, 's-')}</form>` : `<p class="settings-summary">퀴즈: <b>${QUIZ_MODE_LABEL[room.settings.quizMode]}</b> · ${room.settings.rounds}라운드 · ${room.settings.roundSeconds}초</p>`}
      ${isHost
        ? `<button class="btn primary big" data-act="start" ${ctx.busy || !room.teams.length ? 'disabled' : ''}>게임 시작 (${room.teams.length}모둠)</button>`
        : '<p class="wait">선생님이 시작하면 게임판이 나타나요.</p>'}
      <button class="btn ghost" data-act="leave">${icon('exit')} ${isHost ? '방 닫고 처음으로' : '관전 끝내기'}</button>
    </section>
  </main>`;
}

// ───────────── 게임판 ─────────────

interface TokenAnim {
  rise?: { from: number; delay: number };
  out?: 'claim' | 'reset';
  outDelay?: number;
}

function token(room: Room, teamId: string, mine: boolean, anim: TokenAnim | null, elapsed: number): string {
  const t = teamOf(room, teamId)!;
  const names: string[] = [];
  const delays: string[] = [];
  const vars: string[] = [`--pc:${colorOf(t.color)}`];
  if (anim?.rise) {
    names.push('rise');
    delays.push(`${(anim.rise.delay - elapsed).toFixed(2)}s`);
    vars.push(`--dy:${anim.rise.from}`);
  }
  if (anim?.out) {
    names.push(anim.out === 'claim' ? 'toFlag' : 'toStart');
    delays.push(`${((anim.outDelay ?? 0) - elapsed).toFixed(2)}s`);
  }
  const style = names.length
    ? `${vars.join(';')};animation-name:${names.join(',')};animation-delay:${delays.join(',')}`
    : vars.join(';');
  return `<span class="tok ${mine ? 'mine' : ''} ${names.length ? 'anim' : ''}" style="${style}" title="${esc(t.name)}">${teamNo(room, teamId)}</span>`;
}

export function renderBoard(room: Room, ctx: ViewCtx, elapsed: number | null): string {
  const animating = elapsed !== null && room.reveal;
  const tl = animTimeline(room);
  // 표시할 말 위치와 깃발
  const show: Record<string, Record<string, number>> = {};
  const anims: Record<string, Record<string, TokenAnim>> = {};
  let flagsShown: Record<string, string[]> = { ...room.claimed };
  if (animating) {
    const rv = room.reveal!;
    const thisRound = new Set(rv.claims.map((c) => c.col));
    flagsShown = Object.fromEntries(Object.entries(room.claimed).filter(([c]) => !thisRound.has(Number(c))));
    room.teams.forEach((t, i) => {
      const ev = rv.events.find((e) => e.teamId === t.id);
      show[t.id] = { ...(ev?.to ?? room.pieces[t.id] ?? {}) };
      anims[t.id] = {};
      for (const [c, to] of Object.entries(show[t.id])) {
        const from = ev?.from[c] ?? 0;
        if (to > from) anims[t.id][c] = { rise: { from: to - from, delay: i * STEP } };
      }
    });
    for (const c of rv.claims) for (const id of c.teams) (anims[id][c.col] ??= {}).out = 'claim';
    for (const r of rv.resets) (anims[r.teamId][r.col] ??= {}).out = 'reset';
    for (const id of Object.keys(anims)) for (const a of Object.values(anims[id])) if (a.out) a.outDelay = tl.claimAt;
  } else {
    for (const t of room.teams) show[t.id] = room.pieces[t.id] ?? {};
  }
  const claimingNow = animating ? new Map(room.reveal!.claims.map((c) => [c.col, c.teams])) : new Map<number, string[]>();
  const myCols = ctx.role === 'team' ? new Set(Object.keys(room.pieces[ctx.meId] ?? {}).map(Number)) : new Set<number>();

  const cols = COLS.map((col) => {
    const h = HEIGHT[col];
    const owners = flagsShown[col] ?? [];
    const newOwners = claimingNow.get(col) ?? [];
    const ownerColor = owners.length ? colorOf(teamOf(room, owners[0])?.color ?? 0) : '';
    const cells: string[] = [];
    for (let pos = h; pos >= 1; pos--) {
      const here = room.teams.filter((t) => show[t.id]?.[col] === pos);
      const toks = here.map((t) => token(room, t.id, t.id === ctx.meId && ctx.role === 'team', anims[t.id]?.[col] ?? null, elapsed ?? 0)).join('');
      let flags = '';
      if (pos === h) {
        flags = owners.map((id) => `<span class="flag" style="--pc:${colorOf(teamOf(room, id)?.color ?? 0)}" title="${esc(teamOf(room, id)?.name)} 점령">${icon('flag')}<b>${teamNo(room, id)}</b></span>`).join('');
        flags += newOwners.map((id) => `<span class="flag pop" style="--pc:${colorOf(teamOf(room, id)?.color ?? 0)};animation-delay:${(tl.claimAt + 0.3 - (elapsed ?? 0)).toFixed(2)}s">${icon('flag')}<b>${teamNo(room, id)}</b></span>`).join('');
      }
      cells.push(`<div class="cell ${pos === h ? 'top' : ''} ${here.length > 4 ? 'many' : ''}">${flags}${toks}</div>`);
    }
    const prob = ctx.showProb ? `<span class="ways" title="두 주사위 합이 ${col}일 확률">${sumWays(col)}/64</span>` : '';
    return `<div class="col ${owners.length ? 'claimed' : ''} ${myCols.has(col) ? 'mine' : ''}" data-col="${col}" style="${owners.length ? `--owner:${ownerColor}` : ''}">
      ${cells.join('')}<div class="col-label">${col}</div>${prob}</div>`;
  }).join('');
  return `<div class="board" role="img" aria-label="등산로 게임판">
    <div class="ridge">${cols}</div>
    <div class="basecamp"><span>⛺ 베이스캠프 · 출발점</span></div>
  </div>`;
}

// ───────────── 퀴즈 ─────────────

function quizQuestion(q: Quiz): string {
  if (q.kind === 'sumWays') {
    return `정팔면체 주사위 두 개를 던질 때,<br/>두 눈의 합이 <b class="hl">${q.sum}</b>${josa(q.sum, '이가')} 되는 경우의 수는?`;
  }
  return `나온 주사위 4개 중 <b class="hl">2개</b>를 골라 더할 때,<br/>만들 수 있는 <b>서로 다른 합</b>은 모두 몇 가지?`;
}

export function quizExplain(q: Quiz, dice: number[]): string {
  if (q.kind === 'sumWays') {
    const pairs = sumPairs(q.sum);
    let grid = `<table class="grid64" aria-label="정팔면체 두 개의 눈의 합 표"><thead><tr><th>+</th>`;
    for (let b = 1; b <= FACES; b++) grid += `<th>${b}</th>`;
    grid += '</tr></thead><tbody>';
    for (let a = 1; a <= FACES; a++) {
      grid += `<tr><th>${a}</th>`;
      for (let b = 1; b <= FACES; b++) grid += `<td class="${a + b === q.sum ? 'on' : ''}">${a + b}</td>`;
      grid += '</tr>';
    }
    grid += '</tbody></table>';
    return `<div class="explain">${grid}
      <p>합이 ${q.sum}인 순서쌍: ${pairs.map(([a, b]) => `(${a}, ${b})`).join(', ')}</p>
      <p>→ 경우의 수 <b>${q.answer}가지</b> · 확률 <b>${q.answer}/64</b></p></div>`;
  }
  const sums = distinctPairSums(dice);
  const seen = new Set<number>();
  const rows = PAIR_INDEXES.map(([i, j]) => {
    const s = dice[i] + dice[j];
    const dup = seen.has(s);
    seen.add(s);
    return `<li class="${dup ? 'dup' : ''}">${die8(dice[i], 'mini')}${die8(dice[j], 'mini')}<span>= ${s}</span>${dup ? '<em>중복</em>' : ''}</li>`;
  }).join('');
  return `<div class="explain"><p>4개 중 2개를 고르는 방법은 6가지예요.</p>
    <ul class="pairs">${rows}</ul>
    <p>서로 다른 합: ${sums.join(', ')} → <b>${sums.length}가지</b></p></div>`;
}

function quizResult(q: Quiz, dice: number[], key: string): string {
  const ok = q.picked === q.answer;
  return `<div class="quiz-result ${ok ? 'ok' : 'no'}">
    <p class="result" role="status">${ok ? `⭕ 정답! <b>${q.answer}가지</b>` : `❌ ${q.picked} → 정답은 <b>${q.answer}가지</b>`}</p>
    <details data-key="${esc(key)}" ${ok ? '' : 'open'}><summary>풀이 보기</summary>${quizExplain(q, dice)}</details></div>`;
}

/** 공개 화면: 문제별 답 분포 */
function quizDistribution(room: Room, records: QuizRecord[]): string {
  if (!records.length) return '';
  const answered = records.filter((r) => r.picked !== null);
  const correct = answered.filter((r) => r.picked === r.answer).length;
  const groups = new Map<string, QuizRecord[]>();
  for (const r of records) {
    const k = r.kind === 'sumWays' ? `s${r.sum}` : `p${r.answer}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length || a[0].sum - b[0].sum);
  const rows = sorted.map((g) => {
    const q = g[0];
    const title = q.kind === 'sumWays' ? `합 <b>${q.sum}</b>의 경우의 수` : '만들 수 있는 합의 가짓수';
    const max = Math.max(1, ...ANSWER_CHOICES.map((n) => g.filter((r) => r.picked === n).length));
    const bars = ANSWER_CHOICES.map((n) => {
      const who = g.filter((r) => r.picked === n);
      const h = who.length ? Math.max(18, (who.length / max) * 100) : 0;
      const cls = n === q.answer ? 'right' : who.length ? 'wrong' : '';
      return `<div class="bar ${cls}" title="${n}: ${who.map((r) => esc(teamOf(room, r.teamId)?.name)).join(', ')}">
        <div class="bar-fill" style="height:${h}%">${who.length ? `<span>${who.length}</span>` : ''}</div>
        <div class="bar-x">${n}</div></div>`;
    }).join('');
    const none = g.filter((r) => r.picked === null).length;
    return `<div class="dist-row"><p class="dist-title">${title} <span class="muted">· 정답 <b>${q.answer}</b> · ${g.length}모둠${none ? ` (미응답 ${none})` : ''}</span></p><div class="bars">${bars}</div></div>`;
  }).join('');
  return `<section class="card dist-card">
    <h3>✏️ 퀴즈 답 분포 <span class="score-pill">${correct}/${records.length} 정답</span></h3>
    <p class="legend"><span class="lg right"></span>정답 <span class="lg wrong"></span>오답 · 모둠마다 주사위가 달라 문제별로 모았어요</p>
    <div class="dist-groups">${rows}</div>
  </section>`;
}

// ───────────── 라운드 결과 문장 ─────────────

function eventText(ev: TeamEvent): string {
  if (ev.kind === 'timeout') return '⏱ 시간 초과 · 이동 없음';
  if (ev.kind === 'pass') return '😴 움직일 수 없어 쉬기';
  if (ev.kind === 'withdraw') return `↩ ${ev.cols[0]}번 말 철수`;
  const counts = new Map<number, number>();
  for (const c of ev.cols) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([c, n]) => `${ev.from[c] === undefined ? '🆕 ' : ''}${c}번 +${n}`).join(' · ');
}

function revealList(room: Room, elapsed: number | null): string {
  const rv = room.reveal;
  if (!rv) return '';
  const tl = animTimeline(room);
  const el = elapsed ?? 99;
  const rows = room.teams.map((t, i) => {
    const ev = rv.events.find((e) => e.teamId === t.id);
    if (!ev) return '';
    return `<li class="fade-in" style="animation-delay:${(i * STEP - el).toFixed(2)}s">${teamChip(room, t.id)}<span>${eventText(ev)}</span></li>`;
  }).join('');
  const extra = [
    ...rv.claims.map((c) => `<li class="claim-line fade-in" style="animation-delay:${(tl.claimAt - el).toFixed(2)}s">🚩 <b>${c.col}번 등산로 점령!</b> ${c.teams.map((id) => teamChip(room, id)).join(' ')}</li>`),
    ...rv.resets.map((r) => `<li class="reset-line fade-in" style="animation-delay:${(tl.claimAt - el).toFixed(2)}s">⤵️ ${teamChip(room, r.teamId)} ${r.col}번 말(${r.from}칸) 출발점으로</li>`),
  ].join('');
  return `<section class="card"><h3>라운드 ${rv.round} 결과</h3><ul class="reveal-list">${rows}${extra}</ul></section>`;
}

// ───────────── 순위표 ─────────────

function scoreboard(room: Room, ctx: ViewCtx, compact = false): string {
  const rank = rankTeams(room);
  const rows = rank.map((s) => {
    const t = teamOf(room, s.teamId)!;
    return `<tr class="${s.teamId === ctx.meId ? 'me' : ''}" style="--pc:${colorOf(t.color)}">
      <td class="rk">${s.rank}</td>
      <td class="nm">${teamChip(room, s.teamId)}</td>
      <td title="깃발 ${s.flags}개 × ${FLAG_POINTS}점">🚩${s.flags}</td>
      <td title="올라간 칸 수">🧗${s.climb}</td>
      <td class="tot">${s.total}</td>
      ${compact ? '' : `<td title="퀴즈 정답 / 문제 수">✏️${s.correct}/${s.quizTotal}</td>`}
    </tr>`;
  }).join('');
  return `<table class="rank"><thead><tr><th>순위</th><th>모둠</th><th>깃발</th><th>칸</th><th>총점</th>${compact ? '' : '<th>퀴즈</th>'}</tr></thead><tbody>${rows}</tbody></table>
  <p class="legend">총점 = 깃발 × ${FLAG_POINTS}점 + 올라간 칸 · 동점이면 퀴즈 정답 수</p>`;
}

// ───────────── 상단 바 ─────────────

export function clock(room: Room, ctx: ViewCtx): string {
  if (room.status === 'finished') return `<div class="clock done">게임 끝</div>`;
  if (room.phase === 'play') {
    const left = Math.max(0, Math.ceil((room.deadline - ctx.now) / 1000));
    const pct = Math.min(100, (left / room.settings.roundSeconds) * 100);
    return `<div class="clock ${left <= 10 ? 'hurry' : ''}" role="timer" aria-label="남은 시간 ${left}초">
      <span class="clock-num">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>
      <span class="clock-bar"><span style="width:${pct}%"></span></span></div>`;
  }
  if (room.paused) return `<div class="clock paused">⏸ 설명 시간</div>`;
  const left = Math.max(0, Math.ceil((room.reveal!.at + revealDurationMs(room) - ctx.now) / 1000));
  return `<div class="clock reveal">공개! · 다음 라운드 ${left}초</div>`;
}

function topbar(room: Room, ctx: ViewCtx): string {
  const me = ctx.role === 'team' ? teamOf(room, ctx.meId) : null;
  const left = me
    ? `<div class="big-chip sm" style="--pc:${colorOf(me.color)}"><span class="tok">${teamNo(room, me.id)}</span>${esc(me.name)}</div>`
    : `<div class="room-tag">방 <b>${room.code}</b>${ctx.role === 'watch' ? ' · 관전' : ''}</div>`;
  const hostCtl = ctx.role === 'host' && room.status === 'playing'
    ? room.phase === 'play'
      ? `<button class="btn small" data-act="forceReveal" ${ctx.busy ? 'disabled' : ''}>${icon('skip')} 지금 공개</button>`
      : `${room.paused
          ? `<button class="btn small primary" data-act="next" ${ctx.busy ? 'disabled' : ''}>${icon('play')} 다음 라운드</button>`
          : `<button class="btn small" data-act="pause" ${ctx.busy ? 'disabled' : ''}>${icon('pause')} 잠깐 멈추기</button>`}`
    : '';
  return `<header class="topbar">
    ${left}
    <div class="round-tag">라운드 <b>${room.round}</b>/${room.settings.rounds}</div>
    ${clock(room, ctx)}
    <div class="tools">
      ${hostCtl}
      <button class="icon-btn ${ctx.showProb ? 'on' : ''}" data-act="prob" aria-pressed="${ctx.showProb}" title="각 합의 확률 표시">n/64</button>
      <button class="icon-btn" data-act="mute" aria-label="${isMuted() ? '소리 켜기' : '소리 끄기'}">${icon(isMuted() ? 'mute' : 'sound')}</button>
      <button class="icon-btn" data-act="help" aria-label="규칙 보기">${icon('help')}</button>
      <button class="icon-btn" data-act="leave" aria-label="나가기">${icon('exit')}</button>
    </div>
  </header>`;
}

// ───────────── 선생님·관전 화면 ─────────────

function submitStatus(room: Room, ctx: ViewCtx): string {
  const docs = new Map(ctx.teamDocs.filter((d) => current(d, room)).map((d) => [d.id, d]));
  let done = 0;
  const items = room.teams.map((t, i) => {
    const d = docs.get(t.id);
    let st = '대기', cls = 'idle';
    if (d?.decision) { st = '제출'; cls = 'done'; done++; }
    else if (d?.quiz && d.quiz.picked === null) { st = '퀴즈'; cls = 'quiz'; }
    else if (d?.dice) { st = '고르는 중'; cls = 'choose'; }
    return `<li class="${cls}" style="--pc:${colorOf(t.color)}"><span class="tok">${i + 1}</span><span class="tname">${esc(t.name)}</span><span class="st">${cls === 'done' ? '✅' : cls === 'quiz' ? '✏️' : cls === 'choose' ? '🤔' : '🎲'} ${st}</span></li>`;
  }).join('');
  return `<section class="card"><h3>제출 현황 <span class="score-pill">${done}/${room.teams.length}</span></h3><ul class="status-grid">${items}</ul>
    <p class="legend">모든 모둠이 내거나 시간이 끝나면 동시에 공개돼요.</p></section>`;
}

function renderConsole(room: Room, ctx: ViewCtx): string {
  const elapsed = animElapsed(room, ctx.now);
  const side = room.phase === 'play'
    ? submitStatus(room, ctx)
    : `${revealList(room, elapsed)}${quizDistribution(room, room.reveal?.quiz ?? [])}`;
  const showFinal = room.status === 'finished' && elapsed === null;
  return `<div class="game console">
    ${topbar(room, ctx)}
    ${modeBanner(ctx)}
    <div class="layout">
      <section class="board-wrap">${renderBoard(room, ctx, elapsed)}</section>
      <aside class="panel">
        ${side}
        <section class="card">${scoreboard(room, ctx)}</section>
      </aside>
    </div>
    ${showFinal ? finalOverlay(room, ctx) : ''}
  </div>`;
}

// ───────────── 모둠 태블릿 화면 ─────────────

function diceRow(dice: number[], key: string): string {
  return `<div class="dice-tray" data-anim="${esc(key)}">${dice.map((v) => die8(v)).join('')}</div>`;
}

function teamPanel(room: Room, ctx: ViewCtx): string {
  const me = ctx.meId;
  const d = current(ctx.teamDoc, room);
  const pieces = room.pieces[me] ?? {};
  const used = Object.keys(pieces).length;
  const pieceInfo = `<p class="runner-info">등반 중인 말 <b>${used}/${PIECES}</b>${used ? ` · ${Object.entries(pieces).map(([c, v]) => `${c}번(${v}/${HEIGHT[Number(c)]})`).join(', ')}` : ''}</p>`;

  if (room.phase === 'reveal' && room.reveal) {
    const rv = room.reveal;
    const ev = rv.events.find((e) => e.teamId === me);
    const myClaims = rv.claims.filter((c) => c.teams.includes(me));
    const myResets = rv.resets.filter((r) => r.teamId === me);
    const others = rv.claims.filter((c) => !c.teams.includes(me));
    return `<div class="phase reveal-me">
      <p class="eyebrow">라운드 ${rv.round} 공개!</p>
      ${ev ? `<p class="my-result">${eventText(ev)}</p>` : ''}
      ${myClaims.map((c) => `<div class="claim-box">🚩 <b>${c.col}번 등산로 점령!</b> +${FLAG_POINTS}점 · 새 말 1개를 받았어요</div>`).join('')}
      ${myResets.map((r) => `<div class="reset-box">⤵️ ${r.col}번 등산로가 점령되어 우리 말(${r.from}칸)이 출발점으로 돌아갔어요</div>`).join('')}
      ${others.map((c) => `<p class="muted">🚩 ${c.col}번 등산로: ${c.teams.map((id) => esc(teamOf(room, id)?.name)).join(', ')} 점령</p>`).join('')}
      ${room.status === 'finished' ? '' : `<p class="wait"><span class="spinner"></span>${room.paused ? '선생님 설명 시간이에요' : '다음 라운드 준비 중…'}</p>`}
      ${pieceInfo}
    </div>`;
  }

  const timeUp = ctx.now >= room.deadline;
  if (!d?.dice) {
    if (timeUp) return `<div class="phase"><p class="wait">⏱ 시간이 끝났어요. 이번 라운드는 이동 없이 공개를 기다려요.</p>${pieceInfo}</div>`;
    return `<div class="phase">
      <p class="eyebrow">라운드 ${room.round} · 주사위를 굴리세요</p>
      <button class="btn primary huge" data-act="roll" ${ctx.busy ? 'disabled' : ''}>${icon('dice')} 주사위 4개 굴리기</button>
      <p class="hint">정팔면체 주사위(1~8)를 굴려요. 모둠원과 함께 보세요!</p>
      ${pieceInfo}
    </div>`;
  }
  const qKey = `${room.code}:${room.round}:${me}`;
  const animKey = `${room.round}:${d.dice.join('')}`;
  if (d.quiz && d.quiz.picked === null) {
    return `<div class="phase quiz">
      ${diceRow(d.dice, animKey)}
      <p class="eyebrow">퀴즈를 맞히고 이동을 고르세요</p>
      <p class="question">${quizQuestion(d.quiz)}</p>
      <div class="answers" role="group" aria-label="답 고르기">${ANSWER_CHOICES.map((n) => `<button class="ans" data-act="answer" data-v="${n}" ${ctx.busy || timeUp ? 'disabled' : ''}>${n}</button>`).join('')}</div>
    </div>`;
  }
  const quizBox = d.quiz ? quizResult(d.quiz, d.dice, qKey) : '';
  if (d.decision) {
    const txt = d.decision.kind === 'move'
      ? `${d.decision.cols.join('번, ')}번 등산로로 이동`
      : d.decision.kind === 'withdraw' ? `${d.decision.cols[0]}번 말 철수` : '이번 라운드 쉬기';
    return `<div class="phase">
      ${diceRow(d.dice, animKey)}
      ${quizBox}
      <div class="submitted">✅ 제출 완료: <b>${txt}</b></div>
      <p class="wait"><span class="spinner"></span>모든 모둠이 내면 동시에 공개돼요</p>
      ${pieceInfo}
    </div>`;
  }
  const opts = getOptions(pieces, room.claimed, d.dice);
  let choice: string;
  if (opts.length) {
    choice = `<p class="eyebrow">주사위를 두 개씩 묶어 이동할 등산로를 고르세요</p>
      <div class="options">${opts.map((o) => {
        const parts = o.cols.map((c, i) => `<span class="opt-part g${i}">${o.groups[i].map((di) => die8(d.dice![di], 'mini')).join('')}<b>${c}</b>${pieces[c] === undefined ? '<em>새 말</em>' : ''}</span>`);
        return `<button class="opt" data-act="choose" data-v="${o.cols.join(',')}" data-preview="${o.cols.join(',')}" ${ctx.busy || timeUp ? 'disabled' : ''}>
          ${parts.join('<span class="opt-and">+</span>')}</button>`;
      }).join('')}</div>`;
  } else {
    const ws = Object.entries(pieces).map(([c, v]) =>
      `<button class="opt withdraw" data-act="withdraw" data-v="${c}" ${ctx.busy || timeUp ? 'disabled' : ''}>↩ <b>${c}번</b> 말 철수 <span class="muted">(${v}칸 → 출발점)</span></button>`).join('');
    choice = `<div class="stuck" role="alert"><p class="bust-title">😵 움직일 수 있는 말이 없어요</p>
      <p>${used ? '말 하나를 출발점으로 철수해 다른 등산로에 도전하거나, 이번 라운드를 쉬세요.' : '이번 라운드는 쉬어요.'}</p></div>
      <div class="options">${ws}<button class="opt" data-act="pass" ${ctx.busy || timeUp ? 'disabled' : ''}>😴 이번 라운드 쉬기</button></div>`;
  }
  return `<div class="phase choose">
    ${diceRow(d.dice, animKey)}
    ${quizBox}
    ${choice}
    ${pieceInfo}
  </div>`;
}

function renderTeamGame(room: Room, ctx: ViewCtx): string {
  const elapsed = animElapsed(room, ctx.now);
  const s = scoreOf(room, ctx.meId);
  const showFinal = room.status === 'finished' && elapsed === null;
  return `<div class="game team">
    ${topbar(room, ctx)}
    ${modeBanner(ctx)}
    <div class="layout">
      <aside class="panel">
        <section class="card turn-card" style="--pc:${colorOf(teamOf(room, ctx.meId)?.color ?? 0)}">${teamPanel(room, ctx)}</section>
      </aside>
      <section class="board-wrap">${renderBoard(room, ctx, elapsed)}</section>
      <section class="card my-score">
        <span>우리 점수 <b class="big-num">${s.total}</b>점</span>
        <span class="muted">🚩${s.flags}×${FLAG_POINTS} + 🧗${s.climb}칸 · ✏️ ${s.correct}/${s.quizTotal}</span>
      </section>
    </div>
    ${showFinal ? finalOverlay(room, ctx) : ''}
  </div>`;
}

export function renderGame(room: Room, ctx: ViewCtx): string {
  return ctx.role === 'team' ? renderTeamGame(room, ctx) : renderConsole(room, ctx);
}

function finalOverlay(room: Room, ctx: ViewCtx): string {
  const rank = rankTeams(room);
  const winners = rank.filter((s) => s.rank === 1);
  const mine = rank.find((s) => s.teamId === ctx.meId);
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="win-title">
    <div class="card result-card">
      <div class="trophy">🏆</div>
      <h2 id="win-title">${winners.map((w) => esc(teamOf(room, w.teamId)?.name)).join(', ')} 우승!</h2>
      ${mine ? `<p class="my-rank">우리 모둠: <b>${mine.rank}위</b> · ${mine.total}점</p>` : `<p class="muted">${room.settings.rounds}라운드 최종 결과</p>`}
      ${scoreboard(room, ctx)}
      <div class="row">
        ${ctx.role === 'host' ? `<button class="btn primary" data-act="again">같은 모둠으로 다시 하기</button>` : ''}
        <button class="btn ghost" data-act="leave">처음으로</button>
      </div>
    </div>
  </div>`;
}

export function renderMissing(): string {
  return `<main class="home"><section class="card center">
    <h2>방을 찾을 수 없어요</h2><p class="muted">코드를 다시 확인하거나 새 방을 만들어 주세요.</p>
    <button class="btn primary" data-act="leave">처음으로</button></section></main>`;
}

export function renderHelp(): string {
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" data-act="closeHelp">
    <div class="card help-card" data-stop>
      <button class="icon-btn close" data-act="closeHelp" aria-label="닫기">${icon('x')}</button>
      <h2 id="help-title">캔트 스탑 · 모둠 대전 규칙</h2>
      <ol class="rules">
        <li>모둠마다 태블릿 한 대. 매 라운드 <b>모든 모둠이 동시에</b> 정팔면체 주사위 4개를 굴려요.</li>
        <li>주사위를 <b>2개씩 두 묶음</b>으로 나눠, 각 묶음의 합(2~16)에 해당하는 등산로로 말을 한 칸씩 올려요. 두 합을 모두 쓸 수 있으면 둘 다 써야 해요.</li>
        <li>동시에 등반할 수 있는 말은 <b>3개</b>. 말은 그 등산로에 계속 남아 있어요.</li>
        <li>제한 시간(기본 1분) 안에 퀴즈를 풀고 이동을 골라요. 모두 내면 바로, 아니면 시간이 끝날 때 <b>동시에 공개</b>! 시간 안에 못 내면 이동 없음.</li>
        <li>등산로 꼭대기에 닿으면 <b>점령</b> 🚩 — 말은 깃발이 되고 새 말 1개를 받아요. <b>그 등산로에 있던 다른 모둠 말은 모두 출발점으로</b> 돌아가요. 같은 라운드에 함께 도착하면 함께 점령해요.</li>
        <li>움직일 수 있는 말이 없으면 말 하나를 <b>철수</b>(출발점으로)하거나 쉬어요.</li>
        <li>${'정해진 라운드(기본 15)'}가 끝나면 <b>깃발 1개 ${FLAG_POINTS}점 + 올라간 칸 1개 1점</b>. 동점이면 <b>퀴즈 정답 수</b>로 순위를 정해요.</li>
      </ol>
      <h3>✏️ 경우의 수 퀴즈 (전체 8×8 = 64가지)</h3>
      <ul class="rules">
        <li><b>합의 경우의 수</b>: 두 주사위의 합이 S가 되는 순서쌍은 몇 개?</li>
        <li><b>만들 수 있는 합</b>: 나온 4개 중 2개를 고르는 6가지 방법 중, 서로 다른 합은 몇 가지?</li>
      </ul>
      <p class="tip">💡 9번 등산로는 11칸으로 가장 길고 2·3·15·16번은 3칸뿐이에요. 왜 그럴까요? 위쪽 <b>n/64</b> 버튼으로 확률을 확인해 보세요.</p>
    </div>
  </div>`;
}
