// -----------------------------------------------------------------------------
// The agent monitor: reads every agent, publishes what changed, and remembers
// what it saw.
//
// One poll of an agent:
//   1. GET the system group — the answer time of that request is the
//      "Response time" feature, and no answer at all is "unreachable";
//   2. GET or walk what the profiles and custom OIDs need;
//   3. publish the values that changed (`publishChangedStates`: the host API
//      takes 300 states a minute, sized for changes, not snapshots);
//   4. compare with the previous poll and fire the scene triggers on the
//      transitions (agent lost, agent back, interface up/down).
//
// The state kept here is also what the widget and the "Test the connection"
// action show, without asking the agents again.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { PROFILES } from '../config.js';
import { createClient, describeError, isTimeout, SET_OBJECT_TYPES } from '../snmp/client.js';
import {
  HOST,
  IF,
  IF_OPER_STATUS,
  STORAGE_TYPES,
  SYSTEM,
  UPS,
  UPS_BATTERY_STATUS,
  UPS_OUTPUT_SOURCE,
} from '../snmp/oids.js';
import {
  COUNTER32_WRAP,
  COUNTER64_WRAP,
  isPresent,
  rateKbps,
  ticksToDays,
  toNumber,
  toText,
} from '../snmp/values.js';
import { FEATURES, idsFor, interfaceKeys, oidKey } from './device.js';

const logger = createLogger({ name: 'monitor' });

/** An unchanged value is still sent every 30 minutes, so it stays recently dated. */
export const HEARTBEAT_MS = 30 * 60 * 1000;

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 300 s interval does not slip to 360 s.
const POLL_TOLERANCE_MS = 30 * 1000;

export class AgentMonitor {
  /**
   * @param {object} [options]
   * @param {Function} [options.clientFactory] `(agent, config) => client`, see src/snmp/client.js
   * @param {() => number} [options.now] clock, so tests can date the readings
   * @param {object} [options.sceneEvents] where the transitions are reported (src/capabilities/scenes.js)
   */
  constructor({ clientFactory = createClient, now = () => Date.now(), sceneEvents = null } = {}) {
    this.clientFactory = clientFactory;
    this.now = now;
    this.sceneEvents = sceneEvents;
    /** @type {Map<string, object>} runtime state per agent id */
    this.states = new Map();
    /** @type {Map<string, Promise>} the poll in flight per agent id */
    this.inflight = new Map();
  }

  /** The runtime state of an agent, created empty on first use. */
  stateOf(agent) {
    if (!this.states.has(agent.id)) {
      this.states.set(agent.id, {
        reachable: null,
        since: null,
        error: null,
        rtt: null,
        lastRead: null,
        sysName: null,
        sysDescr: null,
        sysLocation: null,
        uptimeTicks: null,
        interfaces: new Map(),
        counters: new Map(),
        ifIndexes: null,
      });
    }
    return this.states.get(agent.id);
  }

  /** Forget the agents the configuration no longer lists. */
  retain(agents) {
    const ids = new Set(agents.map((agent) => agent.id));
    for (const id of this.states.keys()) {
      if (!ids.has(id)) {
        this.states.delete(id);
      }
    }
  }

  /**
   * Is a new read due? Gladys polls every minute; the refresh interval of the
   * configuration (or of the agent) is applied by skipping polls.
   */
  isDue(agent, config) {
    const { lastRead } = this.stateOf(agent);
    const interval = (agent.refresh ?? config.poll_frequency) * 1000;
    return lastRead === null || this.now() - lastRead >= interval - POLL_TOLERANCE_MS;
  }

  /**
   * Read an agent and publish its values. Concurrent calls for the same agent
   * share one read: the Gladys poll, the widget button and a scene action can
   * all ask at once.
   *
   * @returns {Promise<object>} the runtime state of the agent
   */
  poll(gladys, agent, config) {
    if (!this.inflight.has(agent.id)) {
      const run = this.read(gladys, agent, config).finally(() => this.inflight.delete(agent.id));
      this.inflight.set(agent.id, run);
    }
    return this.inflight.get(agent.id);
  }

  /** Read every agent, a few at a time. */
  async pollAll(gladys, config, { force = true } = {}) {
    const agents = config.snmpAgents.filter((agent) => force || this.isDue(agent, config));
    const queue = [...agents];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        await this.poll(gladys, queue.shift(), config);
      }
    });
    await Promise.all(workers);
  }

  async read(gladys, agent, config) {
    const state = this.stateOf(agent);
    const ids = idsFor(gladys, agent);
    const client = this.clientFactory(agent, config);
    const states = [];
    const push = (key, value) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        states.push({ device_feature_external_id: ids.feature(key), state: value });
      }
    };
    const wasReachable = state.reachable;
    const previousInterfaces = new Map(
      [...state.interfaces].map(([token, entry]) => [token, entry.status]),
    );

    let answered = false;
    try {
      // 1. The system group: the one every agent answers, hence the clock.
      const started = this.now();
      const system = await client.get([SYSTEM.UPTIME, SYSTEM.NAME, SYSTEM.DESCR, SYSTEM.LOCATION]);
      const rtt = Math.max(0, Math.round(this.now() - started));
      answered = true;

      const uptimeTicks = toNumber(system[0]);
      if (state.uptimeTicks !== null && uptimeTicks !== null && uptimeTicks < state.uptimeTicks) {
        // Rebooted: interface indexes may have moved, counters restarted.
        state.ifIndexes = null;
        state.counters.clear();
      }
      Object.assign(state, {
        reachable: true,
        error: null,
        rtt,
        uptimeTicks,
        sysName: toText(system[1]),
        sysDescr: toText(system[2]),
        sysLocation: toText(system[3]),
      });
      push(FEATURES.REACHABLE, 1);
      push(FEATURES.RESPONSE_TIME, rtt);
      push(FEATURES.UPTIME, ticksToDays(uptimeTicks));

      // 2. The profiles and the custom OIDs. One that fails is logged and
      // skipped: a NAS without HOST-RESOURCES still has interfaces.
      const parts = [
        [PROFILES.INTERFACES, () => this.readInterfaces(client, agent, state, push)],
        [PROFILES.HOST, () => this.readHost(client, push)],
        [PROFILES.UPS, () => this.readUps(client, push)],
      ];
      for (const [profile, readProfile] of parts) {
        if (agent.profiles.includes(profile)) {
          await readProfile().catch((err) => {
            if (isTimeout(err)) {
              throw err;
            }
            logger.warn(`${agent.name}: profile ${profile} not read (${describeError(err)})`);
          });
        }
      }
      if (agent.oids.length > 0) {
        states.push(...(await this.readOids(client, agent, ids)));
      }
    } catch (err) {
      if (answered) {
        // It answered the system group and then failed: still reachable, and
        // what was read before the failure is still worth publishing.
        logger.warn(`${agent.name}: read incomplete (${describeError(err)})`);
      } else {
        Object.assign(state, { reachable: false, error: describeError(err), rtt: null });
        states.length = 0;
        push(FEATURES.REACHABLE, 0);
        logger.debug(`${agent.name} (${agent.host}): ${state.error}`);
      }
    } finally {
      client.close();
    }

    state.lastRead = this.now();
    await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS }).catch((err) => {
      logger.warn(`${agent.name}: states not published (${err.message})`);
    });
    // The triggers read `since` as the start of the previous period (the
    // downtime of a recovered agent): it moves only once they are fired.
    await this.reportTransitions(gladys, agent, state, wasReachable, previousInterfaces);
    if (wasReachable !== state.reachable) {
      state.since = state.lastRead;
    }
    return state;
  }

  async readInterfaces(client, agent, state, push) {
    const indexes = await this.resolveInterfaces(client, agent, state);
    const oids = [];
    for (const index of indexes.values()) {
      oids.push(
        `${IF.OPER_STATUS}.${index}`,
        `${IF.IN_OCTETS}.${index}`,
        `${IF.OUT_OCTETS}.${index}`,
      );
      if (agent.version !== '1') {
        // 32-bit counters wrap in 34 s at 1 Gbit/s: the 64-bit ones, when the
        // agent has them, are the only ones a one-minute poll can trust.
        oids.push(`${IF.HC_IN_OCTETS}.${index}`, `${IF.HC_OUT_OCTETS}.${index}`);
      }
    }
    const values = byOid(oids.length > 0 ? await client.get(oids) : []);
    const at = this.now();

    for (const token of agent.interfaces) {
      const keys = interfaceKeys(token);
      const index = indexes.get(token);
      if (index === undefined) {
        state.interfaces.set(token, { index: null, status: null, in: null, out: null });
        continue;
      }
      const status = toNumber(values.get(`${IF.OPER_STATUS}.${index}`));
      const hcIn = values.get(`${IF.HC_IN_OCTETS}.${index}`);
      const hcOut = values.get(`${IF.HC_OUT_OCTETS}.${index}`);
      const hc = isPresent(hcIn) && isPresent(hcOut);
      const reading = {
        in: { value: toNumber(hc ? hcIn : values.get(`${IF.IN_OCTETS}.${index}`)), at },
        out: { value: toNumber(hc ? hcOut : values.get(`${IF.OUT_OCTETS}.${index}`)), at },
        hc,
      };
      const previous = state.counters.get(index);
      const wrap = hc ? COUNTER64_WRAP : COUNTER32_WRAP;
      const sameKind = previous && previous.hc === hc;
      const inKbps = sameKind ? rateKbps(previous.in, reading.in, wrap) : null;
      const outKbps = sameKind ? rateKbps(previous.out, reading.out, wrap) : null;
      state.counters.set(index, reading);

      const up = status === null ? null : status === IF_OPER_STATUS.UP ? 1 : 0;
      state.interfaces.set(token, { index, status: up, in: inKbps, out: outKbps });
      push(keys.status, up);
      push(keys.in, inKbps);
      push(keys.out, outKbps);
    }
  }

  /**
   * Interface tokens -> ifIndex. A number is an index; a name is looked up in
   * ifName, ifDescr and ifAlias, once, then cached until the agent reboots.
   */
  async resolveInterfaces(client, agent, state) {
    const result = new Map();
    const names = agent.interfaces.filter((token) => !/^\d+$/.test(token));
    if (
      names.length > 0 &&
      (!state.ifIndexes || names.some((n) => !state.ifIndexes.has(lower(n))))
    ) {
      state.ifIndexes = await walkInterfaceNames(client);
    }
    for (const token of agent.interfaces) {
      if (/^\d+$/.test(token)) {
        result.set(token, Number(token));
      } else if (state.ifIndexes?.has(lower(token))) {
        result.set(token, state.ifIndexes.get(lower(token)));
      } else {
        logger.warn(`${agent.name}: no interface named "${token}" (see "List the interfaces")`);
      }
    }
    return result;
  }

  async readHost(client, push) {
    const loads = (await client.subtree(HOST.PROCESSOR_LOAD, 256))
      .map(toNumber)
      .filter((value) => value !== null);
    if (loads.length > 0) {
      push(FEATURES.CPU_LOAD, round(loads.reduce((sum, value) => sum + value, 0) / loads.length));
    }

    const types = await client.subtree(HOST.STORAGE_TYPE, 256);
    const sizes = byIndex(await client.subtree(HOST.STORAGE_SIZE, 256));
    const used = byIndex(await client.subtree(HOST.STORAGE_USED, 256));
    const usage = (index) => {
      const size = toNumber(sizes.get(index));
      const taken = toNumber(used.get(index));
      return size > 0 && taken !== null ? (taken / size) * 100 : null;
    };
    let memory = null;
    let disk = null;
    for (const varbind of types) {
      const index = lastArc(varbind.oid);
      const type = toText(varbind);
      const percent = usage(index);
      if (percent === null) {
        continue;
      }
      if (type === STORAGE_TYPES.RAM && memory === null) {
        memory = percent;
      } else if (type === STORAGE_TYPES.FIXED_DISK) {
        // The fullest disk is the one worth an alert.
        disk = Math.max(disk ?? 0, percent);
      }
    }
    push(FEATURES.MEMORY_USED, memory === null ? null : round(memory));
    push(FEATURES.DISK_USED, disk === null ? null : round(disk));
  }

  async readUps(client, push) {
    const oids = [
      UPS.CHARGE_REMAINING,
      UPS.MINUTES_REMAINING,
      UPS.BATTERY_STATUS,
      UPS.OUTPUT_SOURCE,
      UPS.INPUT_VOLTAGE,
      UPS.OUTPUT_LOAD,
      UPS.OUTPUT_POWER,
    ];
    const values = byOid(await client.get(oids));
    const get = (oid) => toNumber(values.get(oid));

    push(FEATURES.UPS_CHARGE, get(UPS.CHARGE_REMAINING));
    push(FEATURES.UPS_RUNTIME, get(UPS.MINUTES_REMAINING));
    const battery = get(UPS.BATTERY_STATUS);
    push(
      FEATURES.UPS_BATTERY_LOW,
      battery === UPS_BATTERY_STATUS.LOW || battery === UPS_BATTERY_STATUS.DEPLETED
        ? 1
        : battery === UPS_BATTERY_STATUS.NORMAL
          ? 0
          : null,
    );
    const source = get(UPS.OUTPUT_SOURCE);
    push(
      FEATURES.UPS_ON_MAINS,
      source === UPS_OUTPUT_SOURCE.NORMAL || source === UPS_OUTPUT_SOURCE.BYPASS
        ? 1
        : source === UPS_OUTPUT_SOURCE.BATTERY || source === UPS_OUTPUT_SOURCE.NONE
          ? 0
          : null,
    );
    push(FEATURES.UPS_INPUT_VOLTAGE, get(UPS.INPUT_VOLTAGE));
    push(FEATURES.UPS_LOAD, get(UPS.OUTPUT_LOAD));
    push(FEATURES.UPS_OUTPUT_POWER, get(UPS.OUTPUT_POWER));
  }

  async readOids(client, agent, ids) {
    const values = byOid(await client.get(agent.oids.map((oid) => oid.oid)));
    const states = [];
    for (const oid of agent.oids) {
      const varbind = values.get(oid.oid);
      if (!isPresent(varbind)) {
        logger.debug(`${agent.name}: ${oid.oid} (${oid.name}) is absent on the agent`);
        continue;
      }
      const external = ids.feature(oidKey(oid));
      if (oid.category === 'text') {
        states.push({ device_feature_external_id: external, text: toText(varbind).slice(0, 1000) });
        continue;
      }
      const value = oidValue(oid, varbind);
      if (value !== null) {
        states.push({ device_feature_external_id: external, state: value });
      }
    }
    return states;
  }

  /**
   * Write a custom OID (an outlet of a PDU, a PoE port…) and publish the value
   * the agent confirmed.
   */
  async setValue(gladys, agent, oid, value, config) {
    if (!oid.writable) {
      throw new Error(`${oid.name} is read-only`);
    }
    const raw = oid.binary ? (Number(value) === 1 ? oid.on : oid.off) : Number(value) / oid.scale;
    const echoed = await this.set(agent, config, oid.oid, oid.setType, raw);
    const confirmed = oidValue(oid, echoed) ?? Number(value);
    await gladys.publishState(idsFor(gladys, agent).feature(oidKey(oid)), confirmed);
    return confirmed;
  }

  /** One SNMP SET, typed. Resolves the varbind the agent echoed. */
  async set(agent, config, oid, setType, value) {
    const type = SET_OBJECT_TYPES[setType] ?? SET_OBJECT_TYPES.integer;
    const payload =
      setType === 'string' ? String(value) : Math.trunc(Number.parseFloat(String(value)));
    if (setType !== 'string' && !Number.isFinite(payload)) {
      throw new Error(`"${value}" is not a number`);
    }
    const client = this.clientFactory(agent, config);
    try {
      const [echoed] = await client.set([{ oid, type, value: payload }]);
      logger.info(`${agent.name}: SET ${oid} = ${payload}`);
      return echoed;
    } finally {
      client.close();
    }
  }

  /** One SNMP GET of a single OID, for the scene action and the actions. */
  async getOne(agent, config, oid) {
    const client = this.clientFactory(agent, config);
    try {
      const [varbind] = await client.get([oid]);
      return varbind;
    } finally {
      client.close();
    }
  }

  /** Walk a subtree, for the "Walk an OID" action. */
  async walk(agent, config, oid, limit) {
    const client = this.clientFactory(agent, config);
    try {
      return await client.subtree(oid, limit);
    } finally {
      client.close();
    }
  }

  /** The interfaces of an agent: index, name, description, status. */
  async listInterfaces(agent, config) {
    const client = this.clientFactory(agent, config);
    try {
      const names = byIndex(await client.subtree(IF.NAME, 256).catch(() => []));
      const descrs = await client.subtree(IF.DESCR, 256);
      const statuses = byIndex(await client.subtree(IF.OPER_STATUS, 256).catch(() => []));
      return descrs.map((varbind) => {
        const index = lastArc(varbind.oid);
        return {
          index: Number(index),
          name: toText(names.get(index)) ?? null,
          descr: toText(varbind),
          up: toNumber(statuses.get(index)) === IF_OPER_STATUS.UP,
        };
      });
    } finally {
      client.close();
    }
  }

  /** The transport badges: `local` when the agent answered, `unreachable` otherwise. */
  transportEntries(gladys, config) {
    return config.snmpAgents
      .filter((agent) => this.stateOf(agent).reachable !== null)
      .map((agent) => ({
        external_id: idsFor(gladys, agent).device,
        transport: this.stateOf(agent).reachable
          ? DEVICE_TRANSPORTS.LOCAL
          : DEVICE_TRANSPORTS.UNREACHABLE,
      }));
  }

  async reportTransitions(gladys, agent, state, wasReachable, previousInterfaces) {
    if (wasReachable !== state.reachable) {
      await gladys
        .publishTransports([
          {
            external_id: idsFor(gladys, agent).device,
            transport: state.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
          },
        ])
        .catch((err) => logger.debug(`Transport badge not published: ${err.message}`));
    }
    if (!this.sceneEvents) {
      return;
    }
    // Only transitions: an agent already down when the integration starts is
    // not news, and one event per change is the doctrine of the core.
    if (wasReachable === true && state.reachable === false) {
      logger.warn(`${agent.name} (${agent.host}) is unreachable: ${state.error}`);
      await this.sceneEvents.agentUnreachable(gladys, agent, state);
    } else if (wasReachable === false && state.reachable === true) {
      logger.info(`${agent.name} (${agent.host}) answers again`);
      await this.sceneEvents.agentRecovered(gladys, agent, state);
    }
    if (state.reachable) {
      for (const [token, entry] of state.interfaces) {
        const before = previousInterfaces.get(token);
        if (
          before !== undefined &&
          before !== null &&
          entry.status !== null &&
          before !== entry.status
        ) {
          await this.sceneEvents.interfaceChanged(gladys, agent, token, entry.status === 1);
        }
      }
    }
  }
}

/** The value of a custom OID, scaled, or mapped to 0/1 for a binary one. */
export function oidValue(oid, varbind) {
  if (!isPresent(varbind)) {
    return null;
  }
  if (oid.binary) {
    const text = toText(varbind);
    if (text === String(oid.on)) {
      return 1;
    }
    if (text === String(oid.off)) {
      return 0;
    }
    return null;
  }
  const number = toNumber(varbind);
  return number === null ? null : Math.round(number * oid.scale * 1000) / 1000;
}

async function walkInterfaceNames(client) {
  const indexes = new Map();
  // ifAlias first, ifName last: the most specific name wins a clash.
  for (const column of [IF.ALIAS, IF.DESCR, IF.NAME]) {
    const varbinds = await client.subtree(column, 512).catch(() => []);
    for (const varbind of varbinds) {
      const name = toText(varbind);
      if (name) {
        indexes.set(lower(name), Number(lastArc(varbind.oid)));
      }
    }
  }
  return indexes;
}

function byOid(varbinds) {
  return new Map(varbinds.map((varbind) => [String(varbind.oid), varbind]));
}

function byIndex(varbinds) {
  return new Map(varbinds.map((varbind) => [lastArc(varbind.oid), varbind]));
}

function lastArc(oid) {
  return String(oid).split('.').pop();
}

function lower(text) {
  return String(text).trim().toLowerCase();
}

function round(value) {
  return Math.round(value * 10) / 10;
}
