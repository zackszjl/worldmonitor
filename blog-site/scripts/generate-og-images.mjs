import satori from 'satori';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';

const BLOG_DIR = join(import.meta.dirname, '..', 'src', 'content', 'blog');
const OUT_DIR = join(import.meta.dirname, '..', 'public', 'og');
const WIDTH = 1200;
const HEIGHT = 630;
const FONT_NAME = 'OG Sans';

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));
let generated = 0;
let skipped = 0;
const pendingFiles = [];

function h(type, style, children) {
  return { type, props: { style, children } };
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function firstExistingPath(paths) {
  return paths.find(fontPath => fontPath && existsSync(fontPath)) ?? null;
}

function loadFont(weight, envKey, candidates) {
  const fontPath = firstExistingPath([process.env[envKey], ...candidates]);
  if (!fontPath) return null;

  return {
    data: toArrayBuffer(readFileSync(fontPath)),
    path: fontPath,
  };
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

const fontDir = process.env.WM_OG_FONT_DIR;
const regularCandidates = [
  fontDir ? join(fontDir, 'Inter-Regular.ttf') : null,
  fontDir ? join(fontDir, 'Arial.ttf') : null,
  join(import.meta.dirname, '..', 'public', 'fonts', 'Inter-Regular.ttf'),
  join(import.meta.dirname, '..', 'assets', 'fonts', 'Inter-Regular.ttf'),
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
  'C:\\Windows\\Fonts\\calibri.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
].filter(Boolean);
const boldCandidates = [
  fontDir ? join(fontDir, 'Inter-Bold.ttf') : null,
  fontDir ? join(fontDir, 'Arial-Bold.ttf') : null,
  join(import.meta.dirname, '..', 'public', 'fonts', 'Inter-Bold.ttf'),
  join(import.meta.dirname, '..', 'assets', 'fonts', 'Inter-Bold.ttf'),
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\segoeuib.ttf',
  'C:\\Windows\\Fonts\\calibrib.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
].filter(Boolean);

for (const file of files) {
  const slug = basename(file, '.md');
  const outPath = join(OUT_DIR, `${slug}.png`);

  if (existsSync(outPath)) {
    console.log(`  skip ${slug} (exists)`);
    skipped++;
    continue;
  }

  pendingFiles.push({ file, slug, outPath });
}

if (pendingFiles.length === 0) {
  console.log(`\nOG images: ${generated} generated, ${skipped} skipped`);
  process.exit(0);
}

const regularFont = loadFont('regular', 'WM_OG_FONT_REGULAR', regularCandidates);
const boldFont = loadFont('bold', 'WM_OG_FONT_BOLD', boldCandidates);

if (!regularFont || !boldFont) {
  const missing = [
    !regularFont ? 'regular' : null,
    !boldFont ? 'bold' : null,
  ].filter(Boolean).join(' and ');
  const message =
    `Unable to find a local ${missing} font for OG generation. ` +
    'Skipping OG image generation for this build. ' +
    'Set WM_OG_FONT_REGULAR and WM_OG_FONT_BOLD to .ttf/.otf paths to enable it.';

  if (isTruthy(process.env.WM_STRICT_OG_FONTS)) {
    throw new Error(message);
  }

  console.warn(`[og] ${message}`);
  process.exit(0);
}

console.log(`[og] using fonts: ${regularFont.path} | ${boldFont.path}`);

for (const { file, slug, outPath } of pendingFiles) {
  const raw = readFileSync(join(BLOG_DIR, file), 'utf-8');
  const { data } = matter(raw);
  const title = data.title || slug;
  const audience = data.audience || '';

  const titleChildren = [];
  if (audience) {
    titleChildren.push(
      h('div', {
        fontSize: 14,
        color: '#4ade80',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 2,
      }, audience)
    );
  }
  titleChildren.push(
    h('div', {
      fontSize: title.length > 60 ? 36 : 44,
      fontWeight: 700,
      lineHeight: 1.2,
      color: '#ffffff',
    }, title)
  );

  const element = h('div', {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '60px 72px',
    backgroundColor: '#050505',
    fontFamily: FONT_NAME,
    color: '#ffffff',
  }, [
    h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
      h('div', {
        width: 48,
        height: 48,
        borderRadius: 10,
        backgroundColor: '#4ade80',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        fontWeight: 700,
        color: '#050505',
      }, 'WM'),
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('span', { fontSize: 16, fontWeight: 700, letterSpacing: 3, color: '#e5e5e5' }, 'WORLD MONITOR'),
        h('span', { fontSize: 12, color: '#666666', letterSpacing: 1 }, 'BLOG'),
      ]),
    ]),
    h('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      flex: 1,
      justifyContent: 'center',
    }, titleChildren),
    h('div', {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: '1px solid #222222',
      paddingTop: 24,
    }, [
      h('span', { fontSize: 14, color: '#666666' }, 'worldmonitor.app/blog'),
      h('div', { display: 'flex', alignItems: 'center', gap: 8 }, [
        h('div', { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80' }, ''),
        h('span', { fontSize: 14, color: '#4ade80' }, 'Real-time Global Intelligence'),
      ]),
    ]),
  ]);

  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: FONT_NAME, data: regularFont.data, weight: 400, style: 'normal' },
      { name: FONT_NAME, data: boldFont.data, weight: 700, style: 'normal' },
    ],
  });

  const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
  writeFileSync(outPath, png);
  console.log(`  gen  ${slug}.png`);
  generated++;
}

console.log(`\nOG images: ${generated} generated, ${skipped} skipped`);
