// Flat config. Keep rules few and real; add more only when they catch actual bugs.
const tseslint = require('typescript-eslint');
module.exports = tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'dist-*/**', '.expo/**', 'eslint.config.js'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
