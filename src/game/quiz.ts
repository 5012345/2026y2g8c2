import { FACES, type Quiz, type QuizKind, type QuizMode } from './types';

/** n면체 주사위 두 개의 합이 s가 되는 경우의 수 (전체 n×n가지 중) */
export function sumWays(s: number, faces = FACES): number {
  if (s < 2 || s > faces * 2) return 0;
  return faces - Math.abs(s - (faces + 1));
}

/** 합이 s가 되는 순서쌍 목록 */
export function sumPairs(s: number, faces = FACES): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 1; a <= faces; a++) {
    const b = s - a;
    if (b >= 1 && b <= faces) out.push([a, b]);
  }
  return out;
}

/** 4개 주사위에서 2개를 고르는 6가지 조합 (인덱스) */
export const PAIR_INDEXES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];

export function pairSums(dice: number[]): number[] {
  return PAIR_INDEXES.map(([i, j]) => dice[i] + dice[j]);
}

export function distinctPairSums(dice: number[]): number[] {
  return [...new Set(pairSums(dice))].sort((a, b) => a - b);
}

export function makeQuiz(dice: number[], mode: QuizMode, rng: () => number = Math.random): Quiz | null {
  if (mode === 'off') return null;
  const kind: QuizKind = mode === 'mixed' ? (rng() < 0.5 ? 'sumWays' : 'pairSums') : mode;
  if (kind === 'sumWays') {
    const sums = distinctPairSums(dice);
    const sum = sums[Math.floor(rng() * sums.length)];
    return { kind, sum, answer: sumWays(sum), picked: null };
  }
  return { kind, sum: 0, answer: distinctPairSums(dice).length, picked: null };
}

/** 답 버튼 범위 */
export const ANSWER_CHOICES = Array.from({ length: FACES }, (_, i) => i + 1);

/** 숫자 뒤 조사 (이/가, 은/는) */
export function josa(n: number, pair: '이가' | '은는'): string {
  const last = n % 10;
  // 받침 없는 수: 2(이), 4(사), 5(오), 9(구)
  const noBatchim = [2, 4, 5, 9].includes(last);
  if (pair === '이가') return noBatchim ? '가' : '이';
  return noBatchim ? '는' : '은';
}
