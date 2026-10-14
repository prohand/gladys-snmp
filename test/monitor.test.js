import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { buildDevice, idsFor } from '../src/agents/device.js';
import { AgentMonitor } from '../src/agents/monitor.js';
import { SceneEvents } from '../src/capabilities/scenes.js';
import { FakeAgent, counter64, sampleMib } from './helpers/fakeAgent.js';

const AGENTS = JSON.stringify([
  {
    id: 'nas',
    name: 'NAS',
    host: '192.168.1.10',
    profiles: ['host', 'ups'],
    interfaces: ['eth0', 'eth1', '7'],
    oids: [
      {
        oid: '1.3.6.1.4.1.9999.1.1.0',
        key: 'temp',
        name: 'Temperature',
        category: 'temperature-sensor',
        type: 'decimal',
        unit: 'celsius',
        scale: 0.1,
      },
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
]);

function setup() {
  let clock = 1_000_000;
  const fake = new FakeAgent(sampleMib());
  const gladys = createFakeGladys();
  const monitor = new AgentMonitor({
    clientFactory: fake.factory(),
    now: () => clock,
    sceneEvents: new SceneEvents(),
  });
  const config = normalizeConfig({ agents: AGENTS });
  const [agent] = config.snmpAgents;
  const ids = idsFor(gladys, agent);
  return {
    fake,
    gladys,
    monitor,
    config,
    agent,
    ids,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('the device is accepted by Gladys (categories, types, units, poll frequency)', async () => {
  const { gladys, agent } = setup();
  const device = buildDevice(gladys, agent);
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  for (const feature of device.features) {
    assert.equal(typeof feature.min, 'number', `${feature.external_id}: min`);
    assert.equal(typeof feature.max, 'number', `${feature.external_id}: max`);
  }
  const keys = device.features.map((feature) => feature.external_id.split(':').pop());
  assert.deepEqual(new Set(keys).size, keys.length, 'feature keys are unique');
});

test('a poll publishes system, interfaces, host, ups and custom values', async () => {
  const { gladys, monitor, config, agent, ids } = setup();
  const state = await monitor.poll(gladys, agent, config);

  assert.equal(state.reachable, true);
  assert.equal(state.sysName, 'nas');
  const last = (key) => gladys.fake.lastState(ids.feature(key));
  assert.equal(last('reachable'), 1);
  assert.equal(last('uptime'), 3);
  assert.equal(last('if-eth0-status'), 1);
  assert.equal(last('if-eth1-status'), 0);
  assert.equal(last('cpu-load'), 20);
  assert.equal(last('memory-used'), 50);
  assert.equal(last('disk-used'), 80, 'the fullest disk');
  assert.equal(last('ups-charge'), 95);
  assert.equal(last('ups-runtime'), 42);
  assert.equal(last('ups-battery-low'), 0);
  assert.equal(last('ups-on-mains'), 1);
  assert.equal(last('oid-temp'), 41.5, 'scaled');
  assert.equal(last('oid-outlet'), 1, 'mapped on/off');
  // No rate on the first reading, and no interface 7 on this agent.
  assert.equal(last('if-eth0-in'), undefined);
  assert.equal(state.interfaces.get('7').index, 7);
});

test('the second poll gives the interface rates from the 64-bit counters', async () => {
  const { fake, gladys, monitor, config, agent, ids, advance } = setup();
  await monitor.poll(gladys, agent, config);
  advance(60_000);
  fake.setMib('1.3.6.1.2.1.31.1.1.1.6.2', counter64(1_000_000 + 750_000));
  fake.setMib('1.3.6.1.2.1.31.1.1.1.10.2', counter64(2_000_000 + 7_500_000));
  await monitor.poll(gladys, agent, config);
  assert.equal(gladys.fake.lastState(ids.feature('if-eth0-in')), 100);
  assert.equal(gladys.fake.lastState(ids.feature('if-eth0-out')), 1000);
});

test('an agent that stops answering: reachable 0, badge, one trigger, then recovery', async () => {
  const { fake, gladys, monitor, config, agent, ids, advance } = setup();
  await monitor.poll(gladys, agent, config);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: ids.device,
    transport: 'local',
  });

  fake.down = true;
  advance(60_000);
  await monitor.poll(gladys, agent, config);
  advance(60_000);
  await monitor.poll(gladys, agent, config);
  assert.equal(gladys.fake.lastState(ids.feature('reachable')), 0);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  const lost = gladys.fake.sceneEvents.filter((event) => event.key === 'agent_unreachable');
  assert.equal(lost.length, 1, 'one event per transition, not one per poll');
  assert.equal(lost[0].data.device, ids.device);
  assert.match(lost[0].data.error, /timeout/);

  fake.down = false;
  advance(60_000);
  await monitor.poll(gladys, agent, config);
  const back = gladys.fake.sceneEvents.filter((event) => event.key === 'agent_recovered');
  assert.equal(back.length, 1);
  assert.equal(back[0].data.downtime_minutes, 2);
  assert.equal(gladys.fake.lastState(ids.feature('reachable')), 1);
});

test('an agent down at startup fires no trigger', async () => {
  const { fake, gladys, monitor, config, agent } = setup();
  fake.down = true;
  await monitor.poll(gladys, agent, config);
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('an interface that goes down fires interface_changed', async () => {
  const { fake, gladys, monitor, config, agent, advance } = setup();
  await monitor.poll(gladys, agent, config);
  fake.setMib('1.3.6.1.2.1.2.2.1.8.2', 2);
  advance(60_000);
  await monitor.poll(gladys, agent, config);
  const events = gladys.fake.sceneEvents.filter((event) => event.key === 'interface_changed');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.interface, 'eth0');
  assert.equal(events[0].data.status, 'down');
});

test('the refresh interval is applied by skipping polls', async () => {
  const { gladys, monitor, agent, advance } = setup();
  const config = normalizeConfig({ agents: AGENTS, poll_frequency: 300 });
  assert.equal(monitor.isDue(agent, config), true);
  await monitor.poll(gladys, agent, config);
  advance(60_000);
  assert.equal(monitor.isDue(agent, config), false);
  advance(230_000);
  assert.equal(monitor.isDue(agent, config), true, 'due within the tolerance');
});

test('a writable OID is written with the on/off values and confirmed', async () => {
  const { fake, gladys, monitor, config, agent, ids } = setup();
  const outlet = agent.oids.find((oid) => oid.key === 'outlet');
  await monitor.setValue(gladys, agent, outlet, 0, config);
  assert.equal(fake.sets.at(-1).value, 2);
  assert.equal(gladys.fake.lastState(ids.feature('oid-outlet')), 0);
  const temp = agent.oids.find((oid) => oid.key === 'temp');
  await assert.rejects(monitor.setValue(gladys, agent, temp, 1, config), /read-only/);
});

test('concurrent polls of one agent share one read', async () => {
  const { fake, gladys, monitor, config, agent } = setup();
  await Promise.all([monitor.poll(gladys, agent, config), monitor.poll(gladys, agent, config)]);
  const systemGets = fake.requests.filter(
    (request) => request.type === 'get' && request.oids.includes('1.3.6.1.2.1.1.3.0'),
  );
  assert.equal(systemGets.length, 1);
});
