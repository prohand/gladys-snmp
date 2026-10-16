# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.0] - 2026-10-16

### Added

- Automatic discovery: the **Scan** of the Discovery tab finds the SNMP agents
  of the local network (an SNMP GET broadcast through the Gladys core, port
  161, v1/v2c with the configured community) and picks their `host` / `ups`
  profiles. Created, they are polled without being added to the agent list.

## [1.0.1] - 2026-10-14

### Added

- SNMP agents read over the local network, SNMP v1, v2c and v3 (authNoPriv and
  authPriv, MD5/SHA, DES/AES), declared in a short form
  (`host;name;profiles`) or as a JSON list.
- One Gladys device per agent: reachable, response time and uptime, a
  `local` / `unreachable` transport badge.
- Profiles: `interfaces` (link state, in/out rate from the 64-bit counters,
  interfaces named or numbered), `host` (CPU, memory, fullest disk —
  HOST-RESOURCES-MIB), `ups` (charge, runtime, battery low, mains power, input
  voltage, load, output power — UPS-MIB).
- Custom OIDs per agent, with their Gladys category, unit and scale, and
  writable ones (a PDU outlet, a PoE port) driven as switches through an SNMP
  SET.
- Configuration screen actions: test the connection, list the interfaces of an
  agent, walk an OID.
- Scene triggers (Gladys 5.1+): an agent stops answering, answers again, an
  interface goes up or down.
- Scene actions (Gladys 5.1+): read an SNMP value, write an SNMP value, poll an
  agent now.
- The "SNMP agents" dashboard widget (Gladys 5.1+): agents up, one status row
  per agent, the live values of one agent, and a "Poll now" button.
- User interface and documentation in English, French, German and Spanish.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build), the
  UI-driven Release workflow, GitHub Releases and Dependabot.
- `SECURITY.md` and `CLAUDE.md`.

[Unreleased]: https://github.com/prohand/gladys-snmp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/prohand/gladys-snmp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/prohand/gladys-snmp/releases/tag/v1.0.1
