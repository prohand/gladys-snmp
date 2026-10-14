// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { ACTION_KEYS, createActions } from '../src/actions.js';
import { AgentMonitor } from '../src/agents/monitor.js';
import {
  SCENE_ACTION_KEYS,
  SCENE_TRIGGER_KEYS,
  SceneEvents,
  createSceneActions,
} from '../src/capabilities/scenes.js';
import { createWidgets } from '../src/capabilities/widget.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const monitor = new AgentMonitor();
const actions = createActions(monitor);
const sceneActions = createSceneActions(monitor);
const widgets = createWidgets(monitor);

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(actions).sort());
  assert.deepEqual(ACTION_KEYS.sort(), Object.keys(actions).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(sceneActions).sort());
  assert.deepEqual(SCENE_ACTION_KEYS.sort(), Object.keys(sceneActions).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(widgets).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('scene events only carry the keys their trigger declares', async () => {
  // The core drops the undeclared keys: a variable the scene author cannot
  // read is a bug, found here rather than in a scene.
  const gladys = createFakeGladys();
  const events = new SceneEvents();
  const [agent] = normalizeConfig({ agents: '10.0.0.1;Router' }).snmpAgents;
  await events.agentUnreachable(gladys, agent, { error: 'no answer (timeout)' });
  await events.agentRecovered(gladys, agent, { since: 0, lastRead: 120000 });
  await events.interfaceChanged(gladys, agent, 'eth0', false);
  assert.equal(gladys.fake.sceneEvents.length, 3);
  for (const event of gladys.fake.sceneEvents) {
    const trigger = manifest.scene_triggers.find((entry) => entry.key === event.key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    assert.deepEqual(
      Object.keys(event.data).filter((key) => !declared.includes(key)),
      [],
      `${event.key}: undeclared keys`,
    );
  }
});

test('scene action outputs are the declared ones', async () => {
  const gladys = createFakeGladys();
  const config = normalizeConfig();
  for (const declaration of manifest.scene_actions) {
    const outputs = await sceneActions[declaration.key](gladys, {
      fields: { device: 'ext:unknown', oid: '1.3.6.1.2.1.1.5.0', value: '1' },
      config,
    });
    assert.deepEqual(
      Object.keys(outputs).sort(),
      keysOf(declaration.outputs).sort(),
      declaration.key,
    );
  }
});

test('categories, scene and widget fields require a recent enough Gladys', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]), 'categories requires >= 4.86.0');
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), 'scenes and widgets require >= 5.1.0');
});

test('SNMP is a local protocol: the manifest declares the local transport only', () => {
  assert.deepEqual(manifest.transports, ['local']);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `"${field.key}" is missing from DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of allFields.filter((field) => field.type === 'section')) {
    assert.equal(section.required, undefined, `section "${section.key}": required`);
    assert.equal(section.default, undefined, `section "${section.key}": default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}": placeholder`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('every manifest text exists in English, French, German and Spanish', () => {
  const missing = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (typeof node.en === 'string') {
      for (const language of LANGUAGES) {
        if (typeof node[language] !== 'string' || node[language].length === 0) {
          missing.push(`${path}.${language}`);
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, `${path}.${key}`);
    }
  };
  visit(manifest, 'manifest');
  assert.deepEqual(missing, []);
});

test('labels, descriptions and placeholders are multi-language objects', () => {
  for (const field of allFields) {
    for (const key of ['label', 'description', 'placeholder']) {
      if (field[key] !== undefined) {
        assert.equal(typeof field[key], 'object', `field "${field.key}": ${key}`);
      }
    }
  }
});
