#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the project root (pierrejs directory)
const projectRoot = path.resolve(__dirname);

// Source theme files - assume pierre-vscode-theme is a sibling directory
const sourceDir = path.resolve(projectRoot, '../pierre-vscode-theme/themes');

// Target directories - relative to project root
const targetDirs = [
  path.resolve(projectRoot, 'packages/precision-diffs/src/themes'),
  path.resolve(projectRoot, 'apps/docs/themes'),
];

// Theme files to copy
const themeFiles = [
  'pierre-dark.json',
  'pierre-light.json',
  'pierre-dark-vibrant.json',
  'pierre-light-vibrant.json',
];

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

function validateDirectoryStructure() {
  console.log('🔍 Validating directory structure...\n');

  // Check if we're in the pierrejs directory by looking for package.json
  const packageJsonPath = path.resolve(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(
      `❌ Not in pierrejs directory. Expected package.json at: ${packageJsonPath}`
    );
    process.exit(1);
  }

  // Verify this is actually the pierrejs project by checking package.json name
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.name !== '@pierre/js') {
      console.error(
        `❌ This doesn't appear to be the pierrejs project. Found package name: ${packageJson.name}`
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error reading package.json: ${error.message}`);
    process.exit(1);
  }

  // Check if pierre-vscode-theme is a sibling directory
  const pierreVscodeThemeDir = path.resolve(
    projectRoot,
    '../pierre-vscode-theme'
  );
  if (!fs.existsSync(pierreVscodeThemeDir)) {
    console.error(
      `❌ pierre-vscode-theme directory not found at: ${pierreVscodeThemeDir}`
    );
    console.error(
      '   Expected pierrejs and pierre-vscode-theme to be sibling directories.'
    );
    process.exit(1);
  }

  // Check if source themes directory exists
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Source themes directory not found: ${sourceDir}`);
    process.exit(1);
  }

  console.log('✅ Directory structure validation passed\n');
}

function main() {
  console.log('🎨 Updating theme files...\n');

  // Validate directory structure first
  validateDirectoryStructure();

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
