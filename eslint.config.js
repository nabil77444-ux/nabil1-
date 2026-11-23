import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'dev-dist/**/*',
      'node_modules/**/*',
      'functions/**/*',
      'public/**/*',
      'src/**/*',
      '*.ts',
      '*.tsx',
      '*.js',
      '*.mjs',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
