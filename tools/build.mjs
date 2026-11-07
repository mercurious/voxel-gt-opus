// Bundles the game (three.js included) into a single self-contained
// dist/voxel-gt.html that runs from file:// with no server.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = out.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/voxel-gt.html'), html);
console.log(`dist/voxel-gt.html  ${(html.length / 1024).toFixed(0)} KB`);
