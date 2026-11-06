import { makeQuiz } from './quiz';
import {
  COLS, DEFAULT_ROUND_SECONDS, DEFAULT_ROUNDS, FACES, FLAG_POINTS, HEIGHT, MAX_TEAMS, PIECES,
  type ClaimEvent, type Decision, type MoveOption, type QuizRecord, type ResetEvent, type Room, type Score,
  type Settings, type TeamDoc, type TeamEvent,
} from './types';

export class GameError extends Error {}

const PAIRINGS: number[][][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function pushLog(room: Room, text: string) {
  room.log = [text, ...room.log].slice(0, 12);
}

export function teamName(room: Room, id: string): string {
  return room.teams.find((t) => t.id === id)?.name ?? '?';
}

function assertHost(room: Room, pid: string) {
  if (room.hostId !== pid) throw new GameError('선생님(방 만든 화면)만 할 수 있어요.');
}

export function normalizeSettings(s: Partial<Settings>): Settings {
  const clamp = (n: unknown, lo: number, hi: number, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  return {
    quizMode: s.quizMode ?? 'sumWays',
    rounds: clamp(s.rounds, 1, 30, DEFAULT_ROUNDS),
    roundSeconds: clamp(s.roundSeconds, 20, 180, DEFAULT_ROUND_SECONDS),
  };
}

// ───────────── 방·모둠 관리 ─────────────

export function createRoom(code: string, hostId: string, settings: Partial<Settings>, now = Date.now()): Room {
  return {
    v: 2,
    code,
    hostId,
    status: 'lobby',
    settings: normalizeSettings(settings),
    teams: [],
    game: 0,
    round: 0,
    phase: 'play',
    deadline: 0,
    paused: false,
    pieces: {},
    claimed: {},
    flags: {},
    stats: {},
    reveal: null,
    log: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 모둠 참가: 대기실이면 추가, 게임 중이면 같은 이름 모둠으로 재접속 */
export function joinTeam(input: Room, id: string, rawName: string): { room: Room; teamId: string } {
  const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 12);
  if (!name) throw new GameError('모둠 이름을 입력해 주세요.');
  const room = clone(input);
  const byId = room.teams.find((t) => t.id === id);
  if (byId) return { room, teamId: id };
  const byName = room.teams.find((t) => t.name === name);
  if (room.status !== 'lobby') {
    if (byName) return { room, teamId: byName.id };
    throw new GameError('이미 게임이 시작됐어요. 같은 모둠 이름으로만 다시 들어올 수 있어요.');
  }
  if (byName) throw new GameError('같은 이름의 모둠이 이미 있어요.');
  if (room.teams.length >= MAX_TEAMS) throw new GameError(`한 방에는 최대 ${MAX_TEAMS}모둠까지 들어올 수 있어요.`);
  const used = new Set(room.teams.map((t) => t.color));
  const color = Array.from({ length: MAX_TEAMS }, (_, i) => i).find((c) => !used.has(c)) ?? 0;
  room.teams.push({ id, name, color });
  return { room, teamId: id };
}

export function removeTeam(input: Room, hostId: string, teamId: string): Room {
  assertHost(input, hostId);
  if (input.status !== 'lobby') throw new GameError('대기실에서만 내보낼 수 있어요.');
  const room = clone(input);
  room.teams = room.teams.filter((t) => t.id !== teamId);
  return room;
}

export function leaveTeam(input: Room, teamId: string): Room {
  if (input.status !== 'lobby') return input;
  const room = clone(input);
  room.teams = room.teams.filter((t) => t.id !== teamId);
  return room;
}

export function updateSettings(input: Room, hostId: string, s: Partial<Settings>): Room {
  assertHost(input, hostId);
  if (input.status !== 'lobby') throw new GameError('대기실에서만 바꿀 수 있어요.');
  const room = clone(input);
  room.settings = normalizeSettings({ ...room.settings, ...s });
  return room;
}

export function startGame(input: Room, hostId: string, now = Date.now()): Room {
  assertHost(input, hostId);
  if (input.teams.length < 1) throw new GameError('참가한 모둠이 없어요.');
  const room = clone(input);
  room.status = 'playing';
  room.claimed = {};
  room.pieces = {};
  room.flags = {};
  room.stats = {};
  for (const t of room.teams) {
    room.pieces[t.id] = {};
    room.flags[t.id] = [];
    room.stats[t.id] = { correct: 0, total: 0 };
  }
  room.reveal = null;
  room.paused = false;
  room.log = [];
  room.game = (room.game ?? 0) + 1;
  room.round = 1;
  room.phase = 'play';
  room.deadline = now + room.settings.roundSeconds * 1000;
  pushLog(room, `게임 시작! ${room.teams.length}모둠 · ${room.settings.rounds}라운드`);
  return room;
}

export function backToLobby(input: Room, hostId: string): Room {
  assertHost(input, hostId);
  const room = clone(input);
  room.status = 'lobby';
  room.round = 0;
  room.reveal = null;
  return room;
}

export function setPaused(input: Room, hostId: string, paused: boolean): Room {
  assertHost(input, hostId);
  const room = clone(input);
  room.paused = paused;
  return room;
}

// ───────────── 이동 계산 ─────────────

function blocked(claimed: Record<string, string[]>, col: number): boolean {
  return (claimed[col]?.length ?? 0) > 0;
}

function canAdvance(pieces: Record<string, number>, claimed: Record<string, string[]>, col: number): boolean {
  if (!(col in HEIGHT) || blocked(claimed, col)) return false;
  const pos = pieces[col];
  if (pos === undefined) return Object.keys(pieces).length < PIECES;
  return pos < HEIGHT[col];
}

function advanced(pieces: Record<string, number>, col: number): Record<string, number> {
  return { ...pieces, [col]: (pieces[col] ?? 0) + 1 };
}

/** 이 모둠의 말 위치와 주사위로 가능한 이동. 비어 있으면 이동 불가 */
export function getOptions(pieces: Record<string, number>, claimed: Record<string, string[]>, dice: number[] | null): MoveOption[] {
  if (!dice || dice.length !== 4) return [];
  const seen = new Set<string>();
  const out: MoveOption[] = [];
  const add = (cols: number[], groups: number[][]) => {
    const key = [...cols].sort((a, b) => a - b).join('+');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cols, groups });
  };
  for (const [g1, g2] of PAIRINGS) {
    const s1 = dice[g1[0]] + dice[g1[1]];
    const s2 = dice[g2[0]] + dice[g2[1]];
    if (canAdvance(pieces, claimed, s1) && canAdvance(advanced(pieces, s1), claimed, s2)) {
      add([s1, s2], [g1, g2]); // 두 합을 모두 쓸 수 있으면 반드시 둘 다
      continue;
    }
    if (canAdvance(pieces, claimed, s1)) add([s1], [g1]);
    if (canAdvance(pieces, claimed, s2)) add([s2], [g2]);
  }
  return out;
}

function sameCols(a: number[], b: number[]) {
  return [...a].sort((x, y) => x - y).join('+') === [...b].sort((x, y) => x - y).join('+');
}

// ───────────── 모둠의 한 라운드 (자기 문서만 수정) ─────────────

function assertPlaying(room: Room, teamId: string) {
  if (room.status !== 'playing' || room.phase !== 'play') throw new GameError('지금은 라운드가 진행 중이 아니에요.');
  if (!room.teams.some((t) => t.id === teamId)) throw new GameError('이 방의 모둠이 아니에요.');
}

export function current(doc: TeamDoc | null, room: Room): TeamDoc | null {
  return doc && doc.game === room.game && doc.round === room.round ? doc : null;
}

export function rollDice(room: Room, teamId: string, doc: TeamDoc | null, rng: () => number = Math.random, now = Date.now()): TeamDoc {
  assertPlaying(room, teamId);
  if (current(doc, room)?.dice) throw new GameError('이번 라운드에는 이미 굴렸어요.');
  const dice = [0, 0, 0, 0].map(() => 1 + Math.floor(rng() * FACES));
  return { id: teamId, game: room.game, round: room.round, dice, quiz: makeQuiz(dice, room.settings.quizMode, rng), decision: null, updatedAt: now };
}

export function answerQuiz(room: Room, teamId: string, doc: TeamDoc | null, picked: number, now = Date.now()): TeamDoc {
  assertPlaying(room, teamId);
  const d = current(doc, room);
  if (!d?.quiz || d.quiz.picked !== null) throw new GameError('풀 문제가 없어요.');
  return { ...clone(d), quiz: { ...d.quiz, picked }, updatedAt: now };
}

/** 퀴즈를 푼 뒤(또는 퀴즈가 없으면) 이동을 고를 수 있음 */
export function needsAnswer(doc: TeamDoc | null): boolean {
  return !!doc?.quiz && doc.quiz.picked === null;
}

export function decide(room: Room, teamId: string, doc: TeamDoc | null, decision: Decision, now = Date.now()): TeamDoc {
  assertPlaying(room, teamId);
  const d = current(doc, room);
  if (!d?.dice) throw new GameError('먼저 주사위를 굴려 주세요.');
  if (needsAnswer(d)) throw new GameError('먼저 퀴즈를 풀어 주세요.');
  if (d.decision) throw new GameError('이번 라운드 선택을 이미 냈어요.');
  const pieces = room.pieces[teamId] ?? {};
  const opts = getOptions(pieces, room.claimed, d.dice);
  if (decision.kind === 'move') {
    if (!opts.some((o) => sameCols(o.cols, decision.cols))) throw new GameError('그 이동은 할 수 없어요.');
  } else if (decision.kind === 'withdraw') {
    if (opts.length > 0) throw new GameError('움직일 수 있을 때는 철수할 수 없어요.');
    if (decision.cols.length !== 1 || pieces[decision.cols[0]] === undefined) throw new GameError('철수할 말을 골라 주세요.');
  } else if (opts.length > 0) {
    throw new GameError('움직일 수 있는 말이 있어요.');
  }
  return { ...clone(d), decision: { kind: decision.kind, cols: [...decision.cols] }, updatedAt: now };
}

// ───────────── 라운드 판정 (동시 공개) ─────────────

export function allSubmitted(room: Room, docs: Record<string, TeamDoc | null>): boolean {
  return room.teams.length > 0 && room.teams.every((t) => !!current(docs[t.id] ?? null, room)?.decision);
}

export function resolveRound(input: Room, docs: Record<string, TeamDoc | null>, now = Date.now()): Room {
  if (input.status !== 'playing' || input.phase !== 'play') throw new GameError('판정할 라운드가 없어요.');
  const room = clone(input);
  const startClaimed = room.claimed;
  const events: TeamEvent[] = [];
  const quiz: QuizRecord[] = [];

  // 1) 모든 모둠의 이동을 라운드 시작 상태 기준으로 동시에 적용
  for (const t of room.teams) {
    const before = { ...(room.pieces[t.id] ?? {}) };
    let after = { ...before };
    const d = current(docs[t.id] ?? null, room);
    let kind: TeamEvent['kind'] = 'timeout';
    let cols: number[] = [];
    if (d?.decision) {
      const opts = getOptions(before, startClaimed, d.dice);
      const dec = d.decision;
      if (dec.kind === 'move' && opts.some((o) => sameCols(o.cols, dec.cols))) {
        for (const c of dec.cols) after = advanced(after, c);
        kind = 'move';
        cols = dec.cols;
      } else if (dec.kind === 'withdraw' && opts.length === 0 && before[dec.cols[0]] !== undefined) {
        delete after[dec.cols[0]];
        kind = 'withdraw';
        cols = dec.cols;
      } else {
        kind = 'pass';
      }
    }
    if (d?.quiz) {
      quiz.push({ teamId: t.id, kind: d.quiz.kind, sum: d.quiz.sum, answer: d.quiz.answer, picked: d.quiz.picked });
      if (d.quiz.picked !== null) {
        const st = (room.stats[t.id] ??= { correct: 0, total: 0 });
        st.total += 1;
        if (d.quiz.picked === d.quiz.answer) st.correct += 1;
      }
    }
    room.pieces[t.id] = after;
    events.push({ teamId: t.id, kind, cols, from: before, to: { ...after } });
  }

  // 2) 정상 도착 → 점령. 같은 라운드 동시 도착은 함께 점령
  const claims: ClaimEvent[] = [];
  const resets: ResetEvent[] = [];
  for (const col of COLS) {
    const arrived = room.teams.filter((t) => (room.pieces[t.id]?.[col] ?? 0) >= HEIGHT[col]).map((t) => t.id);
    if (!arrived.length) continue;
    room.claimed[col] = arrived;
    claims.push({ col, teams: arrived });
    for (const t of room.teams) {
      const pos = room.pieces[t.id]?.[col];
      if (pos === undefined) continue;
      if (arrived.includes(t.id)) {
        (room.flags[t.id] ??= []).push(col); // 말은 깃발이 되고, 새 말 1개를 받음(자리 비움)
      } else {
        resets.push({ teamId: t.id, col, from: pos }); // 그 등산로의 다른 말은 출발점으로
      }
      delete room.pieces[t.id][col];
    }
    pushLog(room, `🚩 ${col}번 등산로 점령: ${arrived.map((id) => teamName(room, id)).join(', ')}${resets.some((r) => r.col === col) ? ` · 다른 말 ${resets.filter((r) => r.col === col).length}개 출발점으로` : ''}`);
  }

  room.reveal = { round: room.round, at: now, events, claims, resets, quiz };
  room.phase = 'reveal';
  if (room.round >= room.settings.rounds) {
    room.status = 'finished';
    const top = rankTeams(room)[0];
    if (top) pushLog(room, `🏆 ${teamName(room, top.teamId)} 우승! (${top.total}점)`);
  }
  room.updatedAt = now;
  return room;
}

export function nextRound(input: Room, now = Date.now()): Room {
  if (input.status !== 'playing' || input.phase !== 'reveal') throw new GameError('다음 라운드로 갈 수 없어요.');
  const room = clone(input);
  room.round += 1;
  room.phase = 'play';
  room.deadline = now + room.settings.roundSeconds * 1000;
  room.updatedAt = now;
  return room;
}

/** 공개 애니메이션 + 설명 시간 */
export function revealDurationMs(room: Room): number {
  return 9000 + room.teams.length * 450;
}

// ───────────── 점수 ─────────────

export function scoreOf(room: Room, teamId: string): Omit<Score, 'rank'> {
  const flags = room.flags[teamId]?.length ?? 0;
  const climb = Object.values(room.pieces[teamId] ?? {}).reduce((s, v) => s + v, 0);
  const st = room.stats[teamId] ?? { correct: 0, total: 0 };
  return { teamId, flags, climb, total: flags * FLAG_POINTS + climb, correct: st.correct, quizTotal: st.total };
}

/** 총점 → 퀴즈 정답 수 순. 둘 다 같으면 공동 순위 */
export function rankTeams(room: Room): Score[] {
  const list = room.teams.map((t) => scoreOf(room, t.id));
  list.sort((a, b) => b.total - a.total || b.correct - a.correct);
  return list.map((s, i) => {
    const firstSame = list.findIndex((x) => x.total === s.total && x.correct === s.correct);
    return { ...s, rank: (firstSame === -1 ? i : firstSame) + 1 };
  });
}
