const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n===========================================');
console.log('   Rebuilt Web Cloner — Environment Setup  ');
console.log('===========================================\n');

// 1. Validate Node Version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);

console.log(`[1/4] Checking Node.js environment: ${nodeVersion}`);
if (majorVersion < 18) {
  console.error(`❌ Error: Node.js 18 or higher is required. Found: ${nodeVersion}`);
  process.exit(1);
}
console.log('  ✓ Node.js version is compatible.');

// 2. Create Required Project Directories
console.log('[2/4] Ensuring local directories exist...');
const projectRoot = path.resolve(__dirname, '..');
const dirsToCreate = [
  path.join(projectRoot, 'data'),
  path.join(projectRoot, 'data', 'clones'),
  path.join(projectRoot, 'public'),
  path.join(projectRoot, 'public', 'css'),
  path.join(projectRoot, 'public', 'js'),
  path.join(projectRoot, 'src'),
  path.join(projectRoot, 'src', 'security'),
  path.join(projectRoot, 'src', 'renderer'),
  path.join(projectRoot, 'src', 'storage'),
  path.join(projectRoot, 'src', 'service'),
  path.join(projectRoot, 'src', 'routes')
];

for (const dir of dirsToCreate) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  ✓ Created directory: ${path.relative(projectRoot, dir)}`);
  } else {
    console.log(`  ✓ Directory exists: ${path.relative(projectRoot, dir)}`);
  }
}

// 3. Ensure Dependencies
console.log('[3/4] Checking npm dependencies...');
const nodeModulesPath = path.join(projectRoot, 'node_modules');
if (!fs.existsSync(nodeModulesPath) || !fs.existsSync(path.join(nodeModulesPath, 'playwright'))) {
  console.log('  Installing npm dependencies...');
  try {
    execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
    console.log('  ✓ Dependencies installed successfully.');
  } catch (err) {
    console.error('❌ Failed to install npm dependencies:', err.message);
    process.exit(1);
  }
} else {
  console.log('  ✓ Dependencies already installed.');
}

// 4. Install Playwright Chromium Browser Binaries
console.log('[4/4] Verifying Playwright Chromium browser...');
try {
  console.log('  Ensuring Chromium browser binary is present...');
  execSync('npx playwright install chromium', { cwd: projectRoot, stdio: 'inherit' });
  console.log('  ✓ Playwright Chromium browser verified.');
} catch (err) {
  console.error('❌ Failed to verify Playwright Chromium:', err.message);
  process.exit(1);
}

console.log('\n===========================================');
console.log('✓ Rebuilt setup completed successfully!');
console.log('Run "npm run dev" to launch the application.');
console.log('Run "npm test" to execute the test suite.');
console.log('===========================================\n');
