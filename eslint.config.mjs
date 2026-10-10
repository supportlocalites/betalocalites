import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['build/**', '.react-router/**', '.wrangler/**', 'node_modules/**', 'docs/**', 'src/db/generated/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { files: ['scripts/**/*.mjs', 'src/lib/**/*.mjs', 'tests/**/*.mjs', '*.config.{ts,mjs}'], languageOptions: { globals: globals.node } },
);
