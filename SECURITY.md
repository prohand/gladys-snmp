# Security policy

## Supported versions

Only the latest release of the SNMP integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-snmp](https://github.com/prohand/gladys-snmp/security), then
**Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove communities, SNMPv3 keys, tokens and
  addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the
[`net-snmp`](https://github.com/markabrahams/node-net-snmp) library (report
upstream), and the firmware of the devices the integration reads.

## Good practices for users

- SNMP v1 and v2c send the community in clear text on the network: prefer
  SNMPv3 with `authPriv` (SHA + AES) when your devices support it.
- Give Gladys a **read-only** community or a read-only v3 user. Only use a
  read-write one for the devices whose OIDs you marked `writable`, and restrict
  it on the device to the address of your Gladys server.
- Keep communities and keys in the secret fields of the configuration, never in
  a device name or an OID label.
- Keep Gladys and the integration up to date.
