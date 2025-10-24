import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read the CSS file
const css = readFileSync(resolve('src/style.css'), 'utf-8');

// Create a JS module that exports the CSS as a string (no auto-injection)
const cssJsContent = `// Auto-generated - do not edit
const css = ${JSON.stringify(css)};

export default css;
export { css };
`;

// Write style.css.js to dist (so it can be imported like style.css.js)
writeFileSync(resolve('dist/style.css.js'), cssJsContent);

// Also copy the CSS file for users who want to import it manually
copyFileSync(resolve('src/style.css'), resolve('dist/style.css'));
console.log('✓ CSS inlined to dist/style.css.js and copied to dist/style.css');

// Rewrite Container.js to import from style.css.js instead of style.css?raw
const containerPath = resolve('dist/custom-components/Container.js');
let containerContent = readFileSync(containerPath, 'utf-8');
containerContent = containerContent.replace(
  /from ['"]\.\.\/style\.css\?raw['"]/g,
  'from "../style.css.js"'
);
writeFileSync(containerPath, containerContent);
console.log('✓ Rewritten Container.js to use style.css.js');

// Copy jsx.d.ts to dist/react for TypeScript JSX augmentation
mkdirSync(resolve('dist/react'), { recursive: true });
copyFileSync(resolve('src/react/jsx.d.ts'), resolve('dist/react/jsx.d.ts'));
console.log('✓ Copied jsx.d.ts to dist/react');
