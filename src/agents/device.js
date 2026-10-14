// -----------------------------------------------------------------------------
// One SNMP agent -> one Gladys device.
//
// The features come from the agent's profiles (system, interfaces, host, ups)
// and from its custom OIDs. Their keys are what Gladys keys the history on:
// never rename one (see CLAUDE.md).
//
// Every feature declares `min` and `max`: Gladys stores them NOT NULL, binary
// features included.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { PROFILES } from '../config.js';

/** The device type in the external ids: `ext:<selector>:agent:<id>`. */
export const DEVICE_TYPE = 'agent';

/** Feature keys of the built-in profiles. Never renamed: Gladys keys history on them. */
export const FEATURES = {
  REACHABLE: 'reachable',
  RESPONSE_TIME: 'response-time',
  UPTIME: 'uptime',
  CPU_LOAD: 'cpu-load',
  MEMORY_USED: 'memory-used',
  DISK_USED: 'disk-used',
  UPS_CHARGE: 'ups-charge',
  UPS_RUNTIME: 'ups-runtime',
  UPS_BATTERY_LOW: 'ups-battery-low',
  UPS_ON_MAINS: 'ups-on-mains',
  UPS_INPUT_VOLTAGE: 'ups-input-voltage',
  UPS_LOAD: 'ups-load',
  UPS_OUTPUT_POWER: 'ups-output-power',
};

/** Feature keys of one monitored interface. */
export function interfaceKeys(token) {
  const id = String(token)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return { status: `if-${id}-status`, in: `if-${id}-in`, out: `if-${id}-out` };
}

/** Feature key of a custom OID. */
export function oidKey(oid) {
  return `oid-${oid.key}`;
}

export function idsFor(gladys, agent) {
  return gladys.externalIds(DEVICE_TYPE, agent.id);
}

/**
 * The discovery payload of an agent.
 *
 * @param {object} gladys the SDK instance
 * @param {object} agent normalized agent (see src/config.js)
 */
export function buildDevice(gladys, agent) {
  const ids = idsFor(gladys, agent);
  const feature = (key, spec) => ({
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
  });

  const features = [
    feature(FEATURES.REACHABLE, {
      name: 'Reachable',
      category: C.PRESENCE_SENSOR,
      type: T.SENSOR.BINARY,
      min: 0,
      max: 1,
    }),
    feature(FEATURES.RESPONSE_TIME, {
      name: 'Response time',
      category: C.DURATION,
      type: T.DURATION.INTEGER,
      unit: U.MILLISECONDS,
      min: 0,
      max: 60000,
    }),
    feature(FEATURES.UPTIME, {
      name: 'Uptime',
      category: C.DURATION,
      type: T.DURATION.DECIMAL,
      unit: U.DAYS,
      min: 0,
      max: 100000,
      keep_history: false,
    }),
  ];

  if (agent.profiles.includes(PROFILES.INTERFACES)) {
    for (const token of agent.interfaces) {
      const keys = interfaceKeys(token);
      features.push(
        feature(keys.status, {
          name: `Interface ${token} link`,
          category: C.INPUT,
          type: T.INPUT.BINARY,
          min: 0,
          max: 1,
        }),
        feature(keys.in, {
          name: `Interface ${token} in`,
          category: C.DATARATE,
          type: T.DATARATE.RATE,
          unit: U.KILOBITS_PER_SECOND,
          min: 0,
          max: 100000000,
        }),
        feature(keys.out, {
          name: `Interface ${token} out`,
          category: C.DATARATE,
          type: T.DATARATE.RATE,
          unit: U.KILOBITS_PER_SECOND,
          min: 0,
          max: 100000000,
        }),
      );
    }
  }

  if (agent.profiles.includes(PROFILES.HOST)) {
    // Gladys has no "computer" category: a percentage of the `unknown`
    // category is what renders a plain value with its unit.
    for (const [key, name] of [
      [FEATURES.CPU_LOAD, 'CPU load'],
      [FEATURES.MEMORY_USED, 'Memory used'],
      [FEATURES.DISK_USED, 'Disk used'],
    ]) {
      features.push(
        feature(key, {
          name,
          category: C.UNKNOWN,
          type: T.UNKNOWN.UNKNOWN,
          unit: U.PERCENT,
          min: 0,
          max: 100,
        }),
      );
    }
  }

  if (agent.profiles.includes(PROFILES.UPS)) {
    features.push(
      feature(FEATURES.UPS_CHARGE, {
        name: 'Battery charge',
        category: C.BATTERY,
        type: T.BATTERY.INTEGER,
        unit: U.PERCENT,
        min: 0,
        max: 100,
      }),
      feature(FEATURES.UPS_RUNTIME, {
        name: 'Battery runtime',
        category: C.DURATION,
        type: T.DURATION.INTEGER,
        unit: U.MINUTES,
        min: 0,
        max: 100000,
      }),
      feature(FEATURES.UPS_BATTERY_LOW, {
        name: 'Battery low',
        category: C.BATTERY_LOW,
        type: T.BATTERY_LOW.BINARY,
        min: 0,
        max: 1,
      }),
      feature(FEATURES.UPS_ON_MAINS, {
        name: 'Mains power',
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.BINARY,
        min: 0,
        max: 1,
      }),
      feature(FEATURES.UPS_INPUT_VOLTAGE, {
        name: 'Input voltage',
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.VOLTAGE,
        unit: U.VOLT,
        min: 0,
        max: 500,
      }),
      feature(FEATURES.UPS_LOAD, {
        name: 'Output load',
        category: C.UNKNOWN,
        type: T.UNKNOWN.UNKNOWN,
        unit: U.PERCENT,
        min: 0,
        max: 200,
      }),
      feature(FEATURES.UPS_OUTPUT_POWER, {
        name: 'Output power',
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.POWER,
        unit: U.WATT,
        min: 0,
        max: 100000,
      }),
    );
  }

  for (const oid of agent.oids) {
    features.push(
      feature(oidKey(oid), {
        name: oid.name,
        category: oid.category,
        type: oid.type,
        ...(oid.unit ? { unit: oid.unit } : {}),
        min: oid.min,
        max: oid.max,
        read_only: !oid.writable,
        has_feedback: oid.writable,
      }),
    );
  }

  return {
    name: agent.name,
    external_id: ids.device,
    // Gladys polls at most once a minute; a slower refresh interval is applied
    // by skipping polls (see AgentMonitor.isDue).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'host', value: agent.host },
      { name: 'port', value: String(agent.port) },
      { name: 'version', value: agent.version },
    ],
    features,
  };
}
