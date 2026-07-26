// Regras de lint do projeto.
//
// A lista e curta de proposito: so entra regra que pega erro de verdade ou que
// mantem o codigo parecido consigo mesmo. Estilo que o leitor nao percebe nao
// vira regra.

const NODE_GLOBALS = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  fetch: 'readonly',
  EventSource: 'readonly',
  Element: 'readonly',
  Event: 'readonly',
  WheelEvent: 'readonly',
  PointerEvent: 'readonly',
  MouseEvent: 'readonly',
  Document: 'readonly',
  HTMLElement: 'readonly',
  HTMLIFrameElement: 'readonly',
  HTMLButtonElement: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

const SHARED_RULES = {
  // Erros de verdade.
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-implicit-coercion': 'error',
  eqeqeq: ['error', 'always'],

  // Deixa a intencao explicita.
  'prefer-const': 'error',
  'no-var': 'error',
  'object-shorthand': 'error',
  'prefer-template': 'error',

  // O board e o servidor sao pequenos: funcao gigante aqui e sinal de que falta
  // um modulo, nao de que o problema e complicado.
  'max-lines-per-function': ['warn', { max: 80, skipComments: true, skipBlankLines: true }],
  // Folgado o bastante para uma cadeia de despacho (rota, atalho de teclado),
  // apertado o bastante para pegar funcao que virou duas.
  complexity: ['warn', 15],
};

export default [
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['bin/**/*.js', 'src/server/**/*.js', 'src/cli.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    rules: SHARED_RULES,
  },
  {
    files: ['src/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
    },
    rules: SHARED_RULES,
  },
];
