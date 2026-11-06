export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 모둠 색 10가지 (흰 글자 대비 4.5:1 이상) — 말에는 모둠 번호도 함께 표시 */
export const TEAM_COLORS = [
  '#D93036', '#2F5BD3', '#1E8050', '#8445BC', '#C2410C',
  '#0F766E', '#BE185D', '#7C5A2E', '#1E3A8A', '#4D7C0F',
];

export function colorOf(i: number): string {
  return TEAM_COLORS[i % TEAM_COLORS.length];
}

/** 정팔면체 주사위 (위에서 본 모양: 마름모 + 삼각형 면) */
export function die8(value: number, cls = '', style = ''): string {
  return `<span class="die8 ${cls}" ${style ? `style="${style}"` : ''} role="img" aria-label="정팔면체 주사위 ${value}">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon class="d8-body" points="50,3 95,50 50,97 5,50"/>
      <polygon class="d8-face" points="50,14 84,70 16,70"/>
      <line class="d8-edge" x1="16" y1="70" x2="5" y2="50"/><line class="d8-edge" x1="84" y1="70" x2="95" y2="50"/>
      <line class="d8-edge" x1="16" y1="70" x2="50" y2="97"/><line class="d8-edge" x1="84" y1="70" x2="50" y2="97"/>
      <text x="50" y="58" text-anchor="middle" dominant-baseline="middle">${value}</text>
    </svg></span>`;
}

export type IconName = 'sound' | 'mute' | 'help' | 'exit' | 'crown' | 'flag' | 'x' | 'dice' | 'tv' | 'users' | 'plus' | 'pause' | 'play' | 'skip';

export function icon(name: IconName): string {
  const p: Record<IconName, string> = {
    sound: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    crown: '<path d="m2 6 4 12h12l4-12-6 5-4-7-4 7-6-5Z"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    dice: '<path d="M12 2 22 12 12 22 2 12Z"/><path d="M12 6 18 15H6Z"/>',
    tv: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="M6 4l14 8-14 8V4Z"/>',
    skip: '<path d="M5 4l10 8-10 8V4Z"/><path d="M19 5v14"/>',
  };
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[name]}</svg>`;
}

/** 이름 + 주격 조사(이/가), HTML 이스케이프 포함 */
export function subj(name: string): string {
  const last = name.charCodeAt(name.length - 1) - 0xac00;
  const j = last >= 0 && last < 11172 ? (last % 28 === 0 ? '가' : '이') : '(이)가';
  return esc(name) + j;
}
