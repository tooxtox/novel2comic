#!/usr/bin/env node
// scripts/build.mjs
// Bundle TypeScript sources to static/dist/* using esbuild.
// Usage:
//   node scripts/build.mjs          (one-shot build)
//   node scripts/build.mjs --watch  (rebuild on changes)

import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const ENTRIES = [
  { in: 'static/src/main.ts',    out: 'static/dist/app.js' },
  { in: 'static/src/landing.ts', out: 'static/dist/landing.js' },
];

const BASE_OPTIONS = {
  bundle: true,
  format: 'iife',
  // 必须 ≤ es2017: 国内厂商 (vivo/OPPO/小米) 的系统 WebView 常滞后于 AOSP,
  // es2020 的可选链 ?. / 空值合并 ?? 一旦不被支持, 整个 bundle 直接 SyntaxError,
  // 页面能显示但所有 JS 交互全部失效 (只剩 CSS :active 按压效果).
  // es2017 向下兼容到 Chrome 49 / Android 4.4 WebView, 足够安全.
  target: 'es2017',
  sourcemap: true,
  logLevel: 'info',
};

async function ensureOutDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function runBuild() {
  for (const entry of ENTRIES) {
    await ensureOutDir(entry.out);
    await build({
      ...BASE_OPTIONS,
      entryPoints: [entry.in],
      outfile: entry.out,
    });
  }
}

async function runWatch() {
  const contexts = [];
  for (const entry of ENTRIES) {
    await ensureOutDir(entry.out);
    const ctx = await context({
      ...BASE_OPTIONS,
      entryPoints: [entry.in],
      outfile: entry.out,
    });
    await ctx.watch();
    contexts.push(ctx);
  }
  // Keep the process alive; surface rebuild results in console.
  console.log('[build.mjs] watching for changes...');
}

const isWatch = process.argv.includes('--watch');

try {
  if (isWatch) {
    await runWatch();
  } else {
    await runBuild();
    console.log('[build.mjs] build complete');
  }
} catch (err) {
  console.error('[build.mjs] failed:', err);
  process.exit(1);
}