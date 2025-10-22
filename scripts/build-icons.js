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
 * Extract viewBox and path content from SVG
 */
function parseSvg(svgContent) {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 16 16';

  const contentMatch = svgContent.match(/<svg[^>]*>(.*?)<\/svg>/s);
  const content = contentMatch ? contentMatch[1].trim() : '';

  return { viewBox, content };
}

/**
 * Generate TypeScript component content
 */
function generateIconComponent(iconName, svgContent) {
  const { viewBox, content } = parseSvg(svgContent);

  // Calculate aspect ratio from viewBox
  let aspectRatio = 1; // Default to square if no viewBox found
  if (viewBox) {
    const viewBoxValues = viewBox.split(' ').map(Number);
    if (viewBoxValues.length >= 4) {
      const [, , viewBoxWidth, viewBoxHeight] = viewBoxValues;
      aspectRatio = viewBoxWidth / viewBoxHeight;
    }
  }

  return `// Generated \`bun run icons:build\`, see README for details
import { Colors, type IconProps } from '../Color';

export function ${iconName}({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * ${aspectRatio});

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width={width} height={height} fill={Colors[color] ?? color} style={style} className={\`pi\${className ? \` \${className}\` : ''}\`} {...props}>${content}</svg>
	);
}`;
}

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
    `${colors.cyan}➜ Processing SVG icons with SVGO and generating TypeScript components…${colors.reset}`
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
      // Process with SVGO
      const optimizedSvg = await processSvg(filePath);
      await writeFile(filePath, optimizedSvg, 'utf-8');
      processedFiles.push(file);

      // Generate TypeScript component
      const componentContent = generateIconComponent(iconName, optimizedSvg);
      const componentPath = join(componentsDir, `${iconName}.tsx`);
      await writeFile(componentPath, componentContent, 'utf-8');
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
