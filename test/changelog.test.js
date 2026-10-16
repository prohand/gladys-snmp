import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-snmp';

test('the first release moves Unreleased under the version', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- SNMP agents.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const rolled = rollChangelog(text, '1.0.1', '2026-10-14');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-10-14\n\n### Added\n\n- SNMP agents\./,
  );
  assert.match(rolled, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.1\\.\\.\\.HEAD`));
  assert.match(rolled, new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/releases/tag/v1\\.0\\.1`));
});

test('the intro quoting the heading inline is left alone', () => {
  const intro = 'Describe each change under `## [Unreleased]` as you make it.';
  const text = `# Changelog\n\n${intro}\n\n## [Unreleased]\n\n- Scan.\n\n[Unreleased]: ${REPO}/compare/v1.0.1...HEAD\n`;
  const rolled = rollChangelog(text, '1.1.0', '2026-11-01');
  assert.ok(rolled.includes(`${intro}\n\n## [Unreleased]\n\n## [1.1.0] - 2026-11-01\n\n- Scan.\n`));
});

test('a release without changes still names its version', () => {
  const text = `## [Unreleased]\n\n[Unreleased]: ${REPO}/compare/v1.0.1...HEAD\n`;
  const rolled = rollChangelog(text, '1.0.2', '2026-11-01');
  assert.match(rolled, /## \[1\.0\.2\] - 2026-11-01\n\n- Maintenance release/);
  assert.match(
    rolled,
    new RegExp(`\\[1\\.0\\.2\\]: ${REPO}/compare/v1\\.0\\.1\\.\\.\\.v1\\.0\\.2`),
  );
});

test('the CHANGELOG.md of the repository can be rolled', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.notEqual(rollChangelog(text, '9.9.9', '2026-01-01'), text);
});
