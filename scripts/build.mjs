// 빌드: src → dist (GitHub Pages용 정적 파일)
// 사용법: node scripts/build.mjs          → dist/ 생성
//        node scripts/build.mjs --serve  → http://localhost:5173 개발 서버
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(`${outdir}/assets`, { recursive: true });
cpSync('index.html', `${outdir}/index.html`);
cpSync('public', outdir, { recursive: true });
writeFileSync(`${outdir}/.nojekyll`, '');

const options = {
  entryPoints: { app: 'src/main.ts' },
  bundle: true,
  format: 'iife', // file:// 로 index.html을 바로 열어도 동작하도록 일반 스크립트로 빌드
  target: ['es2020', 'chrome90', 'safari15'],
  outdir: `${outdir}/assets`,
  minify: !serve,
  sourcemap: serve,
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 5173, host: '0.0.0.0' });
  console.log(`\n▶ http://localhost:${port}  (로컬 체험: http://localhost:${port}/?local=1)\n`);
} else {
  await esbuild.build(options);
  console.log('✔ dist/ 빌드 완료');
}
