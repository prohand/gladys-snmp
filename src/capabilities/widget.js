// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): the SNMP agents, at a glance.
//
// Without it, "is everything up?" means opening every device. The `agents`
// widget answers on the dashboard: how many agents answer, one status row per
// agent with its response time, and — when the instance picks one agent — its
// live tiles (response time, uptime, CPU, battery…), bound to the device
// features so they follow the published states with no refresh.
//
// The content is declarative (the core renders it, no HTML). Budget: at most
// 6 tiles, 1 status list (10 rows), 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { PROFILES } from '../config.js';
import { FEATURES, idsFor, interfaceKeys } from '../agents/device.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'widget' });

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const AGENTS_WIDGET = 'agents';

/** The widget buttons. */
export const WIDGET_ACTIONS = { POLL_NOW: 'poll_now' };

const DOCS_URL = 'https://github.com/prohand/gladys-snmp/blob/main/docs/en.md';

/** The status list holds 10 rows at most. */
const MAX_ROWS = 10;

/**
 * The content of the `agents` widget.
 *
 * @param {object} gladys the SDK instance (for the external ids)
 * @param {object} config normalized configuration
 * @param {object} monitor the agent monitor (src/agents/monitor.js)
 * @param {object} [settings] the instance settings (`device`: one agent)
 */
export function buildAgentsWidget(gladys, config, monitor, settings = {}) {
  const agents = config.snmpAgents;
  const components = [];

  if (agents.length === 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: 'No SNMP agent yet: fill in the configuration.',
        fr: 'Aucun agent SNMP : remplissez la configuration.',
        de: 'Noch kein SNMP-Agent: Fülle die Konfiguration aus.',
        es: 'Aún no hay agentes SNMP: rellene la configuración.',
      },
    });
    components.push(docsButton());
    return { ttl_seconds: 300, components };
  }

  const states = agents.map((agent) => ({ agent, state: monitor.stateOf(agent) }));
  const up = states.filter(({ state }) => state.reachable === true).length;
  const down = states.filter(({ state }) => state.reachable === false).length;

  components.push({
    type: 'value',
    value: `${up}/${agents.length}`,
    label: { en: 'Agents up', fr: 'Agents actifs', de: 'Agenten aktiv', es: 'Agentes activos' },
    icon: 'server',
    color: down > 0 ? WIDGET_COLORS.DANGER : up > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
  });

  const focused = agents.find((agent) => idsFor(gladys, agent).device === settings?.device);
  if (focused) {
    components.push(...liveTiles(gladys, focused));
  } else {
    const rtts = states.map(({ state }) => state.rtt).filter((rtt) => rtt !== null);
    components.push({
      type: 'value',
      value: rtts.length > 0 ? Math.max(...rtts) : '—',
      unit: rtts.length > 0 ? 'ms' : undefined,
      label: {
        en: 'Slowest answer',
        fr: 'Réponse la + lente',
        de: 'Langsamste Antwort',
        es: 'Respuesta más lenta',
      },
      icon: 'clock',
    });
  }

  components.push({
    type: 'status',
    items: states.slice(0, MAX_ROWS).map(({ agent, state }) => statusRow(agent, state)),
  });

  components.push(
    {
      type: 'button',
      label: { en: 'Poll now', fr: 'Interroger', de: 'Jetzt abfragen', es: 'Consultar ya' },
      icon: 'refresh-cw',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.POLL_NOW },
    },
    docsButton(),
  );

  // Data moves with the polls: a minute is the fastest Gladys polls.
  return { ttl_seconds: 60, components: components.map(dropUndefined) };
}

/** Live tiles of one agent, bound to its features (up to 4). */
function liveTiles(gladys, agent) {
  const ids = idsFor(gladys, agent);
  const tile = (key, label, icon) => ({
    type: 'value',
    device_feature: ids.feature(key),
    label,
    icon,
  });
  const tiles = [
    tile(
      FEATURES.RESPONSE_TIME,
      { en: 'Response time', fr: 'Temps de réponse', de: 'Antwortzeit', es: 'Tiempo de respuesta' },
      'activity',
    ),
    tile(
      FEATURES.UPTIME,
      { en: 'Uptime', fr: 'Uptime', de: 'Laufzeit', es: 'Tiempo activo' },
      'clock',
    ),
  ];
  if (agent.profiles.includes(PROFILES.HOST)) {
    tiles.push(
      tile(FEATURES.CPU_LOAD, { en: 'CPU', fr: 'CPU', de: 'CPU', es: 'CPU' }, 'cpu'),
      tile(
        FEATURES.MEMORY_USED,
        { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
        'layers',
      ),
    );
  }
  if (agent.profiles.includes(PROFILES.UPS)) {
    tiles.push(
      tile(
        FEATURES.UPS_CHARGE,
        { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
        'battery',
      ),
      tile(
        FEATURES.UPS_RUNTIME,
        { en: 'Runtime', fr: 'Autonomie', de: 'Laufzeit Akku', es: 'Autonomía' },
        'zap',
      ),
    );
  }
  if (agent.profiles.includes(PROFILES.INTERFACES) && agent.interfaces.length > 0) {
    const keys = interfaceKeys(agent.interfaces[0]);
    tiles.push(
      tile(
        keys.in,
        {
          en: `${agent.interfaces[0]} in`,
          fr: `${agent.interfaces[0]} entrant`,
          de: `${agent.interfaces[0]} ein`,
          es: `${agent.interfaces[0]} entrada`,
        },
        'download',
      ),
      tile(
        keys.out,
        {
          en: `${agent.interfaces[0]} out`,
          fr: `${agent.interfaces[0]} sortant`,
          de: `${agent.interfaces[0]} aus`,
          es: `${agent.interfaces[0]} salida`,
        },
        'upload',
      ),
    );
  }
  // The content holds 8 components: the counter, these tiles, the status list
  // and the two buttons — 4 tiles fit.
  return tiles.slice(0, 4).map((entry) => ({
    ...entry,
    label: Object.fromEntries(
      Object.entries(entry.label).map(([language, text]) => [language, clip(text, 24)]),
    ),
  }));
}

function statusRow(agent, state) {
  const label = clip(agent.name, 40);
  if (state.reachable === true) {
    return { label, value: `${state.rtt} ms`, icon: 'check-circle', color: WIDGET_COLORS.SUCCESS };
  }
  if (state.reachable === false) {
    return {
      label,
      value: { en: 'unreachable', fr: 'injoignable', de: 'nicht erreichbar', es: 'inaccesible' },
      icon: 'x-circle',
      color: WIDGET_COLORS.DANGER,
    };
  }
  return {
    label,
    value: localize((language) =>
      pick(language, {
        en: 'not polled yet',
        fr: 'pas encore lu',
        de: 'noch nicht abgefragt',
        es: 'aún sin consultar',
      }),
    ),
    icon: 'help-circle',
    color: WIDGET_COLORS.NEUTRAL,
  };
}

function docsButton() {
  return {
    type: 'button',
    label: { en: 'Documentation', fr: 'Documentation', de: 'Dokumentation', es: 'Documentación' },
    icon: 'book-open',
    style: 'secondary',
    link: { url: DOCS_URL },
  };
}

/**
 * The widget handlers: `get` builds the content, `action` runs a button.
 */
export function createWidgets(monitor) {
  return {
    [AGENTS_WIDGET]: {
      async get(gladys, { settings, config }) {
        return buildAgentsWidget(gladys, config, monitor, settings);
      },
      async action(gladys, { actionKey, config }) {
        logger.info(`onWidgetAction <- ${AGENTS_WIDGET}.${actionKey}`);
        if (actionKey !== WIDGET_ACTIONS.POLL_NOW) {
          throw new Error(`Unknown widget action: ${actionKey}`);
        }
        await monitor.pollAll(gladys, config);
        const up = config.snmpAgents.filter((agent) => monitor.stateOf(agent).reachable).length;
        const total = config.snmpAgents.length;
        return {
          en: `${up}/${total} agents answered.`,
          fr: `${up}/${total} agents ont répondu.`,
          de: `${up}/${total} Agenten haben geantwortet.`,
          es: `${up}/${total} agentes respondieron.`,
        };
      },
    },
  };
}

/** Ask the core to re-pull the widgets now (after a config change, a reconnection). */
export function refreshWidgets(gladys) {
  gladys.requestWidgetRefresh(AGENTS_WIDGET);
}

function dropUndefined(component) {
  return Object.fromEntries(Object.entries(component).filter(([, value]) => value !== undefined));
}

function clip(text, length) {
  const value = String(text);
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
