// -----------------------------------------------------------------------------
// The buttons of the Configuration screen (manifest `actions`).
//
//   test_connection   ask every agent its system group, report what answered
//   list_interfaces   the interfaces of an agent: index, name, link — what to
//                     put in its "interfaces" list
//   walk_oid          the objects under an OID, to find the one to monitor
//
// They answer in the four languages of the interface (src/i18n.js): the
// resolved object is displayed under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isOid } from './config.js';
import { describeError } from './snmp/client.js';
import { toText } from './snmp/values.js';
import { localize, pick } from './i18n.js';
import { agentOf } from './capabilities/scenes.js';

const logger = createLogger({ name: 'actions' });

/** An action message is shown in a small box: keep it readable. */
const MAX_LINES = 40;

export function createActions(monitor) {
  return {
    async test_connection(gladys, { config }) {
      const problems = config.agentProblems;
      if (config.snmpAgents.length === 0) {
        return {
          en: 'No SNMP agent configured: fill in the "SNMP agents" field and save.',
          fr: 'Aucun agent SNMP configuré : remplissez le champ « Agents SNMP » et enregistrez.',
          de: 'Kein SNMP-Agent konfiguriert: Fülle das Feld „SNMP-Agenten“ aus und speichere.',
          es: 'Ningún agente SNMP configurado: rellene el campo «Agentes SNMP» y guarde.',
        };
      }
      await monitor.pollAll(gladys, config);
      const lines = config.snmpAgents.map((agent) => {
        const state = monitor.stateOf(agent);
        return (language) =>
          state.reachable
            ? `✔ ${agent.name} (${agent.host}) — ${state.rtt} ms — ${clip(
                state.sysName || state.sysDescr || '',
                80,
              )}`
            : `✘ ${agent.name} (${agent.host}) — ${pick(language, {
                en: 'no answer',
                fr: 'pas de réponse',
                de: 'keine Antwort',
                es: 'sin respuesta',
              })}: ${state.error}`;
      });
      const up = config.snmpAgents.filter((agent) => monitor.stateOf(agent).reachable).length;
      return localize((language) =>
        [
          pick(language, {
            en: `${up} of ${config.snmpAgents.length} agents answered.`,
            fr: `${up} agent(s) sur ${config.snmpAgents.length} ont répondu.`,
            de: `${up} von ${config.snmpAgents.length} Agenten haben geantwortet.`,
            es: `${up} de ${config.snmpAgents.length} agentes respondieron.`,
          }),
          ...lines.map((line) => line(language)),
          ...problems.map(
            (problem) =>
              `⚠ ${pick(language, {
                en: 'Agent list',
                fr: 'Liste des agents',
                de: 'Agentenliste',
                es: 'Lista de agentes',
              })}: ${problem}`,
          ),
        ].join('\n'),
      );
    },

    async list_interfaces(gladys, { fields, config }) {
      const agent = agentOf(gladys, config, fields.device);
      let interfaces;
      try {
        interfaces = await monitor.listInterfaces(agent, config);
      } catch (err) {
        logger.warn(`list_interfaces on ${agent.name}: ${describeError(err)}`);
        return failure(agent, err);
      }
      if (interfaces.length === 0) {
        return {
          en: `${agent.name} lists no interface (IF-MIB).`,
          fr: `${agent.name} ne liste aucune interface (IF-MIB).`,
          de: `${agent.name} listet keine Schnittstelle auf (IF-MIB).`,
          es: `${agent.name} no lista ninguna interfaz (IF-MIB).`,
        };
      }
      const rows = interfaces
        .slice(0, MAX_LINES)
        .map(
          (entry) =>
            `${entry.up ? '▲' : '▽'} ${entry.index} — ${entry.name ?? entry.descr}` +
            (entry.name && entry.descr && entry.descr !== entry.name
              ? ` (${clip(entry.descr, 50)})`
              : ''),
        );
      return localize((language) =>
        [
          pick(language, {
            en: `${interfaces.length} interfaces on ${agent.name} (▲ link up). Put the index or the name in its "interfaces" list:`,
            fr: `${interfaces.length} interfaces sur ${agent.name} (▲ lien actif). Mettez l'index ou le nom dans sa liste "interfaces" :`,
            de: `${interfaces.length} Schnittstellen auf ${agent.name} (▲ Link aktiv). Trage den Index oder den Namen in seine Liste "interfaces" ein:`,
            es: `${interfaces.length} interfaces en ${agent.name} (▲ enlace activo). Ponga el índice o el nombre en su lista "interfaces":`,
          }),
          ...rows,
        ].join('\n'),
      );
    },

    async walk_oid(gladys, { fields, config }) {
      const agent = agentOf(gladys, config, fields.device);
      const oid = String(fields.oid || '1.3.6.1.2.1.1')
        .trim()
        .replace(/^\./, '');
      if (!isOid(oid)) {
        return {
          en: `"${fields.oid}" is not a numeric OID (e.g. 1.3.6.1.2.1.1).`,
          fr: `« ${fields.oid} » n'est pas un OID numérique (ex. 1.3.6.1.2.1.1).`,
          de: `„${fields.oid}“ ist keine numerische OID (z. B. 1.3.6.1.2.1.1).`,
          es: `«${fields.oid}» no es un OID numérico (p. ej. 1.3.6.1.2.1.1).`,
        };
      }
      const limit = Math.max(1, Math.min(MAX_LINES, Math.trunc(Number(fields.limit) || 20)));
      let varbinds;
      try {
        varbinds = await monitor.walk(agent, config, oid, limit);
      } catch (err) {
        logger.warn(`walk_oid on ${agent.name}: ${describeError(err)}`);
        return failure(agent, err);
      }
      if (varbinds.length === 0) {
        return {
          en: `Nothing under ${oid} on ${agent.name}.`,
          fr: `Rien sous ${oid} sur ${agent.name}.`,
          de: `Nichts unter ${oid} auf ${agent.name}.`,
          es: `Nada bajo ${oid} en ${agent.name}.`,
        };
      }
      return varbinds
        .map((varbind) => `${varbind.oid} = ${clip(toText(varbind) ?? '', 100)}`)
        .join('\n');
    },
  };
}

export const ACTION_KEYS = ['test_connection', 'list_interfaces', 'walk_oid'];

function failure(agent, err) {
  const reason = describeError(err);
  return {
    en: `${agent.name} (${agent.host}) did not answer: ${reason}.`,
    fr: `${agent.name} (${agent.host}) n'a pas répondu : ${reason}.`,
    de: `${agent.name} (${agent.host}) hat nicht geantwortet: ${reason}.`,
    es: `${agent.name} (${agent.host}) no respondió: ${reason}.`,
  };
}

function clip(text, length) {
  const value = String(text).replace(/\s+/g, ' ').trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
