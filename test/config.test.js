import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COMMUNITY,
  DEFAULT_CONFIG,
  normalizeConfig,
  normalizeMac,
  parseAgents,
  sanitizeId,
  splitHostPort,
} from '../src/config.js';

test('an empty configuration has no agent and the defaults', () => {
  const config = normalizeConfig();
  assert.deepEqual(config.snmpAgents, []);
  assert.deepEqual(config.agentProblems, []);
  assert.equal(config.version, DEFAULT_CONFIG.version);
  assert.equal(config.poll_frequency, 60);
});

test('numbers arrive as strings from a form, and are clamped', () => {
  const config = normalizeConfig({ timeout: '5', retries: '9', poll_frequency: '10' });
  assert.equal(config.timeout, 5);
  assert.equal(config.retries, 5);
  assert.equal(config.poll_frequency, 60);
});

test('the short form: host;name;profiles, separated by commas', () => {
  const { agents, problems } = parseAgents(
    '192.168.1.10;NAS;host, 192.168.1.20:1161;UPS;ups+host, 10.0.0.1',
  );
  assert.deepEqual(problems, []);
  assert.equal(agents.length, 3);
  assert.deepEqual(
    agents.map((agent) => [agent.id, agent.name, agent.port, agent.profiles]),
    [
      ['192.168.1.10', 'NAS', 161, ['system', 'host']],
      ['192.168.1.20-1161', 'UPS', 1161, ['system', 'ups', 'host']],
      ['10.0.0.1', '10.0.0.1', 161, ['system']],
    ],
  );
  assert.equal(agents[0].community, DEFAULT_COMMUNITY);
});

test('the JSON form: interfaces, custom OIDs, per-agent community', () => {
  const { agents, problems } = parseAgents(
    JSON.stringify([
      {
        id: 'core-switch',
        name: 'Core switch',
        host: 'switch.lan',
        community: 'secret',
        interfaces: [1, 'eth0'],
        oids: [
          {
            oid: '.1.3.6.1.4.1.9999.1.1.0',
            name: 'Temperature',
            category: 'temperature-sensor',
            type: 'decimal',
            unit: 'celsius',
            scale: 0.1,
          },
          {
            oid: '1.3.6.1.4.1.9999.2.1.0',
            key: 'outlet1',
            name: 'Outlet 1',
            writable: true,
            on: 1,
            off: 2,
          },
        ],
      },
    ]),
  );
  assert.deepEqual(problems, []);
  const [agent] = agents;
  assert.equal(agent.id, 'core-switch');
  assert.equal(agent.community, 'secret');
  assert.deepEqual(agent.interfaces, ['1', 'eth0']);
  assert.ok(agent.profiles.includes('interfaces'), 'interfaces listed -> profile on');
  assert.equal(agent.oids[0].oid, '1.3.6.1.4.1.9999.1.1.0', 'leading dot stripped');
  assert.equal(agent.oids[0].key, '1-3-6-1-4-1-9999-1-1-0');
  assert.equal(agent.oids[1].category, 'switch');
  assert.equal(agent.oids[1].binary, true);
  assert.equal(agent.oids[1].off, 2);
});

test('a JSON object with an "agents" list is accepted too', () => {
  const { agents } = parseAgents('{"agents":[{"host":"10.0.0.2"}]}');
  assert.equal(agents.length, 1);
});

test('mistakes are reported, not fatal', () => {
  const { agents, problems } = parseAgents(
    JSON.stringify([
      { name: 'no host' },
      { host: '10.0.0.3', version: '4' },
      { host: '10.0.0.4', profiles: ['printer'] },
      { host: '10.0.0.4' },
      { host: '10.0.0.5', oids: [{ oid: 'sysName' }, { oid: '1.3.6.1.2', category: 'nope' }] },
    ]),
  );
  assert.deepEqual(
    agents.map((agent) => agent.id),
    ['10.0.0.4', '10.0.0.5'],
  );
  assert.equal(agents[1].oids[0].category, 'unknown');
  assert.equal(problems.length, 6, problems.join('\n'));
});

test('invalid JSON is one problem, no agent', () => {
  const { agents, problems } = parseAgents('[{"host": }]');
  assert.deepEqual(agents, []);
  assert.match(problems[0], /not valid JSON/);
});

test('SNMPv3: the security level follows from the keys given', () => {
  const base = {
    version: '3',
    v3_user: 'gladys',
    v3_auth_protocol: 'sha',
    v3_priv_protocol: 'aes',
  };
  const level = (extra) =>
    normalizeConfig({ ...base, ...extra, agents: '10.0.0.1' }).snmpAgents[0].v3.level;
  assert.equal(level({}), 'noAuthNoPriv');
  assert.equal(level({ v3_auth_key: 'authpass1' }), 'authNoPriv');
  assert.equal(level({ v3_auth_key: 'authpass1', v3_priv_key: 'privpass1' }), 'authPriv');
});

test('host:port, [ipv6]:port and bare IPv6 addresses', () => {
  assert.deepEqual(splitHostPort('10.0.0.1:1161'), { host: '10.0.0.1', port: 1161 });
  assert.deepEqual(splitHostPort('[fe80::1]:162'), { host: 'fe80::1', port: 162 });
  assert.deepEqual(splitHostPort('fe80::1'), { host: 'fe80::1', port: undefined });
});

test('ids keep only what an external id can carry', () => {
  assert.equal(sanitizeId('FE80::1'), 'fe80-1');
  assert.equal(sanitizeId('  My Switch '), 'my-switch');
});

test('Wake-on-LAN: the MAC address in every usual form, the broadcast address checked', () => {
  assert.equal(normalizeMac('AA:BB:CC:DD:EE:FF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normalizeMac('aabb.ccdd.eeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normalizeMac('aabbccddeeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normalizeMac('aa:bb:cc:dd:ee'), null);
  assert.equal(normalizeMac('not a mac'), null);

  const { agents, problems } = parseAgents([
    { host: '10.0.0.1', mac: 'AA-BB-CC-DD-EE-FF', wake_address: '10.0.0.255' },
    { host: '10.0.0.2', mac: 'zz', wake_address: '10.0.0.255' },
    { host: '10.0.0.3', mac: 'aabbccddeeff', wake_address: '10.0.0.256' },
    { host: '10.0.0.4' },
  ]);
  assert.deepEqual(
    agents.map((agent) => [agent.mac, agent.wakeAddress]),
    [
      ['aa:bb:cc:dd:ee:ff', '10.0.0.255'],
      [null, null],
      ['aa:bb:cc:dd:ee:ff', null],
      [null, null],
    ],
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /Agent #2: "zz" is not a MAC address/);
  assert.match(problems[1], /Agent #3: "10.0.0.256" is not an IPv4 address/);
});
