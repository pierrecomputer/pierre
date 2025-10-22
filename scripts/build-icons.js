#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { optimize } from 'svgo';
import { fileURLToPath } from 'url';

import { svgoConfig } from '../svgo.config.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/**
 * Process a single SVG file with SVGO
 */
async function processSvg(filePath) {
  const svgContent = await readFile(filePath, 'utf-8');
  const result = optimize(svgContent, svgoConfig);

  if (result.error) {
    throw new Error(`SVGO error: ${result.error}`);
  }

  return result.data;
}

/**
 * Main function to process all SVGs
 */
async function buildIcons() {
  console.log(`${colors.cyan}➜ Processing SVG icons with SVGO…${colors.reset}`);

  const sourceDir = join(projectRoot, 'svgs');

  try {
    await stat(sourceDir);
  } catch (error) {
    console.error(
      `${colors.red}× Error:${colors.reset} Source directory not found: ${sourceDir}`
    );
    console.log(
      `${colors.dim}Create the ./svgs directory and add your SVG files there.${colors.reset}`
    );
    process.exit(1);
  }

  const files = await readdir(sourceDir);
  const svgFiles = files.filter(
    (file) => extname(file).toLowerCase() === '.svg'
  );

  if (svgFiles.length === 0) {
    console.error(
      `${colors.red}× Error:${colors.reset} No SVG files found in ${sourceDir}`
    );
    process.exit(1);
  }

  console.log(
    `${colors.blue}➜ Processing ${colors.bright}${svgFiles.length}${colors.reset}${colors.blue} SVG files:${colors.reset}`
  );

  const processedFiles = [];
  const errors = [];

  for (const file of svgFiles) {
    const filePath = join(sourceDir, file);

    try {
      const optimizedSvg = await processSvg(filePath);
      await writeFile(filePath, optimizedSvg, 'utf-8');
      processedFiles.push(file);
      console.log(`${colors.dim}  ✔ ${file}${colors.reset}`);
    } catch (error) {
      errors.push({ file, error: error.message });
      console.log(`${colors.red}  × ${file}${colors.reset}`);
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

  console.log(
    `${colors.green}↪ Successfully processed ${colors.bright}${processedFiles.length}${colors.reset}${colors.green} SVG files${colors.reset}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildIcons().catch((error) => {
    console.error(`${colors.red}× Build failed:${colors.reset}`, error.message);
    process.exit(1);
  });
}

export { buildIcons };
