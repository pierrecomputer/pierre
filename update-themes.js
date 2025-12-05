#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// # IMPORTANT #
// THIS SCRIPT IS ONLY USED ON MDO'S LAPTOP
console.warn(
  "This script is only used on @mdo's laptop. If you are not @mdo, you might not like the results."
);

// import { fileURLToPath } from 'url';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// Source theme files
const sourceDir = '/Users/mdo/work/pierre/pierre-vscode-theme/themes';

// Target directories
const targetDirs = [
  '/Users/mdo/work/pierre/pierrejs/packages/diffs/src/themes',
  '/Users/mdo/work/pierre/pierrejs/apps/docs/themes',
];

// Theme files to copy
const themeFiles = ['pierre-dark.json', 'pierre-light.json'];

function updateThemeName(content) {
  try {
    const theme = JSON.parse(content);

    // Convert name to lowercase and replace spaces with dashes
    if (theme.name) {
      theme.name = theme.name.toLowerCase().replace(/\s+/g, '-');
    }

    return JSON.stringify(theme, null, 2);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return content;
  }
}

function copyAndUpdateTheme(sourceFile, targetDir) {
  const sourcePath = path.join(sourceDir, sourceFile);
  const targetPath = path.join(targetDir, sourceFile);

  try {
    // Read source file
    const content = fs.readFileSync(sourcePath, 'utf8');

    // Update the name field
    const updatedContent = updateThemeName(content);

    // Write to target location
    fs.writeFileSync(targetPath, updatedContent, 'utf8');

    console.log(`✅ Copied and updated ${sourceFile} to ${targetDir}`);
  } catch (error) {
    console.error(
      `❌ Error copying ${sourceFile} to ${targetDir}:`,
      error.message
    );
  }
}

function main() {
  console.log('🎨 Updating theme files...\n');

  // Check if source directory exists
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  // Process each theme file
  themeFiles.forEach((themeFile) => {
    console.log(`📁 Processing ${themeFile}...`);

    // Copy to each target directory
    targetDirs.forEach((targetDir) => {
      // Ensure target directory exists
      if (!fs.existsSync(targetDir)) {
        console.log(`📁 Creating directory: ${targetDir}`);
        fs.mkdirSync(targetDir, { recursive: true });
      }

      copyAndUpdateTheme(themeFile, targetDir);
    });

    console.log('');
  });

  console.log('🎉 Theme update complete!');
}

// Run the script
main();
