import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allSubmitted, answerQuiz, createRoom, decide, GameError, getOptions, joinTeam, nextRound, rankTeams,
  resolveRound, rollDice, startGame,
} from '../src/game/rules';
import { distinctPairSums, josa, makeQuiz, sumWays } from '../src/game/quiz';
import { COLS, HEIGHT, type Room, type TeamDoc } from '../src/game/types';

/** 주사위 눈을 정해서 굴리는 rng (1~8) */
function rngFor(values: number[]): () => number {
  let i = 0;
  return () => (values[i++ % values.length] - 1) / 8 + 0.01;
}

function game(n = 2, quizMode: Room['settings']['quizMode'] = 'off'): Room {
  let r = createRoom('ABCD', 'host', { quizMode, rounds: 15, roundSeconds: 60 });
  for (let i = 0; i < n; i++) r = joinTeam(r, `t${i}`, `${i + 1}모둠`).room;
  return startGame(r, 'host', 1000);
}

function play(r: Room, teamId: string, dice: number[], cols: number[] | 'pass' | { withdraw: number }): TeamDoc {
  let d = rollDice(r, teamId, null, rngFor(dice));
  if (d.quiz) d = answerQuiz(r, teamId, d, d.quiz.answer);
  if (cols === 'pass') return decide(r, teamId, d, { kind: 'pass', cols: [] });
  if (!Array.isArray(cols)) return decide(r, teamId, d, { kind: 'withdraw', cols: [cols.withdraw] });
  return decide(r, teamId, d, { kind: 'move', cols });
}

test('정팔면체 두 개의 합: 경우의 수 합계 64, 9가 최대 8가지', () => {
  const w = COLS.map((s) => sumWays(s));
  assert.deepEqual(w, [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(w.reduce((a, b) => a + b, 0), 64);
  assert.equal(sumWays(7, 6), 6); // 정육면체 일반화
});

test('등산로 길이: 확률 비례, 좌우 대칭', () => {
  for (const c of COLS) assert.equal(HEIGHT[c], HEIGHT[18 - c]);
  assert.equal(HEIGHT[9], 11);
});

test('퀴즈: 합의 경우의 수 / 만들 수 있는 합', () => {
  for (let i = 0; i < 50; i++) {
    const q = makeQuiz([1, 7, 8, 3], 'sumWays')!;
    assert.ok(distinctPairSums([1, 7, 8, 3]).includes(q.sum));
    assert.equal(q.answer, sumWays(q.sum));
  }
  assert.equal(makeQuiz([8, 8, 8, 8], 'pairSums')!.answer, 1);
  assert.equal(josa(14, '이가'), '가');
  assert.equal(josa(16, '이가'), '이');
});

test('이동 선택지: 두 합 모두 사용, 말 3개 제한', () => {
  assert.deepEqual(getOptions({}, {}, [1, 1, 8, 8]).map((o) => o.cols.join('+')), ['2+16', '9+9']);
  const opts = getOptions({ 2: 1, 3: 1 }, {}, [3, 4, 5, 6]).map((o) => o.cols.join('+')).sort();
  // 말 1개 남음 → 서로 다른 두 새 등산로는 불가, 같은 등산로 9+9는 가능
  assert.deepEqual(opts, ['10', '11', '7', '8', '9+9'].sort());
  // 점령된 등산로는 막힘
  assert.deepEqual(getOptions({}, { 9: ['x'] }, [4, 5, 4, 5]).map((o) => o.cols.join('+')), ['8+10']);
});

test('퀴즈를 풀어야 이동 가능, 한 라운드 한 번만', () => {
  const r = game(1, 'sumWays');
  const d = rollDice(r, 't0', null, rngFor([1, 2, 3, 4]));
  assert.throws(() => decide(r, 't0', d, { kind: 'move', cols: getOptions({}, {}, d.dice)[0].cols }), GameError);
  assert.throws(() => rollDice(r, 't0', d), GameError);
  const a = answerQuiz(r, 't0', d, 1);
  assert.throws(() => answerQuiz(r, 't0', a, 2), GameError);
  const done = decide(r, 't0', a, { kind: 'move', cols: getOptions({}, {}, a.dice)[0].cols });
  assert.throws(() => decide(r, 't0', done, { kind: 'pass', cols: [] }), GameError);
});

test('동시 공개: 같은 칸에 같이 있어도 서로 영향 없음', () => {
  let r = game(2);
  const docs = { t0: play(r, 't0', [4, 5, 1, 1], [9, 2]), t1: play(r, 't1', [4, 5, 1, 1], [9, 2]) };
  assert.ok(allSubmitted(r, docs));
  r = resolveRound(r, docs, 2000);
  assert.deepEqual(r.pieces.t0, { 2: 1, 9: 1 });
  assert.deepEqual(r.pieces.t1, { 2: 1, 9: 1 });
  assert.equal(r.phase, 'reveal');
});

test('점령: 깃발 + 새 말, 그 등산로의 다른 말은 출발점으로', () => {
  let r = game(3);
  r.pieces.t0 = { 2: 2, 9: 3 };
  r.pieces.t1 = { 2: 1, 5: 4 };
  r.pieces.t2 = { 9: 10 };
  const docs = {
    t0: play(r, 't0', [1, 1, 4, 4], [2, 8]), // 2번 정상(3칸) 도착
    t1: play(r, 't1', [2, 3, 8, 8], [5, 16]),
  } as Record<string, TeamDoc>; // t2는 시간 초과
  r = resolveRound(r, docs, 2000);
  assert.deepEqual(r.claimed[2], ['t0']);
  assert.deepEqual(r.flags.t0, [2]);
  assert.equal(r.pieces.t0[2], undefined); // 깃발이 되어 자리 빔 → 다시 3개 사용 가능
  assert.equal(r.pieces.t1[2], undefined); // 출발점으로
  assert.deepEqual(r.reveal!.resets, [{ teamId: 't1', col: 2, from: 1 }]);
  assert.deepEqual(getOptions(r.pieces.t0, r.claimed, [1, 1, 1, 1]), []); // 2번 닫힘
});

test('이동 불가일 때만 철수/쉬기 가능', () => {
  let r = game(1);
  r.pieces.t0 = { 2: 1, 3: 1, 4: 1 };
  // 8,8,8,8 → 16만 가능, 말 3개 모두 사용 중 → 이동 불가
  assert.deepEqual(getOptions(r.pieces.t0, {}, [8, 8, 8, 8]), []);
  const d = play(r, 't0', [8, 8, 8, 8], { withdraw: 3 });
  r = resolveRound(r, { t0: d }, 2000);
  assert.deepEqual(r.pieces.t0, { 2: 1, 4: 1 });
  r = nextRound(r, 3000);
  assert.throws(() => play(r, 't0', [1, 2, 3, 4], { withdraw: 2 }), GameError);
  assert.throws(() => play(r, 't0', [1, 2, 3, 4], 'pass'), GameError);
});

test('시간 초과: 이동 없음', () => {
  let r = game(2);
  r = resolveRound(r, { t0: play(r, 't0', [1, 2, 3, 4], [3, 7]) }, 2000);
  assert.deepEqual(r.pieces.t1, {});
  assert.equal(r.reveal!.events.find((e) => e.teamId === 't1')!.kind, 'timeout');
});

test('동시 정상 도착은 함께 점령', () => {
  let r = game(2);
  r.pieces.t0 = { 16: 2 };
  r.pieces.t1 = { 16: 2 };
  r = resolveRound(r, { t0: play(r, 't0', [8, 8, 1, 1], [16, 2]), t1: play(r, 't1', [8, 8, 1, 2], [16, 3]) }, 2000);
  assert.deepEqual(r.claimed[16], ['t0', 't1']);
  assert.equal(r.reveal!.resets.length, 0);
});

test('점수: 깃발 5점 + 올라간 칸 1점, 동점이면 퀴즈 정답 수', () => {
  const r = game(3, 'sumWays');
  r.flags = { t0: [2], t1: [16], t2: [] };
  r.pieces = { t0: { 9: 3 }, t1: { 8: 1, 10: 2 }, t2: { 9: 7, 8: 1 } };
  r.stats = { t0: { correct: 2, total: 5 }, t1: { correct: 4, total: 5 }, t2: { correct: 4, total: 5 } };
  const rank = rankTeams(r);
  assert.deepEqual(rank.map((s) => [s.teamId, s.total, s.rank]), [['t1', 8, 1], ['t2', 8, 1], ['t0', 8, 3]]);
});

test('15라운드 무작위 10모둠 200판: 항상 종료, 상태 유효', () => {
  for (let g = 0; g < 200; g++) {
    let r = game(10, 'mixed');
    while (r.status === 'playing') {
      const docs: Record<string, TeamDoc> = {};
      for (const t of r.teams) {
        if (Math.random() < 0.05) continue; // 가끔 시간 초과
        let d = rollDice(r, t.id, null);
        if (d.quiz) d = answerQuiz(r, t.id, d, 1 + Math.floor(Math.random() * 8));
        const opts = getOptions(r.pieces[t.id], r.claimed, d.dice);
        const keys = Object.keys(r.pieces[t.id]);
        const dec = opts.length
          ? { kind: 'move' as const, cols: opts[Math.floor(Math.random() * opts.length)].cols }
          : keys.length && Math.random() < 0.5
            ? { kind: 'withdraw' as const, cols: [Number(keys[0])] }
            : { kind: 'pass' as const, cols: [] };
        docs[t.id] = decide(r, t.id, d, dec);
      }
      r = resolveRound(r, docs);
      for (const t of r.teams) {
        const p = r.pieces[t.id];
        assert.ok(Object.keys(p).length <= 3);
        for (const [c, v] of Object.entries(p)) {
          assert.ok(v >= 1 && v < HEIGHT[Number(c)]);
          assert.ok(!r.claimed[c]);
        }
      }
      JSON.stringify(r, (_k, v) => {
        assert.notEqual(v, undefined);
        if (Array.isArray(v)) assert.ok(v.every((x) => !Array.isArray(x)));
        return v;
      });
      if (r.status === 'playing') r = nextRound(r);
    }
    assert.equal(r.round, 15);
    assert.equal(rankTeams(r).length, 10);
  }
});
