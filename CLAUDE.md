# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step) that reads network
equipment over **SNMP** (v1, v2c, v3) on the local network: switches, routers, Wi-Fi access
points, NAS, servers, UPS, PDUs, printers. Each SNMP agent becomes one Gladys device. Gladys 5.1+
adds scene triggers (agent unreachable / recovered, interface up / down), scene actions (SNMP
GET, SNMP SET, poll now) and an "SNMP agents" dashboard widget.

Two runtime dependencies: `@gladysassistant/integration-sdk` and
[`net-snmp`](https://github.com/markabrahams/node-net-snmp) (pure JavaScript, no native build).

Agents are not discovered on the network: the user lists them in the configuration, in a short
form (`host[:port];name;profile+profile`, separated by commas) or as a JSON list (interfaces,
custom OIDs, per-agent credentials).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/monitor.test.js            # one file
node --test --test-name-pattern "wrap"      # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24; pull requests also run the store checks
and build the Docker image. Releases: **Actions → Release** only (bumps `package.json`, manifest
`version` + `docker_image`, rolls `CHANGELOG.md`, re-runs Prettier, tags, builds, publishes the
GitHub Release).

## Architecture

```
index.js                     SDK bootstrap only
src/app.js                   the wiring: SDK handlers -> the code below (testable with the fake Gladys)
src/config.js                defaults + the agent list parser (short form and JSON) + custom OIDs
src/i18n.js                  the languages of user-facing text: en, fr, de, es
src/logging.js               "Detailed logs" switch -> LOG_LEVEL
src/actions.js               Configuration screen buttons: test, list interfaces, walk an OID
src/snmp/client.js           net-snmp behind get / subtree / set / close (the only network code)
src/snmp/oids.js             standard OIDs: SNMPv2-MIB, IF-MIB, HOST-RESOURCES-MIB, UPS-MIB
src/snmp/values.js           varbind -> number / text, Counter64, counter rates and wraps
src/agents/device.js         one agent -> one Gladys device (features per profile + custom OIDs)
src/agents/monitor.js        poll, publish changed states, transitions, SET, walk
src/capabilities/scenes.js   scene triggers and scene actions (Gladys 5.1+)
src/capabilities/widget.js   the "SNMP agents" widget (Gladys 5.1+)
```

### Invariants worth knowing

- **External ids are forever.** A device is `agent:<id>`, `id` being the agent's `id` field or,
  by default, its host (`-port` when not 161). Feature keys (`reachable`, `if-eth0-in`,
  `oid-<key>`…), action, trigger, scene action and widget keys are stored by users: never rename
  them.
- **Polling**: devices are published with `should_poll: true` and
  `poll_frequency: EVERY_MINUTES` (an enum in ms; any other value rejects the WHOLE discovery
  batch). The configured `poll_frequency` / per-agent `refresh` are seconds, applied by skipping
  polls (`AgentMonitor.isDue`).
- **Reachability is the system group**: the GET of sysUpTime/sysName/sysDescr/sysLocation times
  the response and decides reachable / unreachable. A later failure (a profile the agent lacks)
  is logged and skipped, it never marks the agent down.
- **Triggers fire on transitions only** (one event per change): an agent already down at startup
  fires nothing. Scene actions never throw for an SNMP failure: they return `success: false` and
  `error`, and never fire a trigger (no loops).
- **States**: `publishChangedStates` with a 30-minute heartbeat — the host API takes 300 states a
  minute. Interface rates come from the 64-bit counters when present (32-bit ones wrap in 34 s
  at 1 Gbit/s); a counter going back is a wrap only near the top, a reboot otherwise.
- **Every feature declares `min` and `max`** (NOT NULL in Gladys), binary ones included.
- **Transport badge** per device: `local` when the agent answered, `unreachable` otherwise. The
  manifest declares `"transports": ["local"]`: SNMP never goes through a cloud.
- **Secrets**: communities and v3 keys are never logged, never put in a message or an event.
- **Tests never touch the network**: `test/helpers/fakeAgent.js` stands in for the client.
  `test/client.test.js` is the only one using real sockets, on 127.0.0.1 only, against a
  net-snmp agent.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` in sync with the code:
`DEFAULT_CONFIG`, action / scene action / widget handlers, the triggers the code fires and the
keys their events carry, the scene action outputs, the four languages of every text, the 10–100
character catalog description, and the `gladys_version` minimum (>= 5.1.0 for scenes and
widgets).

## Conventions

- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading: the
  Release workflow does.
- **Versions** belong to the Release workflow: never edit `version` in `package.json` or the
  manifest, nor the `docker_image` tag, by hand.
- **User-facing text** is `{ en, fr, de, es }` (built with `src/i18n.js` when it is assembled from
  parts); user docs in `docs/en.md`, `docs/fr.md`, `docs/de.md` and `docs/es.md`, kept in sync.
- **The container rootfs is read-only**: nothing is written outside `/data` (this integration
  writes nothing at all).
- Prettier formats, ESLint catches mistakes. Comments explain **why**, in English.
