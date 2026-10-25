// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills in the `config_schema` of `gladys-assistant-integration.json`;
// the SDK hands it over through `getConfig()` and `onConfigUpdated()`. This
// module applies the defaults and turns the "SNMP agents" field — free text
// pasted by a human — into a clean list of agents, with the problems found on
// the way, so the rest of the code never deals with `undefined` or a typo.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (see test/manifest.test.js).
export const DEFAULT_CONFIG = {
  agents: '',
  community: '',
  version: '2c',
  v3_user: '',
  v3_auth_protocol: 'sha',
  v3_auth_key: '',
  v3_priv_protocol: 'aes',
  v3_priv_key: '',
  timeout: 3,
  retries: 1,
  poll_frequency: 60,
  debug_logs: false,
};

/** Community used when neither the agent nor the configuration names one. */
export const DEFAULT_COMMUNITY = 'public';

export const SNMP_VERSIONS = ['1', '2c', '3'];
export const AUTH_PROTOCOLS = ['none', 'md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512'];
export const PRIV_PROTOCOLS = ['none', 'des', 'aes', 'aes256b', 'aes256r'];

/**
 * The built-in groups of features an agent can expose. `system` is always on:
 * reachability, response time and uptime are what every agent answers.
 */
export const PROFILES = {
  SYSTEM: 'system',
  INTERFACES: 'interfaces',
  HOST: 'host',
  UPS: 'ups',
};

/** The SNMP types a custom OID can be written with. */
export const SET_TYPES = ['integer', 'unsigned', 'gauge', 'string'];

// Bounds of the numbers typed in the configuration screen.
const LIMITS = {
  timeout: [1, 30],
  retries: [0, 5],
  poll_frequency: [60, 3600],
};

const CATEGORIES = Object.values(DEVICE_FEATURE_CATEGORIES);
const TYPES = Object.values(DEVICE_FEATURE_TYPES).flatMap((types) => Object.values(types));
const UNITS = Object.values(DEVICE_FEATURE_UNITS);

/**
 * Merge the user config with the defaults, force the types, and parse the
 * agent list.
 *
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...withoutEmpty(raw) };
  config.version = SNMP_VERSIONS.includes(String(config.version))
    ? String(config.version)
    : DEFAULT_CONFIG.version;
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    config[key] = clamp(Number(config[key]), min, max, DEFAULT_CONFIG[key]);
  }
  config.community = String(config.community ?? '').trim();
  config.v3_user = String(config.v3_user ?? '').trim();
  config.v3_auth_protocol = oneOf(config.v3_auth_protocol, AUTH_PROTOCOLS, 'sha');
  config.v3_priv_protocol = oneOf(config.v3_priv_protocol, PRIV_PROTOCOLS, 'aes');
  config.debug_logs = config.debug_logs === true || config.debug_logs === 'true';

  const { agents, problems } = parseAgents(config.agents, config);
  config.snmpAgents = agents;
  config.agentProblems = problems;
  return config;
}

/**
 * Parse the "SNMP agents" field.
 *
 * Two shapes are accepted, because the field is typed by hand:
 *   - JSON: an array of agents, a single agent, or `{ "agents": [...] }`;
 *   - the short form, agents separated by commas or line breaks:
 *       `host[:port][;name[;profile+profile]]`
 *     e.g. `192.168.1.10;NAS;host, 192.168.1.20;UPS;ups`.
 *
 * @param {unknown} text the raw field
 * @param {object} defaults the normalized configuration (global SNMP settings)
 * @returns {{ agents: Array<object>, problems: Array<string> }}
 */
export function parseAgents(text, defaults = DEFAULT_CONFIG) {
  const problems = [];
  const entries = readEntries(text, problems);
  const agents = [];
  const ids = new Set();

  entries.forEach((entry, index) => {
    const agent = normalizeAgent(entry, index, defaults, problems);
    if (!agent) {
      return;
    }
    if (ids.has(agent.id)) {
      problems.push(`Agent #${index + 1}: the id "${agent.id}" is used twice, entry ignored`);
      return;
    }
    ids.add(agent.id);
    agents.push(agent);
  });
  return { agents, problems };
}

function readEntries(text, problems) {
  if (Array.isArray(text)) {
    return text;
  }
  if (text && typeof text === 'object') {
    return Array.isArray(text.agents) ? text.agents : [text];
  }
  const value = String(text ?? '').trim();
  if (!value) {
    return [];
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return readEntries(JSON.parse(value), problems);
    } catch (err) {
      problems.push(`The agent list is not valid JSON: ${err.message}`);
      return [];
    }
  }
  // The configuration field is a single line in most forms: a comma separates
  // the agents as well as a line break does.
  return value
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(parseLine);
}

/**
 * One agent of the short form: `host[:port][;name[;profiles]]`. Profiles are
 * separated by `+` or spaces (the comma already separates the agents).
 */
export function parseLine(line) {
  const [address = '', name, profiles] = line.split(';').map((part) => part.trim());
  const { host, port } = splitHostPort(address);
  return {
    host,
    port,
    name: name || undefined,
    profiles: profiles ? profiles.split(/[\s+]+/).filter(Boolean) : undefined,
  };
}

/** `192.168.1.2:1161` → host + port; `[fe80::1]:161` and bare IPv6 too. */
export function splitHostPort(address) {
  const bracketed = address.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    return { host: bracketed[1], port: bracketed[2] ? Number(bracketed[2]) : undefined };
  }
  const parts = address.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: Number(parts[1]) };
  }
  return { host: address, port: undefined };
}

function normalizeAgent(entry, index, defaults, problems) {
  const where = `Agent #${index + 1}`;
  if (!entry || typeof entry !== 'object') {
    problems.push(`${where}: not an object, ignored`);
    return null;
  }
  const host = String(entry.host ?? entry.ip ?? entry.address ?? '').trim();
  if (!host) {
    problems.push(`${where}: no "host", ignored`);
    return null;
  }
  if (/\s|\//.test(host)) {
    problems.push(`${where}: "${host}" is not a host name or an IP address, ignored`);
    return null;
  }

  const port = Number(entry.port ?? 161);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`${where}: port "${entry.port}" is invalid, ignored`);
    return null;
  }

  const version = String(entry.version ?? defaults.version ?? '2c').toLowerCase();
  if (!SNMP_VERSIONS.includes(version)) {
    problems.push(`${where}: SNMP version "${entry.version}" unknown (1, 2c or 3), ignored`);
    return null;
  }

  // The id is what the Gladys device is keyed on: it must survive a rename. A
  // host that changes (new IP address) is a new device unless "id" pins it.
  const id = sanitizeId(entry.id ?? (port === 161 ? host : `${host}-${port}`));

  const profiles = new Set([PROFILES.SYSTEM]);
  for (const profile of [entry.profiles ?? entry.profile ?? []].flat()) {
    const name = String(profile).trim().toLowerCase();
    if (Object.values(PROFILES).includes(name)) {
      profiles.add(name);
    } else if (name) {
      problems.push(`${where}: profile "${profile}" unknown, ignored`);
    }
  }

  const interfaces = [entry.interfaces ?? []]
    .flat()
    .map((token) => String(token).trim())
    .filter(Boolean)
    .slice(0, 16);
  if (interfaces.length > 0) {
    profiles.add(PROFILES.INTERFACES);
  }

  const oids = [entry.oids ?? []]
    .flat()
    .map((oid, oidIndex) => normalizeOid(oid, `${where}, OID #${oidIndex + 1}`, problems))
    .filter(Boolean);
  const keys = new Set();
  const uniqueOids = oids.filter((oid) => {
    if (keys.has(oid.key)) {
      problems.push(`${where}: the OID key "${oid.key}" is used twice, the second one ignored`);
      return false;
    }
    keys.add(oid.key);
    return true;
  });

  const refresh = entry.refresh === undefined ? null : Number(entry.refresh);
  const wake = wakeTarget(entry, where, problems);

  return {
    id,
    name: String(entry.name ?? host).trim() || host,
    host,
    port,
    version,
    community: String(entry.community ?? defaults.community ?? '').trim() || DEFAULT_COMMUNITY,
    v3: version === '3' ? v3User(entry, defaults) : null,
    profiles: [...profiles],
    interfaces,
    oids: uniqueOids,
    refresh: Number.isFinite(refresh) && refresh >= 60 ? refresh : null,
    // Wake-on-LAN of the machine behind the agent (a NAS, a server): its MAC
    // address, and the broadcast address to send the magic packet to.
    mac: wake.mac,
    wakeAddress: wake.address,
    // Found by the network scan rather than typed in the list: its device
    // carries what it takes to rebuild it (see src/agents/discovery.js).
    discovered: entry.discovered === true || entry.discovered === 'true',
  };
}

/**
 * The Wake-on-LAN target of an agent: `mac` (`aa:bb:cc:dd:ee:ff`, with `:`,
 * `-` or nothing between the bytes) and the optional `wake_address`, an IPv4
 * broadcast address for a machine that ignores the limited broadcast.
 */
function wakeTarget(entry, where, problems) {
  const target = { mac: null, address: null };
  if (entry.mac !== undefined && entry.mac !== null && entry.mac !== '') {
    target.mac = normalizeMac(entry.mac);
    if (!target.mac) {
      problems.push(`${where}: "${entry.mac}" is not a MAC address, Wake-on-LAN disabled`);
    }
  }
  if (target.mac && entry.wake_address !== undefined && entry.wake_address !== '') {
    const address = String(entry.wake_address).trim();
    if (isIpv4(address)) {
      target.address = address;
    } else {
      problems.push(`${where}: "${entry.wake_address}" is not an IPv4 address, ignored`);
    }
  }
  return target;
}

/** `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff`, `aabbccddeeff` → `aa:bb:cc:dd:ee:ff`, else null. */
export function normalizeMac(value) {
  const hex = String(value).trim().toLowerCase().replace(/[:.-]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) {
    return null;
  }
  return hex.match(/../g).join(':');
}

function isIpv4(address) {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function v3User(entry, defaults) {
  const authProtocol = oneOf(
    entry.auth_protocol ?? defaults.v3_auth_protocol,
    AUTH_PROTOCOLS,
    'sha',
  );
  const privProtocol = oneOf(
    entry.priv_protocol ?? defaults.v3_priv_protocol,
    PRIV_PROTOCOLS,
    'aes',
  );
  const authKey = String(entry.auth_key ?? defaults.v3_auth_key ?? '');
  const privKey = String(entry.priv_key ?? defaults.v3_priv_key ?? '');
  // The security level follows from what was given: no key, no authentication.
  const auth = authProtocol !== 'none' && authKey !== '';
  const priv = auth && privProtocol !== 'none' && privKey !== '';
  return {
    user: String(entry.user ?? defaults.v3_user ?? '').trim(),
    level: priv ? 'authPriv' : auth ? 'authNoPriv' : 'noAuthNoPriv',
    authProtocol,
    authKey,
    privProtocol,
    privKey,
    context: String(entry.context ?? ''),
  };
}

/**
 * A custom OID, as the user declares it in the agent's `oids` list.
 *
 * `{ "oid": "1.3.6.1.4.1.2021.10.1.3.1", "name": "Load 1 min" }` is enough: a
 * read-only number. `category` / `type` / `unit` make it a proper Gladys
 * feature (a temperature, a power…), `scale` converts the raw value (0.1 for
 * tenths of a degree), and `writable` with `on` / `off` turns it into a switch
 * written with an SNMP SET — a PDU outlet, a PoE port.
 */
export function normalizeOid(raw, where, problems) {
  const entry = typeof raw === 'string' ? { oid: raw } : raw;
  if (!entry || typeof entry !== 'object') {
    problems.push(`${where}: not an object, ignored`);
    return null;
  }
  const oid = String(entry.oid ?? '')
    .trim()
    .replace(/^\./, '');
  if (!isOid(oid)) {
    problems.push(`${where}: "${entry.oid}" is not a numeric OID, ignored`);
    return null;
  }
  const writable = entry.writable === true;
  const binary = writable || entry.on !== undefined || entry.off !== undefined;

  const { SWITCH, INPUT, UNKNOWN } = DEVICE_FEATURE_CATEGORIES;
  const defaultCategory = writable ? SWITCH : binary ? INPUT : UNKNOWN;
  let category = entry.category ?? defaultCategory;
  let type =
    entry.type ??
    (binary ? DEVICE_FEATURE_TYPES.SWITCH.BINARY : DEVICE_FEATURE_TYPES.SENSOR.UNKNOWN);
  if (!CATEGORIES.includes(category) || !TYPES.includes(type)) {
    problems.push(`${where}: category "${category}" / type "${type}" unknown, shown as "unknown"`);
    category = UNKNOWN;
    type = DEVICE_FEATURE_TYPES.SENSOR.UNKNOWN;
  }
  let unit = entry.unit ?? null;
  if (unit !== null && !UNITS.includes(unit)) {
    problems.push(`${where}: unit "${unit}" unknown, ignored`);
    unit = null;
  }
  const setType = oneOf(entry.set_type, SET_TYPES, 'integer');
  const scale = Number(entry.scale ?? 1);

  return {
    key: sanitizeId(entry.key ?? oid.replace(/\./g, '-')),
    oid,
    name: String(entry.name ?? oid),
    category,
    type,
    unit,
    scale: Number.isFinite(scale) && scale !== 0 ? scale : 1,
    min: Number.isFinite(Number(entry.min)) ? Number(entry.min) : binary ? 0 : -1000000,
    max: Number.isFinite(Number(entry.max)) ? Number(entry.max) : binary ? 1 : 1000000,
    binary,
    on: entry.on ?? 1,
    off: entry.off ?? 0,
    writable,
    setType,
  };
}

export function isOid(value) {
  return /^\d+(\.\d+)+$/.test(String(value));
}

/** Lowercase, and only what an external id can carry. */
export function sanitizeId(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}

function withoutEmpty(raw) {
  // An empty optional field arrives as '' or null: it means "the default".
  return Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, value]) => value !== '' && value !== null),
  );
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function oneOf(value, list, fallback) {
  const text = String(value ?? '').toLowerCase();
  return list.includes(text) ? text : fallback;
}
