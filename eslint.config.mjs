import { defineConfig, globalIgnores } from 'eslint/config';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import js from '@eslint/js';
import nodePlugin from 'eslint-plugin-n';
import jestPlugin from 'eslint-plugin-jest';

export default defineConfig([
  {
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      prettier,
      '@typescript-eslint': typescriptEslint,
      node: nodePlugin,
      jest: jestPlugin,
    },
    rules: {
      // Include rules from js.configs.recommended
      ...js.configs.recommended.rules,
      // Include rules from @typescript-eslint/recommended
      ...typescriptEslint.configs.recommended.rules,
      // Our custom rules
      'prettier/prettier': [
        'error',
        {
          arrowParens: 'always',
          bracketSpacing: true,
          jsxBracketSameLine: false,
          printWidth: 100,
          proseWrap: 'preserve',
          requirePragma: false,
          semi: true,
          singleQuote: true,
          tabWidth: 2,
          trailingComma: 'all',
          useTabs: false,
          endOfLine: 'crlf', // Add this line
        },
        {
          usePrettierrc: false,
        },
      ],
      quotes: [
        1,
        'single',
        {
          allowTemplateLiterals: true,
          avoidEscape: true,
        },
      ],
      'import/no-cycle': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/default': 'off',
      'import/no-unresolved': 'off',
      'operator-linebreak': 'off',
      'no-param-reassign': 'off',
      'implicit-arrow-linebreak': 'off',
      'max-len': 'off',
      indent: 'off',
      'no-shadow': 'off',
      'arrow-parens': 'off',
      'no-confusing-arrow': 'off',
      'no-use-before-define': 'off',
      'object-curly-newline': 'off',
      'function-paren-newline': 'off',
      'import/prefer-default-export': 'off',
      'max-classes-per-file': 'off',
      'react/jsx-filename-extension': 'off',
      'import/extensions': 'off',
      '@typescript-eslint/ban-ts-ignore': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      'no-useless-constructor': 'off',
      '@typescript-eslint/no-useless-constructor': 'error',
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
  },
  // Specific test configuration
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js'],
    rules: {
      'prettier/prettier': 'off',
    },
  },
  globalIgnores(['**/node_modules', '**/build']),
]);
