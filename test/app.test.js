// The whole integration, against the fake Gladys of the SDK and a fake agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { LANGUAGES } from '../src/i18n.js';
import { FakeAgent, sampleMib } from './helpers/fakeAgent.js';

const AGENTS = JSON.stringify([
  {
    id: 'nas',
    name: 'NAS',
    host: '192.168.1.10',
    profiles: ['host', 'ups'],
    interfaces: ['eth0'],
    oids: [
      {
        oid: '1.3.6.1.4.1.9999.2.1.0',
        key: 'outlet',
        name: 'Outlet',
        writable: true,
        on: 1,
        off: 2,
      },
    ],
  },
  { id: 'printer', name: 'Printer', host: '192.168.1.30' },
]);

async function start(config = { agents: AGENTS }) {
  const fake = new FakeAgent(sampleMib());
  const gladys = createFakeGladys({ config });
  const { monitor, getConfig } = registerHandlers(gladys, { clientFactory: fake.factory() });
  await gladys.connect();
  await monitor.pollAll(gladys, getConfig());
  const nas = gladys.fake.discoveredDevices.find((device) => device.name === 'NAS');
  return { fake, gladys, monitor, getConfig, nas };
}

test('connecting publishes one device per agent and says the connection is up', async () => {
  const { gladys } = await start();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['NAS', 'Printer'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('no agent: the connection status says what to do', async () => {
  const { gladys } = await start({});
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No SNMP agent/);
});

test('a mistake in the agent list shows in the connection status', async () => {
  const { gladys } = await start({ agents: '[{"name":"no host"}]' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Liste des agents/);
});

test('Gladys polls a device: its values are published', async () => {
  const { gladys, nas } = await start();
  assert.deepEqual(await gladys.fake.poll(nas), { success: true });
  assert.equal(gladys.fake.lastState(`${nas.external_id}:reachable`), 1);
});

test('switching a writable OID from Gladys sends an SNMP SET', async () => {
  const { fake, gladys, nas } = await start();
  const outlet = nas.features.find((feature) => feature.external_id.endsWith(':oid-outlet'));
  assert.equal((await gladys.fake.setValue(nas, outlet, 0)).success, true);
  assert.equal(fake.sets.at(-1).value, 2);
  const reachable = nas.features.find((feature) => feature.external_id.endsWith(':reachable'));
  assert.equal((await gladys.fake.setValue(nas, reachable, 1)).success, false);
});

test('"Test the connection" reports every agent, in four languages', async () => {
  const { gladys } = await start();
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.deepEqual(Object.keys(ack.data.message).sort(), [...LANGUAGES].sort());
  assert.match(ack.data.message.en, /2 of 2 agents answered/);
  assert.match(ack.data.message.fr, /NAS \(192\.168\.1\.10\) — \d+ ms — nas/);
});

test('"List the interfaces" and "Walk an OID"', async () => {
  const { gladys, nas } = await start();
  const interfaces = await gladys.fake.action('list_interfaces', { device: nas.external_id });
  assert.match(interfaces.data.message.en, /▲ 2 — eth0/);
  assert.match(interfaces.data.message.en, /▽ 3 — eth1/);
  const walk = await gladys.fake.action('walk_oid', {
    device: nas.external_id,
    oid: '1.3.6.1.2.1.1',
    limit: 2,
  });
  assert.equal(walk.data.message.split('\n').length, 2);
  assert.match(walk.data.message, /1\.3\.6\.1\.2\.1\.1\.1\.0 = Linux nas/);
});

test('scene actions: get, set and poll answer with their outputs, never throw', async () => {
  const { fake, gladys, nas } = await start();
  const get = await gladys.fake.sceneAction('snmp_get', {
    device: nas.external_id,
    oid: '1.3.6.1.2.1.33.1.2.4.0',
  });
  assert.deepEqual(get.data.outputs, { success: true, value: '95', number: 95, error: '' });

  const set = await gladys.fake.sceneAction('snmp_set', {
    device: nas.external_id,
    oid: '1.3.6.1.2.1.1.5.0',
    value_type: 'string',
    value: 'nas-2',
  });
  assert.deepEqual(set.data.outputs, { success: true, error: '' });
  assert.equal(fake.sets.at(-1).value, 'nas-2');

  const bad = await gladys.fake.sceneAction('snmp_get', {
    device: nas.external_id,
    oid: 'sysName',
  });
  assert.equal(bad.data.outputs.success, false);

  fake.down = true;
  const poll = await gladys.fake.sceneAction('poll_agent', { device: nas.external_id });
  assert.deepEqual(poll.data.outputs, { reachable: false, response_time: null });
});

test('the widget content is valid, overview and detail', async () => {
  const { gladys, nas } = await start();
  for (const settings of [{}, { device: nas.external_id }]) {
    const ack = await gladys.fake.widgetGet('agents', {
      settings,
      language: 'fr',
      units: 'metric',
    });
    assert.equal(ack.success, true);
    assert.deepEqual(validateWidgetContent(ack.data.content), []);
  }
  const detail = await gladys.fake.widgetGet('agents', {
    settings: { device: nas.external_id },
    language: 'en',
  });
  const bound = detail.data.content.components.filter((c) => c.device_feature);
  assert.ok(bound.length >= 4, 'live tiles of the chosen agent');
  for (const tile of bound) {
    assert.ok(
      nas.features.some((feature) => feature.external_id === tile.device_feature),
      `${tile.device_feature} is a feature of the device`,
    );
  }
});

test('the widget without agents is valid too', async () => {
  const { gladys } = await start({});
  const ack = await gladys.fake.widgetGet('agents', { settings: {}, language: 'en' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
});

test('the "Poll now" widget button polls every agent', async () => {
  const { fake, gladys } = await start();
  fake.down = true;
  const ack = await gladys.fake.widgetAction('agents', 'poll_now', {}, { settings: {} });
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /0\/2 agents answered/);
});

test('a new configuration re-publishes the devices', async () => {
  const { gladys } = await start();
  await gladys.fake.configUpdated({ agents: '10.0.0.1;Router' });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Router'],
  );
});
