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

/** 배경 풍경 (하늘·해·구름·겹겹이 산·숲) — 한 번만 그려 body 뒤에 고정 */
export function sceneSvg(): string {
  const pines = (y: number, n: number, seed: number, color: string, h: number) => {
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = ((i * 97 + seed * 31) % 1600) + ((i * 13) % 20);
      const hh = h * (0.7 + ((i * 7 + seed) % 5) / 10);
      out += `<path d="M${x} ${y} l${hh * 0.32} ${-hh} l${hh * 0.32} ${hh}Z" fill="${color}"/>`;
    }
    return out;
  };
  return `<svg class="scene-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9fd3f2"/><stop offset=".55" stop-color="#d6eefa"/><stop offset="1" stop-color="#fff4df"/>
      </linearGradient>
      <linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9cfe0"/><stop offset="1" stop-color="#d7e4ec"/></linearGradient>
      <linearGradient id="mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fae9c"/><stop offset="1" stop-color="#a9c4ae"/></linearGradient>
      <linearGradient id="near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f9a6e"/><stop offset="1" stop-color="#86ad78"/></linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#sky)"/>
    <circle cx="1270" cy="170" r="70" fill="#fff6c9" opacity=".9"/>
    <circle cx="1270" cy="170" r="110" fill="#fff6c9" opacity=".25"/>
    <g fill="#fff" opacity=".85">
      <ellipse cx="260" cy="150" rx="90" ry="26"/><ellipse cx="320" cy="135" rx="60" ry="30"/><ellipse cx="200" cy="140" rx="50" ry="22"/>
      <ellipse cx="900" cy="95" rx="70" ry="18"/><ellipse cx="950" cy="85" rx="45" ry="22"/>
    </g>
    <path d="M0 560 L120 470 L210 520 L360 360 L470 450 L560 400 L700 250 L820 380 L900 330 L1040 460 L1150 370 L1290 280 L1420 420 L1520 380 L1600 430 V900 H0Z" fill="url(#far)"/>
    <path d="M700 250 L740 293 L722 300 L705 286 L686 298 L668 286Z M1290 280 L1330 323 L1310 330 L1292 318 L1272 330 L1254 316Z M360 360 L392 398 L376 404 L360 392 L344 404 L330 393Z" fill="#fff" opacity=".9"/>
    <path d="M0 650 L150 560 L300 620 L450 540 L620 610 L780 520 L940 600 L1100 530 L1260 600 L1420 540 L1600 590 V900 H0Z" fill="url(#mid)"/>
    ${pines(640, 26, 3, '#6f917c', 46)}
    <path d="M0 760 C200 700 360 730 520 700 C700 665 860 720 1040 690 C1220 660 1400 700 1600 680 V900 H0Z" fill="url(#near)"/>
    ${pines(760, 34, 7, '#4f7b55', 58)}
    <path d="M0 840 C260 800 520 830 800 810 C1080 790 1340 820 1600 800 V900 H0Z" fill="#5c8a5a"/>
  </svg>`;
}

/** 로고용 작은 산 */
export function peakLogo(): string {
  return `<svg class="peak-logo" viewBox="0 0 120 70" aria-hidden="true">
    <path d="M4 66 L40 22 L54 38 L72 10 L116 66Z" fill="#5f8a6a"/>
    <path d="M72 10 L84 26 L77 24 L72 30 L66 23 L61 26Z M40 22 L48 32 L43 31 L39 35 L35 30Z" fill="#fff"/>
    <path d="M72 10 V-4" stroke="#7a4a1e" stroke-width="2.5"/><path d="M72 -4 L88 1 L72 6Z" fill="#e8590c"/>
  </svg>`;
}
