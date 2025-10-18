import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read the CSS file
const css = readFileSync(resolve('src/style.css'), 'utf-8');

// Create a JS module that exports the CSS as a string (no auto-injection)
const cssJsContent = `// Auto-generated - do not edit
const css = ${JSON.stringify(css)};

export default css;
export { css };
`;

// Write style.css.js to dist (so it can be imported like sprite.txt.js)
writeFileSync(resolve('dist/style.css.js'), cssJsContent);

// Also copy the CSS file for users who want to import it manually
copyFileSync(resolve('src/style.css'), resolve('dist/style.css'));

// Read the sprite file
const sprite = readFileSync(resolve('src/sprite.txt'), 'utf-8');

// Create a JS module that exports the sprite as default
const spriteJsContent = `// Auto-generated - do not edit
const sprite = ${JSON.stringify(sprite)};

export default sprite;
`;

// Write sprite.txt.js to dist
writeFileSync(resolve('dist/sprite.txt.js'), spriteJsContent);

// Rewrite the FileDiff.js import to use the generated sprite file
const fileDiffPath = resolve('dist/FileDiff.js');
let fileDiffContent = readFileSync(fileDiffPath, 'utf-8');
fileDiffContent = fileDiffContent.replace(
  /from ['"]\.\/sprite\.txt\?raw['"]/g,
  'from "./sprite.txt.js"'
);
writeFileSync(fileDiffPath, fileDiffContent);

// Rewrite Container.js to import from style.css.js instead of style.css?raw
const containerPath = resolve('dist/custom-components/Container.js');
let containerContent = readFileSync(containerPath, 'utf-8');
containerContent = containerContent.replace(
  /from ['"]\.\.\/style\.css\?raw['"]/g,
  'from "../style.css.js"'
);
writeFileSync(containerPath, containerContent);

// Remove the style.css import from index.js since Container handles it
const indexPath = resolve('dist/index.js');
let indexContent = readFileSync(indexPath, 'utf-8');
indexContent = indexContent.replace(/import ['"]\.\/style\.css['"];?\n?/g, '');
writeFileSync(indexPath, indexContent);

console.log('✓ CSS inlined to dist/style.css.js and copied to dist/style.css');
console.log('✓ Sprite inlined to dist/sprite.txt.js');
console.log('✓ Rewritten FileDiff.js to use sprite.txt.js');
console.log('✓ Rewritten Container.js to use style.css.js');
console.log('✓ Removed style.css import from index.js');
