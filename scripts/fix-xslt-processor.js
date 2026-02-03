#!/usr/bin/env node
/**
 * Workaround for xslt-processor npm package publishing bug.
 *
 * The xslt-processor package has a misconfigured package.json that points to
 * dist/index.js but the actual files are published at the root level.
 *
 * This script creates symlinks to make the package work correctly.
 */

import { mkdirSync, symlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const xsltDir = join(__dirname, '..', 'node_modules', 'xslt-processor');
const distDir = join(xsltDir, 'dist');

// Skip if the package isn't installed
if (!existsSync(xsltDir)) {
  process.exit(0);
}

// Skip if dist already exists (properly published version)
if (existsSync(join(distDir, 'index.js')) && !existsSync(join(distDir, 'index.js'))) {
  process.exit(0);
}

try {
  // Create dist directory
  mkdirSync(distDir, { recursive: true });

  // Create symlinks for all needed files
  const files = ['index.js', 'index.mjs', 'index.d.ts', 'index.d.mts', 'index.js.map', 'index.mjs.map'];

  for (const file of files) {
    const target = join('..', file);
    const link = join(distDir, file);

    if (!existsSync(link)) {
      try {
        symlinkSync(target, link);
      } catch (err) {
        // Symlink might already exist or file doesn't exist in source
        if (err.code !== 'EEXIST') {
          // Ignore missing source files
        }
      }
    }
  }

  console.log('✓ Fixed xslt-processor package structure');
} catch (err) {
  // Non-fatal - tests might just need to be run differently
  console.warn('Warning: Could not fix xslt-processor package structure:', err.message);
}
