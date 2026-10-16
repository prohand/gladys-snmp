// -----------------------------------------------------------------------------
// Finding the SNMP agents of the local network, for the Discovery screen.
//
// One SNMP GET of sysName is broadcast on the LAN by the Gladys core (the
// integration's own broadcasts stay on the Docker bridge, see
// src/snmp/broadcast.js), with the community of the configuration. Every agent
// that accepts it answers; each one is then asked in unicast, through the
// regular client, for its name and for the MIBs that pick its profiles.
//
// A discovered agent is in no list typed by the user: once created, its Gladys
// device is what remembers it. Its params carry the host, port, version and
// profiles, never a community or a key — those come from the configuration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DEFAULT_COMMUNITY, PROFILES, parseAgents } from '../config.js';
import { encodeGetRequest, isGetResponse } from '../snmp/broadcast.js';
import { describeError } from '../snmp/client.js';
import { HOST, SYSTEM, UPS } from '../snmp/oids.js';
import { isPresent, toText } from '../snmp/values.js';
import { DEVICE_TYPE } from './device.js';

const logger = createLogger({ name: 'discovery' });

/** SNMP agents listen on 161: the broadcast only reaches the standard port. */
export const DISCOVERY_PORT = 161;

/** How long the core listens for answers: agents answer in milliseconds. */
export const SCAN_SECONDS = 5;

/** How many found agents are asked at once in unicast. */
const PROBES_AT_ONCE = 8;

/**
 * Broadcast the request and describe every agent that answered, except the
 * hosts already known.
 *
 * @param {object} gladys the SDK instance
 * @param {object} config normalized configuration
 * @param {object} options
 * @param {Function} options.clientFactory `(agent, config) => client`
 * @param {Iterable<string>} [options.knownHosts] hosts not to report again
 * @returns {Promise<Array<object>>} normalized agents, `discovered: true`
 */
export async function scanAgents(gladys, config, { clientFactory, knownHosts = [] }) {
  // A broadcast cannot carry SNMPv3 (each agent has its own engine id): with
  // v3 configured, the scan still finds the agents that also answer v2c.
  const version = config.version === '1' ? '1' : '2c';
  const replies = await gladys.scanNetwork('udp-active-broadcast', {
    port: DISCOVERY_PORT,
    payload: encodeGetRequest({
      version,
      community: config.community || DEFAULT_COMMUNITY,
      oids: [SYSTEM.NAME],
      requestId: Math.floor(Math.random() * 0x7fffffff),
    }),
    timeoutSeconds: SCAN_SECONDS,
  });

  const known = new Set(knownHosts);
  const hosts = [
    ...new Set(
      (replies ?? [])
        .filter((reply) => isGetResponse(Buffer.from(reply.payload_base64 ?? '', 'base64')))
        .map((reply) => reply.source_ip)
        .filter((host) => host && !known.has(host)),
    ),
  ];
  logger.info(`Network scan: ${hosts.length} new agent(s) answered`);

  const { agents } = parseAgents(
    hosts.map((host) => ({ host, version, discovered: true })),
    config,
  );
  const found = [];
  const queue = [...agents];
  const workers = Array.from({ length: Math.min(PROBES_AT_ONCE, queue.length) }, async () => {
    while (queue.length > 0) {
      const agent = await probe(queue.shift(), config, clientFactory);
      if (agent) {
        found.push(agent);
      }
    }
  });
  await Promise.all(workers);
  return found.sort((a, b) => a.host.localeCompare(b.host, 'en', { numeric: true }));
}

/**
 * Ask a found agent its name and which profiles it can fill. An agent that
 * does not answer in unicast is dropped: Gladys could not poll it either.
 */
async function probe(agent, config, clientFactory) {
  const client = clientFactory(agent, config);
  try {
    const [name, battery] = await client.get([SYSTEM.NAME, UPS.BATTERY_STATUS]);
    const profiles = [PROFILES.SYSTEM];
    // A table has no fixed instance to GET: its first row tells.
    const cpus = await client.subtree(HOST.PROCESSOR_LOAD, 1).catch(() => []);
    if (cpus.length > 0) {
      profiles.push(PROFILES.HOST);
    }
    if (isPresent(battery)) {
      profiles.push(PROFILES.UPS);
    }
    const sysName = (isPresent(name) && toText(name)?.trim()) || '';
    return { ...agent, name: sysName || agent.host, profiles };
  } catch (err) {
    logger.debug(`Network scan: ${agent.host} did not answer in unicast: ${describeError(err)}`);
    return null;
  } finally {
    client.close();
  }
}

/**
 * The discovered agents the user created: rebuilt from their devices, with
 * the credentials of the configuration.
 *
 * @param {object} gladys the SDK instance
 * @param {Array<object>} devices the devices created in Gladys
 * @param {object} config normalized configuration
 */
export function agentsFromDevices(gladys, devices, config) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  const entries = devices
    .filter((device) => device.external_id?.startsWith(prefix) && param(device, 'discovered'))
    .map((device) => ({
      id: device.external_id.slice(prefix.length),
      name: device.name,
      host: param(device, 'host'),
      port: param(device, 'port'),
      version: param(device, 'version'),
      profiles: String(param(device, 'profiles') ?? '').split('+'),
      discovered: true,
    }));
  const { agents, problems } = parseAgents(entries, config);
  for (const problem of problems) {
    logger.warn(`Discovered device: ${problem}`);
  }
  return agents;
}

function param(device, name) {
  return device.params?.find((entry) => entry.name === name)?.value;
}
