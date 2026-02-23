module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'ci', 'perf', 'style', 'build'
    ]],
    'subject-case': [0],
    'header-max-length': [1, 'always', 120],
    'body-max-line-length': [0],
  },
};
