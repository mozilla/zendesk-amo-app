export default [
  {
    files: ['assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        localStorage: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        ZAFClient: 'readonly',
        AMOClient: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'semi': ['error', 'always'],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
];
