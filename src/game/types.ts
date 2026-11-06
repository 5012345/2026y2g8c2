// 캔트 스탑 · 모둠 동시 대전판 — 공통 타입
// Firestore 호환: undefined 금지(null 사용), 배열 안에 배열 금지

/** 정팔면체 주사위 */
export const FACES = 8;

/** 등산로 2~16 */
export const COLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

/** 등산로 칸 수 — 한 번 굴림에서 그 합을 쓸 수 있을 확률에 비례 */
export const HEIGHT: Record<number, number> = {
  2: 3, 3: 3, 4: 4, 5: 6, 6: 7, 7: 8, 8: 10, 9: 11, 10: 10, 11: 8, 12: 7, 13: 6, 14: 4, 15: 3, 16: 3,
};

export const MAX_TEAMS = 10;
/** 동시에 등반할 수 있는 말 수 */
export const PIECES = 3;
export const FLAG_POINTS = 5;
export const DEFAULT_ROUNDS = 15;
export const DEFAULT_ROUND_SECONDS = 60;

export type QuizKind = 'sumWays' | 'pairSums';
export type QuizMode = QuizKind | 'mixed' | 'off';

export interface Settings {
  quizMode: QuizMode;
  rounds: number;
  roundSeconds: number;
}

export interface Team {
  id: string;
  name: string;
  color: number; // 0~9
}

export interface Quiz {
  kind: QuizKind;
  /** sumWays 문제에서 묻는 합 (pairSums는 0) */
  sum: number;
  answer: number;
  picked: number | null;
}

/** move: 이동 · withdraw: 말 1개 철수(이동 불가일 때만) · pass: 이번 라운드 쉬기 */
export interface Decision {
  kind: 'move' | 'withdraw' | 'pass';
  cols: number[];
}

/** 모둠별 라운드 문서 (rooms/{code}/teams/{teamId}) — 그 모둠만 씀 */
export interface TeamDoc {
  id: string;
  /** 몇 번째 게임인지 (같은 방에서 다시 하기 구분) */
  game: number;
  round: number;
  dice: number[] | null;
  quiz: Quiz | null;
  decision: Decision | null;
  updatedAt: number;
}

export interface TeamEvent {
  teamId: string;
  kind: 'move' | 'withdraw' | 'pass' | 'timeout';
  cols: number[];
  /** 이동 전·후 말 위치 (열 → 칸) */
  from: Record<string, number>;
  to: Record<string, number>;
}

export interface ClaimEvent {
  col: number;
  teams: string[];
}

export interface ResetEvent {
  teamId: string;
  col: number;
  from: number;
}

export interface QuizRecord {
  teamId: string;
  kind: QuizKind;
  sum: number;
  answer: number;
  picked: number | null;
}

export interface Reveal {
  round: number;
  at: number;
  events: TeamEvent[];
  claims: ClaimEvent[];
  resets: ResetEvent[];
  quiz: QuizRecord[];
}

export interface Stat {
  correct: number;
  total: number;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';
export type RoundPhase = 'play' | 'reveal';

export interface Room {
  v: 2;
  code: string;
  hostId: string;
  status: RoomStatus;
  settings: Settings;
  teams: Team[];
  /** 같은 방에서 몇 번째 게임인지 */
  game: number;
  round: number;
  phase: RoundPhase;
  /** 이번 라운드 마감 시각(ms) */
  deadline: number;
  paused: boolean;
  /** 모둠 id → 열 → 칸 (등반 중인 말) */
  pieces: Record<string, Record<string, number>>;
  /** 열 → 점령한 모둠 id들 (같은 라운드 동시 도착이면 여러 모둠) */
  claimed: Record<string, string[]>;
  /** 모둠 id → 깃발을 꽂은 열 */
  flags: Record<string, number[]>;
  stats: Record<string, Stat>;
  reveal: Reveal | null;
  log: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MoveOption {
  cols: number[];
  /** 주사위 묶음 (인덱스) — 화면 표시용 */
  groups: number[][];
}

export interface Score {
  teamId: string;
  flags: number;
  climb: number;
  total: number;
  correct: number;
  quizTotal: number;
  rank: number;
}
