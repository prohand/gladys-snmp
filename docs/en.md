# SNMP

This integration reads your network equipment over **SNMP** — switches,
routers, Wi-Fi access points, NAS, servers, UPS, PDUs, printers — and turns
each one into a Gladys device: is it up, how fast it answers, how long since
it rebooted, and the values you choose (port traffic, CPU, disks, battery,
any OID).

Everything stays on your local network: Gladys asks your devices directly
(UDP port 161), nothing goes through a cloud.

## Before you start

On each device, enable SNMP:

- **SNMP v2c** with a **read-only community** is the simplest. The community
  is a password: pick your own rather than `public`.
- **SNMP v3** encrypts the requests: create a user with SHA authentication and
  AES privacy (`authPriv`) if the device offers it.
- Allow the address of your Gladys server if the device filters who may ask.

Common places to find it: Synology _Control Panel → Terminal & SNMP_, QNAP
_Network & File Services → SNMP_, UniFi _Settings → System → SNMP_,
MikroTik _IP → SNMP_, a Linux server `snmpd` (`/etc/snmp/snmpd.conf`), an
Eaton or APC network card _Network → SNMP_.

## Configuration

Open the **Configuration** tab of the integration.

### SNMP agents

List the devices to read, separated by commas:

```
host[:port];name;profiles
```

For example:

```
192.168.1.1;Router, 192.168.1.10;NAS;host, 192.168.1.20;UPS;ups
```

- `host` — an IP address or a host name. A port other than 161 goes after a
  colon (`192.168.1.2:1161`), an IPv6 address between brackets
  (`[fe80::1]:161`).
- `name` — the name of the device in Gladys (the host if left out).
- `profiles` — what to read on top of the basics, joined with `+`
  (`host+ups`):
  - `host` — CPU load, memory used, fullest disk (HOST-RESOURCES-MIB: Linux,
    Windows, Synology, QNAP…);
  - `ups` — battery charge, runtime, battery low, mains power, input
    voltage, load and output power (UPS-MIB: Eaton, APC with a network card,
    most UPS cards);
  - `interfaces` — see the JSON form below.

### The JSON form

For interfaces, custom OIDs or credentials that differ from one device to
another, paste a JSON list instead:

```json
[
  {
    "name": "Office switch",
    "host": "192.168.1.2",
    "interfaces": [1, 2, "ge-0/0/24"]
  },
  {
    "id": "nas",
    "name": "NAS",
    "host": "192.168.1.10",
    "profiles": ["host"],
    "refresh": 300,
    "oids": [
      {
        "oid": "1.3.6.1.4.1.6574.1.2.0",
        "key": "temperature",
        "name": "System temperature",
        "category": "temperature-sensor",
        "type": "decimal",
        "unit": "celsius"
      }
    ]
  },
  {
    "name": "PDU",
    "host": "192.168.1.30",
    "community": "my-write-community",
    "oids": [
      {
        "oid": "1.3.6.1.4.1.318.1.1.12.3.3.1.1.4.1",
        "key": "outlet1",
        "name": "Outlet 1",
        "writable": true,
        "on": 1,
        "off": 2
      }
    ]
  }
]
```

Fields of an agent:

| Field                                                                       | Meaning                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `host`                                                                      | IP address or host name (required)                                                                                  |
| `port`                                                                      | UDP port, 161 by default                                                                                            |
| `name`                                                                      | name in Gladys                                                                                                      |
| `id`                                                                        | what Gladys keys the device on. Set it when the IP address may change: changing `id` or `host` creates a new device |
| `version`                                                                   | `1`, `2c` or `3` (the configuration's by default)                                                                   |
| `community`                                                                 | v1/v2c community of this device                                                                                     |
| `user`, `auth_protocol`, `auth_key`, `priv_protocol`, `priv_key`, `context` | SNMPv3 settings of this device                                                                                      |
| `profiles`                                                                  | `host`, `ups`, `interfaces`                                                                                         |
| `interfaces`                                                                | the interfaces to follow, by index or by name (up to 16)                                                            |
| `oids`                                                                      | your own OIDs, see below                                                                                            |
| `refresh`                                                                   | refresh interval of this device, in seconds (60 minimum)                                                            |

**Interfaces.** Each interface gives three features: link (1 = up), in rate
and out rate in kbit/s. Use **List the interfaces** (below) to find the
index or the name to write. Rates are computed between two polls, so they
show from the second one.

**Custom OIDs.** `oid` is the only required field: the value is shown as a
plain number. Add:

- `category`, `type`, `unit` — the Gladys feature (e.g.
  `temperature-sensor` / `decimal` / `celsius`, `energy-sensor` / `power` /
  `watt`); `text` / `text` shows a text;
- `scale` — multiplies the raw value (`0.1` for tenths of a degree);
- `on` / `off` — the raw values meaning on and off, for a binary feature;
- `writable: true` — makes it a switch Gladys can drive (an SNMP SET with
  `on` or `off`); `set_type` is `integer` (default), `unsigned` or `string`.
  This needs a **read-write** community on that device only;
- `key` — the stable name of the feature (by default, built from the OID);
- `min` / `max` — the range of the feature.

### SNMP access

- **SNMP version** — used by every agent that does not set its own.
- **Community** — v1/v2c, `public` if left empty.
- **SNMPv3** — user, authentication protocol and key, privacy protocol and
  key. The security level follows from what you fill in: a user alone is
  `noAuthNoPriv`, with an authentication key `authNoPriv`, with both keys
  `authPriv`.

### Polling

- **Refresh interval** — how often each device is read, 60 seconds at least
  (Gladys polls once a minute at most). Every value goes to the history: on a
  large network, prefer 300 seconds.
- **Timeout** and **Retries** — how long and how many times to wait for an
  answer before saying a device is unreachable.
- **Detailed logs** — log every SNMP failure, to understand a device that does
  not answer. Communities and keys are never logged.

Save: the devices show up in the **Discovery** tab, ready to be added.

## What you get

Every device has:

| Feature       | Meaning                                         |
| ------------- | ----------------------------------------------- |
| Reachable     | 1 when the device answers SNMP, 0 when it stops |
| Response time | time to answer, in milliseconds                 |
| Uptime        | days since the device (re)started               |

The device card also shows a **local** badge, or **unreachable** when the
device stopped answering.

## Actions

- **Test the connection** — reads every device now and says, for each one,
  whether it answered, how fast, and its system name. Mistakes in the agent
  list show here too.
- **List the interfaces** — the interfaces of a device: index, name, and ▲ for
  the ones with a link. Copy the index or the name into its `interfaces` list.
- **Walk an OID** — the objects under an OID (20 lines by default), to find the
  one to add to `oids`. `1.3.6.1.2.1.1` is the system group, `1.3.6.1.4.1` the
  vendor MIBs.

## Scenes and dashboard (Gladys 5.1)

### Triggers

- **An SNMP agent stops answering** — a device that answered missed the last
  poll. Variables: `device_name`, `host`, `error`.
- **An SNMP agent answers again** — variables: `device_name`, `host`,
  `downtime_minutes`.
- **A network interface goes up or down** — filter on up, down or both.
  Variables: `device_name`, `interface`, `status`.

They fire once per change, never on every poll. A device that is already off
when Gladys starts fires nothing.

For a threshold (a disk over 90 %, a battery under 30 %), use the usual
**device value** trigger of Gladys on the feature.

### Actions

- **Read an SNMP value** — one OID of a device. Outputs: `success`, `value`
  (text), `number`, `error`.
- **Write an SNMP value** — one OID, as an integer, unsigned or text: switch
  a PDU outlet off, reset a PoE port… Outputs: `success`, `error`.
- **Poll an SNMP agent now** — read a device without waiting. Outputs:
  `reachable`, `response_time`.

An action that fails never stops the scene: test `success` (or `reachable`)
in a condition after it.

### Widget

The **SNMP agents** widget shows how many devices answer, one row per device
with its response time, and a **Poll now** button. Pick a device in its
settings to also see its live values (response time, uptime, CPU, memory,
battery…).

## Troubleshooting

- **A device stays unreachable** — check that SNMP is on, the community (or
  the v3 user and keys) is right, and that the device accepts requests from
  the address of your Gladys server. Turn **Detailed logs** on and run **Test
  the connection**.
- **Reachable, but a profile shows nothing** — the device does not have that
  MIB (many switches have no HOST-RESOURCES). Use **Walk an OID** to see what
  it offers, and add custom OIDs.
- **An interface name is not found** — run **List the interfaces** and copy
  the name exactly, or use the index.
- **A switch does not switch** — the community of that device must be
  read-write, and `on` / `off` must be the values the vendor MIB expects.
