#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { optimize } from 'svgo';
import { fileURLToPath } from 'url';

import { spriteConfig } from '../sprite.config.js';
import { SVGOConfig } from '../svgo.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

function getIconsSourceDir() {
  return join(projectRoot, 'node_modules', '@pierre', 'icons', 'svg');
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Process a single SVG file with SVGO and extract viewBox and content
 */
async function processSvg(filePath) {
  const svgContent = await readFile(filePath, 'utf-8');
  const result = optimize(svgContent, SVGOConfig);

  if (result.error) {
    throw new Error(`SVGO error: ${result.error}`);
  }

  const viewBoxMatch = result.data.match(/viewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 16 16';

  const contentMatch = result.data.match(/<svg[^>]*>(.*?)<\/svg>/s);
  const content = contentMatch ? contentMatch[1].trim() : '';

  return { viewBox, content };
}

/**
 * Convert IconName to kebab-case for symbol IDs
 */
function iconNameToKebabCase(iconName) {
  return iconName
    .replace(/^Icon/, '')
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
}

/**
 * Generate the TypeScript sprite string
 */
function generateSpriteString(symbols) {
  const symbolsHtml = symbols
    .map(
      (symbol) =>
        `  <symbol id="${symbol.id}" viewBox="${symbol.viewBox}">
${symbol.content
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
  </symbol>`
    )
    .join('\n');

  return `export type SVGSpriteNames = ${symbols.map(({ id }) => `'${id}'`).join('|')};

export const SVGSpriteSheet = \`<svg data-icon-sprite aria-hidden="true" width="0" height="0">
${symbolsHtml}
</svg>\`;`;
}

/**
 * Main function to build the sprite
 */
async function buildSprite() {
  console.log(`${colors.cyan}➜ Building SVG sprite…${colors.reset}`);

  const sourceDir = getIconsSourceDir();
  const outputFile = join(projectRoot, spriteConfig.output.file);

  try {
    await stat(sourceDir);
  } catch (error) {
    console.error(error);
    console.error(
      `${colors.red}×Error:${colors.reset} Source directory not found: ${sourceDir}`
    );
    console.log(
      `${colors.dim}Ensure @pierre/icons is installed and exposes a svg/ directory.${colors.reset}`
    );
    process.exit(1);
  }

  const files = await readdir(sourceDir);
  const allSvgFiles = files.filter(
    (file) => extname(file).toLowerCase() === spriteConfig.source.extension
  );

  const foundFiles = [];
  const missingFiles = [];

  for (const iconName of spriteConfig.icons) {
    const fileName = `${iconName}.svg`;
    if (allSvgFiles.includes(fileName)) {
      foundFiles.push(fileName);
    } else {
      missingFiles.push(iconName);
    }
  }

  if (foundFiles.length === 0) {
    console.error(
      `${colors.red}× Error:${colors.reset} No matching SVG files found.`
    );
    console.log(
      `${colors.dim}Ensure @pierre/icons svg/ has SVG files matching the icon names in sprite.config.js${colors.reset}`
    );
    process.exit(1);
  }

  console.log(
    `${colors.blue}➜ Processing ${colors.bright}${foundFiles.length}${colors.reset}${colors.blue} of ${colors.bright}${spriteConfig.icons.length}${colors.reset}${colors.blue} requested SVG files:${colors.reset}`
  );

  foundFiles.forEach((file) =>
    console.log(`${colors.dim}  ✔ ${file}${colors.reset}`)
  );

  if (missingFiles.length > 0) {
    missingFiles.forEach((iconName) =>
      console.log(`${colors.red}  × ${iconName}.svg${colors.reset}`)
    );
  }

  const symbols = [];
  const errors = [];

  for (const file of foundFiles) {
    const filePath = join(sourceDir, file);
    const iconName = basename(file, spriteConfig.source.extension);

    try {
      const { viewBox, content } = await processSvg(filePath);

      symbols.push({
        id: `${spriteConfig.output.symbolPrefix}${iconNameToKebabCase(iconName)}`,
        viewBox,
        content,
      });
    } catch (error) {
      errors.push({ file, error: error.message });
    }
  }

  if (errors.length > 0) {
    console.error(
      `\n${colors.red}× Failed to process ${colors.bright}${errors.length}${colors.reset}${colors.red} files:${colors.reset}`
    );
    errors.forEach(({ file, error }) =>
      console.error(`${colors.dim}  - ${file}: ${error}${colors.reset}`)
    );
    process.exit(1);
  }

  symbols.sort((a, b) => a.id.localeCompare(b.id));

  const spriteContent = generateSpriteString(symbols);

  await writeFile(outputFile, spriteContent, 'utf-8');

  console.log(
    `${colors.green}↪ Sprite generated:${colors.reset} ${colors.bright}${spriteConfig.output.file}${colors.reset}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildSprite().catch((error) => {
    console.error(`${colors.red}× Build failed:${colors.reset}`, error.message);
    process.exit(1);
  });
}

export { buildSprite };
