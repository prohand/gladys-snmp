// -----------------------------------------------------------------------------
// A fake SNMP agent, behind the same interface as src/snmp/client.js.
//
// The MIB is a plain object `{ oid: value }`: a number is an Integer, a string
// an OctetString, `{ type, value }` anything else (a Counter64, a TimeTicks…).
// `down: true` makes every request time out, like an agent switched off.
// -----------------------------------------------------------------------------

import { TYPES } from '../../src/snmp/values.js';

export class FakeAgent {
  constructor(mib = {}) {
    this.mib = new Map(Object.entries(mib).map(([oid, value]) => [oid, toVarbind(oid, value)]));
    this.down = false;
    this.requests = [];
    this.sets = [];
  }

  /** Change a value of the MIB, as the device would. */
  setMib(oid, value) {
    this.mib.set(oid, toVarbind(oid, value));
  }

  /** The client factory to give the code under test. */
  factory() {
    return () => this.client();
  }

  client() {
    const agent = this;
    const check = () => {
      if (agent.down) {
        const error = new Error('Request timed out');
        error.name = 'RequestTimedOutError';
        throw error;
      }
    };
    return {
      async get(oids) {
        agent.requests.push({ type: 'get', oids });
        check();
        return oids.map(
          (oid) => agent.mib.get(oid) ?? { oid, type: TYPES.NO_SUCH_INSTANCE, value: null },
        );
      },
      async subtree(base, limit = 200) {
        agent.requests.push({ type: 'subtree', oid: base });
        check();
        return [...agent.mib.values()]
          .filter((varbind) => varbind.oid.startsWith(`${base}.`))
          .sort((a, b) => compareOids(a.oid, b.oid))
          .slice(0, limit);
      },
      async set(varbinds) {
        agent.requests.push({ type: 'set', varbinds });
        check();
        for (const varbind of varbinds) {
          agent.sets.push(varbind);
          agent.mib.set(varbind.oid, { ...varbind });
        }
        return varbinds;
      },
      close() {},
    };
  }
}

function toVarbind(oid, value) {
  if (value && typeof value === 'object' && 'type' in value) {
    return { oid, ...value };
  }
  if (typeof value === 'number') {
    return { oid, type: TYPES.INTEGER, value };
  }
  return { oid, type: TYPES.OCTET_STRING, value: Buffer.from(String(value)) };
}

function compareOids(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? -1) !== (y[i] ?? -1)) {
      return (x[i] ?? -1) - (y[i] ?? -1);
    }
  }
  return 0;
}

/** A Counter64 varbind, as net-snmp hands it: 8 big-endian bytes. */
export function counter64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return { type: TYPES.COUNTER64, value: buffer };
}

/** A switch with two ports, a NAS's host resources and a UPS, all in one. */
export function sampleMib() {
  return {
    '1.3.6.1.2.1.1.1.0': 'Linux nas 6.1.0',
    '1.3.6.1.2.1.1.3.0': { type: TYPES.TIME_TICKS, value: 8640000 * 3 },
    '1.3.6.1.2.1.1.5.0': 'nas',
    '1.3.6.1.2.1.1.6.0': 'Cellar',
    // IF-MIB: eth0 (index 2) up, eth1 (index 3) down.
    '1.3.6.1.2.1.2.2.1.2.2': 'eth0',
    '1.3.6.1.2.1.2.2.1.2.3': 'eth1',
    '1.3.6.1.2.1.31.1.1.1.1.2': 'eth0',
    '1.3.6.1.2.1.31.1.1.1.1.3': 'eth1',
    '1.3.6.1.2.1.2.2.1.8.2': 1,
    '1.3.6.1.2.1.2.2.1.8.3': 2,
    '1.3.6.1.2.1.2.2.1.10.2': { type: TYPES.COUNTER, value: 1000 },
    '1.3.6.1.2.1.2.2.1.16.2': { type: TYPES.COUNTER, value: 2000 },
    '1.3.6.1.2.1.31.1.1.1.6.2': counter64(1_000_000),
    '1.3.6.1.2.1.31.1.1.1.10.2': counter64(2_000_000),
    // HOST-RESOURCES: two CPUs, RAM half used, two disks (80 % and 25 %).
    '1.3.6.1.2.1.25.3.3.1.2.196608': 10,
    '1.3.6.1.2.1.25.3.3.1.2.196609': 30,
    '1.3.6.1.2.1.25.2.3.1.2.1': { type: TYPES.OID, value: '1.3.6.1.2.1.25.2.1.2' },
    '1.3.6.1.2.1.25.2.3.1.2.31': { type: TYPES.OID, value: '1.3.6.1.2.1.25.2.1.4' },
    '1.3.6.1.2.1.25.2.3.1.2.32': { type: TYPES.OID, value: '1.3.6.1.2.1.25.2.1.4' },
    '1.3.6.1.2.1.25.2.3.1.5.1': 1000,
    '1.3.6.1.2.1.25.2.3.1.6.1': 500,
    '1.3.6.1.2.1.25.2.3.1.5.31': 1000,
    '1.3.6.1.2.1.25.2.3.1.6.31': 800,
    '1.3.6.1.2.1.25.2.3.1.5.32': 1000,
    '1.3.6.1.2.1.25.2.3.1.6.32': 250,
    // UPS-MIB: on mains, 95 %, 42 minutes.
    '1.3.6.1.2.1.33.1.2.1.0': 2,
    '1.3.6.1.2.1.33.1.2.3.0': 42,
    '1.3.6.1.2.1.33.1.2.4.0': 95,
    '1.3.6.1.2.1.33.1.3.3.1.3.1': 230,
    '1.3.6.1.2.1.33.1.4.1.0': 3,
    '1.3.6.1.2.1.33.1.4.4.1.4.1': 120,
    '1.3.6.1.2.1.33.1.4.4.1.5.1': 18,
    // A vendor temperature in tenths of a degree, and a PDU outlet (1 on, 2 off).
    '1.3.6.1.4.1.9999.1.1.0': 415,
    '1.3.6.1.4.1.9999.2.1.0': 1,
  };
}
