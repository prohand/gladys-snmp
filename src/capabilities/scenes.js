// -----------------------------------------------------------------------------
// Scenes (Gladys 5.1+): what HAPPENED on the network, and what a scene can ask.
//
// Triggers, declared in the manifest `scene_triggers` and fired by the monitor
// on a transition only (one event per change, never one per poll):
//
//   agent_unreachable   an agent that answered stopped answering
//   agent_recovered     an agent that did not answer answers again
//   interface_changed   a monitored interface went up or down
//
// Actions, declared in the manifest `scene_actions`:
//
//   snmp_get            read one OID of an agent, for the following actions
//   snmp_set            write one OID (a PDU outlet, a PoE port, a reboot OID)
//   poll_agent          read an agent now, instead of at the next poll
//
// A scene action never throws for an SNMP failure: it says so in its outputs
// (`success`, `error`), and the scene author gates on them — a scene action is
// never a condition. And it never fires a trigger: a scene bound to that event
// would loop through the integration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isOid } from '../config.js';
import { describeError } from '../snmp/client.js';
import { toNumber, toText } from '../snmp/values.js';
import { idsFor } from '../agents/device.js';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  AGENT_UNREACHABLE: 'agent_unreachable',
  AGENT_RECOVERED: 'agent_recovered',
  INTERFACE_CHANGED: 'interface_changed',
};

export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

export class SceneEvents {
  async agentUnreachable(gladys, agent, state) {
    return publish(gladys, SCENE_TRIGGERS.AGENT_UNREACHABLE, {
      device: idsFor(gladys, agent).device,
      device_name: agent.name,
      host: agent.host,
      error: state.error ?? '',
    });
  }

  async agentRecovered(gladys, agent, state) {
    // `since` still holds the moment it went down: the poll that saw it come
    // back updates it right after the triggers.
    const downtime =
      state.since === null ? null : Math.round((state.lastRead - state.since) / 60000);
    return publish(gladys, SCENE_TRIGGERS.AGENT_RECOVERED, {
      device: idsFor(gladys, agent).device,
      device_name: agent.name,
      host: agent.host,
      downtime_minutes: downtime,
    });
  }

  async interfaceChanged(gladys, agent, token, up) {
    return publish(gladys, SCENE_TRIGGERS.INTERFACE_CHANGED, {
      device: idsFor(gladys, agent).device,
      device_name: agent.name,
      interface: String(token),
      status: up ? 'up' : 'down',
    });
  }
}

async function publish(gladys, key, data) {
  try {
    await gladys.publishSceneEvent(key, data);
    logger.debug(`Scene event ${key}: ${JSON.stringify(data)}`);
    return true;
  } catch (err) {
    // A Gladys too old for scene triggers answers 404, a burst 429: neither
    // is a reason to fail the poll the event came from.
    logger.debug(`Scene event ${key} not published: ${err.message}`);
    return false;
  }
}

/**
 * The agent a `"source": "devices"` field designates, or an Error saying why
 * there is none.
 */
export function agentOf(gladys, config, externalId) {
  const agent = config.snmpAgents.find((entry) => idsFor(gladys, entry).device === externalId);
  if (!agent) {
    throw new Error(`No SNMP agent for the device ${externalId}: check the agent list`);
  }
  return agent;
}

/** Handlers of the manifest `scene_actions`, keyed by `key`. */
export function createSceneActions(monitor) {
  return {
    async snmp_get(gladys, { fields, config }) {
      const oid = String(fields.oid ?? '')
        .trim()
        .replace(/^\./, '');
      if (!isOid(oid)) {
        return { success: false, value: '', number: null, error: `"${fields.oid}" is not an OID` };
      }
      try {
        const agent = agentOf(gladys, config, fields.device);
        const varbind = await monitor.getOne(agent, config, oid);
        const text = toText(varbind);
        if (text === null) {
          return { success: false, value: '', number: null, error: 'no such object' };
        }
        return { success: true, value: text.slice(0, 10000), number: toNumber(varbind), error: '' };
      } catch (err) {
        logger.warn(`Scene action snmp_get failed: ${describeError(err)}`);
        return { success: false, value: '', number: null, error: describeError(err) };
      }
    },

    async snmp_set(gladys, { fields, config }) {
      const oid = String(fields.oid ?? '')
        .trim()
        .replace(/^\./, '');
      if (!isOid(oid)) {
        return { success: false, error: `"${fields.oid}" is not an OID` };
      }
      try {
        const agent = agentOf(gladys, config, fields.device);
        await monitor.set(agent, config, oid, fields.value_type ?? 'integer', fields.value);
        return { success: true, error: '' };
      } catch (err) {
        logger.warn(`Scene action snmp_set failed: ${describeError(err)}`);
        return { success: false, error: describeError(err) };
      }
    },

    async poll_agent(gladys, { fields, config }) {
      try {
        const agent = agentOf(gladys, config, fields.device);
        const state = await monitor.poll(gladys, agent, config);
        return { reachable: state.reachable === true, response_time: state.rtt };
      } catch (err) {
        logger.warn(`Scene action poll_agent failed: ${describeError(err)}`);
        return { reachable: false, response_time: null };
      }
    },
  };
}

export const SCENE_ACTION_KEYS = ['snmp_get', 'snmp_set', 'poll_agent'];
