/** 아주 가벼운 효과음 (Web Audio, 파일 없음) */
let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem('cant-stop:muted') === '1';
} catch {
  /* 저장소 사용 불가 */
}

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem('cant-stop:muted', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.15) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type Sfx = 'roll' | 'correct' | 'wrong' | 'move' | 'bust' | 'claim' | 'turn' | 'win';

export function play(s: Sfx) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    return;
  }
  switch (s) {
    case 'roll':
      for (let i = 0; i < 5; i++) tone(180 + Math.random() * 220, i * 0.045, 0.04, 'square', 0.05);
      break;
    case 'correct':
      tone(660, 0, 0.12, 'triangle');
      tone(990, 0.1, 0.18, 'triangle');
      break;
    case 'wrong':
      tone(220, 0, 0.18, 'sawtooth', 0.07);
      tone(180, 0.15, 0.22, 'sawtooth', 0.07);
      break;
    case 'move':
      tone(520, 0, 0.08, 'triangle', 0.1);
      break;
    case 'bust':
      [440, 370, 300, 220].forEach((f, i) => tone(f, i * 0.1, 0.12, 'square', 0.06));
      break;
    case 'claim':
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.16, 'triangle'));
      break;
    case 'turn':
      tone(880, 0, 0.1, 'sine', 0.12);
      tone(1175, 0.12, 0.14, 'sine', 0.12);
      break;
    case 'win':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle'));
      break;
  }
}
