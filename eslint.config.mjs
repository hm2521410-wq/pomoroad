// 開発用：npx eslint で明らかな間違い（未定義の変数・使っていない変数など）を見つける
export default [
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly', indexedDB: 'readonly', navigator: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', addEventListener: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', devicePixelRatio: 'readonly',
        matchMedia: 'readonly', AudioContext: 'readonly', Worker: 'readonly', self: 'readonly', URL: 'readonly', Blob: 'readonly', Node: 'readonly',
        SVGElement: 'readonly', Element: 'readonly', Notification: 'readonly', SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly',
        structuredClone: 'readonly', fetch: 'readonly', console: 'readonly', performance: 'readonly', process: 'readonly', Buffer: 'readonly', crypto: 'readonly',
      },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }], 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-const-assign': 'error' },
  },
  {
    files: ['electron/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { require: 'readonly', __dirname: 'readonly', process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', Response: 'readonly', setInterval: 'readonly', URLSearchParams: 'readonly', AbortController: 'readonly', TextDecoder: 'readonly' } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }] },
  },
];
