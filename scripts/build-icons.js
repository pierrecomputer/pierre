#!/usr/bin/env node
import { transform } from '@svgr/core';
import { readFile, readdir, stat, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

import { SVGOConfig } from '../svgo.config.js';
import template from './svgr-template.js';

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
 * Clean up existing generated files
 */
async function cleanupGeneratedFiles(componentsDir) {
  console.log(
    `${colors.blue}➜ Cleaning up existing generated files…${colors.reset}`
  );

  try {
    const existingFiles = await readdir(componentsDir);
    const generatedFiles = existingFiles.filter(
      (file) => file.endsWith('.tsx') && file !== 'index.ts'
    );

    if (generatedFiles.length > 0) {
      for (const file of generatedFiles) {
        const filePath = join(componentsDir, file);
        await import('fs/promises').then((fs) => fs.unlink(filePath));
      }
      console.log(
        `${colors.dim}  🗑️  Removed ${generatedFiles.length} existing components${colors.reset}`
      );
    } else {
      console.log(
        `${colors.dim}  ✓ No existing components to clean up${colors.reset}`
      );
    }
  } catch (error) {
    console.error(
      `${colors.red}  × Failed to clean up existing files: ${error.message}${colors.reset}`
    );
    throw error;
  }
}

/**
 * Main function to process all SVGs and generate TypeScript components
 */
async function buildIcons() {
  console.log(
    `${colors.cyan}➜ Processing SVG icons with SVGR and generating TypeScript components…${colors.reset}`
  );

  const sourceDir = join(projectRoot, 'svgs');
  const componentsDir = join(projectRoot, 'apps/docs/components/icons/icons');

  // Clean up existing generated files first
  await cleanupGeneratedFiles(componentsDir);

  try {
    await stat(sourceDir);
  } catch (error) {
    console.error(error);
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
  const generatedComponents = [];
  const errors = [];

  for (const file of svgFiles) {
    const filePath = join(sourceDir, file);
    const iconName = basename(file, '.svg');

    try {
      const svgContent = await readFile(filePath, 'utf-8');

      // Transform with SVGR
      const componentCode = await transform(
        svgContent,
        {
          typescript: true,
          icon: false,
          plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
          svgoConfig: SVGOConfig,
          template,
          jsxRuntime: 'automatic',
          // Replace className and add custom attributes
          replaceAttrValues: {},
          svgProps: {
            width: '{width}',
            height: '{height}',
            fill: '{Colors[color] ?? color}',
            style: '{style}',
            className: "{`pi${className != null ? ` ${className}` : ''}`}",
          },
        },
        { componentName: iconName }
      );

      // Write component file
      const componentPath = join(componentsDir, `${iconName}.tsx`);
      await writeFile(componentPath, componentCode, 'utf-8');

      processedFiles.push(file);
      generatedComponents.push(iconName);

      console.log(`${colors.dim}  ✔ ${file} → ${iconName}.tsx${colors.reset}`);
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

  // Generate index file
  try {
    let indexContent = '';
    for (const componentName of generatedComponents) {
      indexContent += `export { ${componentName} } from './${componentName}';\n`;
    }
    const indexPath = join(componentsDir, 'index.ts');
    await writeFile(indexPath, indexContent, 'utf-8');
    console.log(
      `${colors.dim}  ✔ Generated index.ts with ${generatedComponents.length} exports${colors.reset}`
    );
  } catch (error) {
    console.error(
      `${colors.red}  × Failed to generate index file: ${error.message}${colors.reset}`
    );
  }

  console.log(
    `${colors.green}↪ Successfully processed ${colors.bright}${processedFiles.length}${colors.reset}${colors.green} SVG files and generated ${colors.bright}${generatedComponents.length}${colors.reset}${colors.green} TypeScript components${colors.reset}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildIcons().catch((error) => {
    console.error(`${colors.red}× Build failed:${colors.reset}`, error.message);
    process.exit(1);
  });
}

export { buildIcons };
