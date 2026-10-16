// The real net-snmp client against a real net-snmp agent, on the loopback
// interface only: what the fake agent of the other tests cannot prove.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import snmp from 'net-snmp';
import { normalizeConfig } from '../src/config.js';
import { encodeGetRequest, isGetResponse } from '../src/snmp/broadcast.js';
import { createClient, isTimeout } from '../src/snmp/client.js';
import { toNumber, toText } from '../src/snmp/values.js';

async function freePort() {
  const socket = createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startAgent(port) {
  const agent = snmp.createAgent({ port, address: '127.0.0.1' }, () => {});
  agent.getAuthorizer().addCommunity('public');
  const mib = agent.getMib();
  mib.registerProvider({
    name: 'sysName',
    type: snmp.MibProviderType.Scalar,
    oid: '1.3.6.1.2.1.1.5',
    scalarType: snmp.ObjectType.OctetString,
    maxAccess: snmp.MaxAccess['read-write'],
  });
  mib.setScalarValue('sysName', 'loopback');
  mib.registerProvider({
    name: 'sysUpTime',
    type: snmp.MibProviderType.Scalar,
    oid: '1.3.6.1.2.1.1.3',
    scalarType: snmp.ObjectType.TimeTicks,
    maxAccess: snmp.MaxAccess['read-only'],
  });
  mib.setScalarValue('sysUpTime', 8640000);
  // The agent binds asynchronously: give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return agent;
}

test('GET, absent objects, SET and walk against a real agent', async (t) => {
  const port = await freePort();
  const server = await startAgent(port);
  t.after(() => server.close());

  const config = normalizeConfig({ agents: `127.0.0.1:${port};Loopback`, timeout: 2, retries: 0 });
  const client = createClient(config.snmpAgents[0], config);
  t.after(() => client.close());

  const [uptime, name, missing] = await client.get([
    '1.3.6.1.2.1.1.3.0',
    '1.3.6.1.2.1.1.5.0',
    '1.3.6.1.2.1.1.99.0',
  ]);
  assert.equal(toNumber(uptime), 8640000);
  assert.equal(toText(name), 'loopback');
  assert.equal(toText(missing), null, 'absent, not an error');

  await client.set([
    { oid: '1.3.6.1.2.1.1.5.0', type: snmp.ObjectType.OctetString, value: 'renamed' },
  ]);
  const walked = await client.subtree('1.3.6.1.2.1.1');
  assert.deepEqual(
    walked.map((varbind) => [varbind.oid, toText(varbind)]),
    [
      ['1.3.6.1.2.1.1.3.0', '8640000'],
      ['1.3.6.1.2.1.1.5.0', 'renamed'],
    ],
  );
});

test('no agent listening is a timeout', async (t) => {
  const port = await freePort();
  const config = normalizeConfig({ agents: `127.0.0.1:${port}`, timeout: 1, retries: 0 });
  const client = createClient(config.snmpAgents[0], config);
  t.after(() => client.close());
  await assert.rejects(client.get(['1.3.6.1.2.1.1.3.0']), (err) => isTimeout(err));
});

test('the discovery request is a GET a real agent answers', async (t) => {
  const port = await freePort();
  const server = await startAgent(port);
  t.after(() => server.close());

  for (const version of ['1', '2c']) {
    const socket = createSocket('udp4');
    t.after(() => socket.close());
    const answer = new Promise((resolve) => socket.once('message', resolve));
    socket.send(
      encodeGetRequest({
        version,
        community: 'public',
        oids: ['1.3.6.1.2.1.1.5.0'],
        requestId: 0x12345678,
      }),
      port,
      '127.0.0.1',
    );
    const message = await answer;
    assert.equal(isGetResponse(message), true, `SNMP v${version}`);
    assert.ok(message.includes(Buffer.from('loopback')), `SNMP v${version}`);
  }
  assert.equal(isGetResponse(Buffer.from('not snmp')), false);
  assert.equal(isGetResponse(Buffer.from([0x30, 0x82, 0xff])), false);
});
