# SNMP — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com)
to the equipment of your network over **SNMP** (v1, v2c, v3): switches,
routers, Wi-Fi access points, NAS, servers, UPS, PDUs, printers.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js),
the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and [`net-snmp`](https://github.com/markabrahams/node-net-snmp).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) · [Deutsch](./docs/de.md) ·
[Español](./docs/es.md).

## What it does

One Gladys device per SNMP agent, with:

| Profile      | Gladys features                                                                         | MIB                |
| ------------ | --------------------------------------------------------------------------------------- | ------------------ |
| (always)     | Reachable, response time (ms), uptime (days)                                            | SNMPv2-MIB         |
| `interfaces` | Per interface: link up, in rate, out rate (kbit/s, 64-bit counters when available)      | IF-MIB             |
| `host`       | CPU load, memory used, fullest disk (%)                                                 | HOST-RESOURCES-MIB |
| `ups`        | Battery charge, runtime, battery low, mains power, input voltage, load, output power    | UPS-MIB (RFC 1628) |
| custom OIDs  | Any OID, with its Gladys category, unit and scale — writable ones become switches (SET) | any                |

Since Gladys 5.1 it also extends the scene editor and the dashboard
(`src/capabilities/`):

- **triggers** — an agent stops answering, answers again, an interface goes up
  or down (one event per change);
- **actions** — read an SNMP value, write an SNMP value, poll an agent now;
- **widget** — "SNMP agents": agents up, one status row per agent, the live
  values of one agent, and a "Poll now" button.

The Configuration screen has three buttons: **Test the connection**, **List
the interfaces** of an agent, **Walk an OID**.

Agents are found by the **Scan** of the Discovery tab, or declared in the
configuration — a short form (`192.168.1.10;NAS;host, 192.168.1.20;UPS;ups`)
or a JSON list for interfaces, custom OIDs and per-agent credentials. See
[the user documentation](./docs/en.md#automatic-discovery).

## How it talks to the hardware

One transport, declared in the manifest: **local**. The integration sends SNMP
requests (UDP 161) straight from its container to the agents of the LAN — no
cloud, no relay. Each device reports a `local` badge while it answers,
`unreachable` once it stops (`publishTransports`).

A poll reads the system group first (its answer time is the "response time",
no answer is "unreachable"), then what the profiles and custom OIDs need, and
publishes only the values that changed (`publishChangedStates`, with a
30-minute heartbeat). Gladys polls every minute at most; a slower refresh
interval is applied by skipping polls.

The scan is the one exception to "straight from the container": a broadcast
sent from the container never leaves the Docker bridge, so the Gladys core
sends it (`scanNetwork('udp-active-broadcast')`, port 161 declared in the
manifest `network_discovery`). The integration forges the SNMP GET of
`sysName` with the community, the core broadcasts it and relays the answers;
each agent that answered is then asked in unicast for its name and its
profiles. A created discovered device keeps its host, port, version and
profiles in its params (never a credential): that is how it is polled again
after a restart.

## Project structure

```
.
├─ index.js                          # SDK bootstrap
├─ src/
│  ├─ app.js                         # wiring: SDK handlers -> the code below
│  ├─ config.js                      # defaults + agent list parser (short form, JSON, custom OIDs)
│  ├─ actions.js                     # Configuration screen buttons
│  ├─ logging.js                     # "Detailed logs" switch
│  ├─ i18n.js                        # languages of user-facing text (en, fr, de, es)
│  ├─ snmp/
│  │  ├─ client.js                   #   net-snmp: get / subtree / set (v1, v2c, v3)
│  │  ├─ broadcast.js                #   the GET the network scan broadcasts
│  │  ├─ oids.js                     #   standard OIDs
│  │  └─ values.js                   #   varbinds -> numbers / texts, counter rates
│  ├─ agents/
│  │  ├─ device.js                   #   one agent -> one Gladys device
│  │  ├─ discovery.js                #   network scan, discovered agents rebuilt from devices
│  │  └─ monitor.js                  #   polling, states, transitions, SET
│  └─ capabilities/                  # Gladys 5.1: scenes and dashboard
│     ├─ scenes.js                   #   triggers + scene actions
│     └─ widget.js                   #   the "SNMP agents" widget
├─ docs/                             # user documentation (en, fr, de, es), re-hosted by Gladys
├─ test/                             # node --test, fake Gladys + fake SNMP agent
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for contributors and coding assistants
├─ SECURITY.md                       # how to report a vulnerability
└─ .github/                          # CI, release, GitHub releases, Dependabot
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="snmp" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs the first three on Node 22 and 24, on
every push to `main` and every pull request; pull requests also run the store
checks and build the Docker image.

Tests never touch the network: `test/helpers/fakeAgent.js` replaces the SNMP
client, and the SDK's `createFakeGladys()` replaces Gladys and refuses what
Gladys refuses (unknown category, unit, poll frequency…).
`test/client.test.js` is the exception: it checks the real client against a
real net-snmp agent, on 127.0.0.1 only.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json` and the manifest (`version` + `docker_image`),
moves the changelog section under the version, tags `vX.Y.Z`, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-snmp`
(`:X.Y.Z` and `:latest`), and publishes the GitHub Release with that changelog
section as notes. The decentralized indexer of the Gladys store picks up the
new version — the repository carries the `gladys-assistant-integration` topic.

## License

Apache-2.0
