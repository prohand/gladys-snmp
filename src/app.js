// -----------------------------------------------------------------------------
// The wiring: SDK handlers -> the SNMP code. No SNMP logic here.
//
// Kept out of index.js so the tests can run the whole integration against the
// fake Gladys of the SDK (`createFakeGladys`) with a fake SNMP client.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { applyLogLevel } from './logging.js';
import { createActions } from './actions.js';
import { buildDevice, idsFor, oidKey } from './agents/device.js';
import { AgentMonitor } from './agents/monitor.js';
import { agentsFromDevices, scanAgents } from './agents/discovery.js';
import { SceneEvents, createSceneActions } from './capabilities/scenes.js';
import { createWidgets, refreshWidgets } from './capabilities/widget.js';
import { createClient } from './snmp/client.js';

const logger = createLogger({ name: 'app' });

/**
 * Register every handler on the SDK instance. Call it before `connect()`.
 *
 * @param {object} gladys the SDK instance (or the fake one in the tests)
 * @param {object} [options]
 * @param {Function} [options.clientFactory] SNMP client factory (tests)
 * @param {() => number} [options.now] clock (tests)
 * @returns {{ monitor: AgentMonitor, getConfig: () => object }}
 */
export function registerHandlers(gladys, { clientFactory = createClient, now } = {}) {
  const monitor = new AgentMonitor({ clientFactory, now, sceneEvents: new SceneEvents() });
  const actions = createActions(monitor);
  const sceneActions = createSceneActions(monitor);
  const widgets = createWidgets(monitor);

  let config = normalizeConfig();
  // The agents of the typed list; `config.snmpAgents` adds the discovered
  // agents the user created, so the rest of the code sees one list.
  let listed = config.snmpAgents;
  // What the last network scan found, shown in the Discovery screen until the
  // user creates it (it is polled from then on).
  let found = [];

  function refreshAgents() {
    const ids = new Set(listed.map((agent) => agent.id));
    const created = agentsFromDevices(gladys, gladys.devices ?? [], config).filter(
      (agent) => !ids.has(agent.id),
    );
    config.snmpAgents = [...listed, ...created];
    monitor.retain(config.snmpAgents);
  }

  const publishDevices = () => {
    const ids = new Set(config.snmpAgents.map((agent) => agent.id));
    const agents = [...config.snmpAgents, ...found.filter((agent) => !ids.has(agent.id))];
    return gladys.publishDiscoveredDevices(agents.map((agent) => buildDevice(gladys, agent)));
  };

  async function applyConfig(raw) {
    config = normalizeConfig(raw);
    listed = config.snmpAgents;
    applyLogLevel(config);
    refreshAgents();
    for (const problem of config.agentProblems) {
      logger.warn(`Agent list: ${problem}`);
    }
    await publishDevices();
    await reportConnection();
    refreshWidgets(gladys);
    // A first read right away, so the widget and the badges are not empty
    // until Gladys polls. In the background: the connection must not wait
    // for an agent that times out.
    monitor
      .pollAll(gladys, config)
      .then(() => refreshWidgets(gladys))
      .catch((err) => logger.error('First poll failed', err));
  }

  async function reportConnection() {
    if (config.agentProblems.length > 0) {
      // Usable, but not what the user typed: say it where they look.
      await gladys.setConnectionStatus(false, {
        en: `Agent list: ${config.agentProblems[0]}`,
        fr: `Liste des agents : ${config.agentProblems[0]}`,
        de: `Agentenliste: ${config.agentProblems[0]}`,
        es: `Lista de agentes: ${config.agentProblems[0]}`,
      });
      return;
    }
    if (config.snmpAgents.length === 0) {
      await gladys.setConnectionStatus(false, {
        en: 'No SNMP agent configured yet: scan the network in the Discovery tab, or list them below.',
        fr: "Aucun agent SNMP configuré pour le moment : scannez le réseau dans l'onglet Découverte, ou listez-les ci-dessous.",
        de: 'Noch kein SNMP-Agent konfiguriert: Durchsuche das Netzwerk im Tab Erkennung oder liste sie unten auf.',
        es: 'Aún no hay ningún agente SNMP configurado: escanee la red en la pestaña Descubrimiento, o enumérelos abajo.',
      });
      return;
    }
    await gladys.setConnectionStatus(true);
  }

  const findAgent = (device) =>
    config.snmpAgents.find((agent) => idsFor(gladys, agent).device === device.external_id);

  // --- Discovery ---------------------------------------------------------------
  gladys.onScanRequest(async () => {
    try {
      found = await scanAgents(gladys, config, {
        clientFactory,
        knownHosts: config.snmpAgents.map((agent) => agent.host),
      });
    } catch (err) {
      // An older Gladys without network scans, or a second scan within 10 s:
      // the listed agents are still published.
      logger.warn(`Network scan failed: ${err.message}`);
    }
    await publishDevices();
  });

  // A discovered agent becomes polled once created, and stops once deleted.
  gladys.onDeviceCreated(async (device) => {
    refreshAgents();
    await reportConnection();
    const agent = findAgent(device);
    if (agent) {
      monitor
        .poll(gladys, agent, config)
        .then(() => refreshWidgets(gladys))
        .catch((err) => logger.error(`First poll of ${agent.name} failed`, err));
    }
  });

  gladys.onDeviceDeleted(async () => {
    refreshAgents();
    await reportConnection();
    refreshWidgets(gladys);
  });

  // --- Polling: Gladys polls every created device once a minute ------------------
  gladys.onPoll(async (device) => {
    const agent = findAgent(device);
    if (!agent) {
      logger.debug(`onPoll: ${device.external_id} is no longer in the agent list`);
      return;
    }
    if (monitor.isDue(agent, config)) {
      await monitor.poll(gladys, agent, config);
    }
  });

  // --- Commands: a writable custom OID (switch) ------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    const agent = findAgent(device);
    const oid = agent?.oids.find(
      (entry) => idsFor(gladys, agent).feature(oidKey(entry)) === feature.external_id,
    );
    if (!agent || !oid) {
      throw new Error(`No writable OID behind ${feature.external_id}`);
    }
    await monitor.setValue(gladys, agent, oid, value, config);
  });

  // --- Configuration screen buttons ---------------------------------------------
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, (fields) => handler(gladys, { fields, config }));
  }

  // --- Scene actions (Gladys 5.1+) ----------------------------------------------
  for (const [key, handler] of Object.entries(sceneActions)) {
    gladys.onSceneAction(key, (fields) => handler(gladys, { fields, config }));
  }

  // --- Dashboard widget (Gladys 5.1+) ---------------------------------------------
  for (const [key, widget] of Object.entries(widgets)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, config }));
    gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
      widget.action(gladys, { actionKey, params, settings, config }),
    );
  }

  // --- Configuration -------------------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    await applyConfig(newConfig);
  });

  gladys.on('connected', async () => {
    try {
      await applyConfig(await gladys.getConfig());
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen nach.',
          es: 'La inicialización falló, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  return { monitor, getConfig: () => config };
}
