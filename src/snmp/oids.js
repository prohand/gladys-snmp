// -----------------------------------------------------------------------------
// The standard OIDs the built-in profiles read.
//
// Only standard MIBs, implemented by nearly every agent: SNMPv2-MIB (system),
// IF-MIB (interfaces), HOST-RESOURCES-MIB (CPU, memory, disks — Linux net-snmp,
// Windows, Synology/QNAP NAS) and UPS-MIB (RFC 1628 — Eaton, APC with a network
// card, most UPS cards). Vendor MIBs go through the custom `oids` of an agent.
// -----------------------------------------------------------------------------

export const SYSTEM = {
  DESCR: '1.3.6.1.2.1.1.1.0',
  OBJECT_ID: '1.3.6.1.2.1.1.2.0',
  UPTIME: '1.3.6.1.2.1.1.3.0',
  CONTACT: '1.3.6.1.2.1.1.4.0',
  NAME: '1.3.6.1.2.1.1.5.0',
  LOCATION: '1.3.6.1.2.1.1.6.0',
};

/** Columns of the interface tables, to be suffixed with `.<ifIndex>`. */
export const IF = {
  DESCR: '1.3.6.1.2.1.2.2.1.2',
  OPER_STATUS: '1.3.6.1.2.1.2.2.1.8',
  IN_OCTETS: '1.3.6.1.2.1.2.2.1.10',
  OUT_OCTETS: '1.3.6.1.2.1.2.2.1.16',
  NAME: '1.3.6.1.2.1.31.1.1.1.1',
  HC_IN_OCTETS: '1.3.6.1.2.1.31.1.1.1.6',
  HC_OUT_OCTETS: '1.3.6.1.2.1.31.1.1.1.10',
  ALIAS: '1.3.6.1.2.1.31.1.1.1.18',
};

/** ifOperStatus values (IF-MIB): only `up` carries traffic. */
export const IF_OPER_STATUS = { UP: 1, DOWN: 2, TESTING: 3, UNKNOWN: 4, DORMANT: 5 };

export const HOST = {
  PROCESSOR_LOAD: '1.3.6.1.2.1.25.3.3.1.2',
  STORAGE_TYPE: '1.3.6.1.2.1.25.2.3.1.2',
  STORAGE_DESCR: '1.3.6.1.2.1.25.2.3.1.3',
  STORAGE_UNITS: '1.3.6.1.2.1.25.2.3.1.4',
  STORAGE_SIZE: '1.3.6.1.2.1.25.2.3.1.5',
  STORAGE_USED: '1.3.6.1.2.1.25.2.3.1.6',
};

/** hrStorageType values. */
export const STORAGE_TYPES = {
  RAM: '1.3.6.1.2.1.25.2.1.2',
  FIXED_DISK: '1.3.6.1.2.1.25.2.1.4',
};

export const UPS = {
  BATTERY_STATUS: '1.3.6.1.2.1.33.1.2.1.0',
  MINUTES_REMAINING: '1.3.6.1.2.1.33.1.2.3.0',
  CHARGE_REMAINING: '1.3.6.1.2.1.33.1.2.4.0',
  INPUT_VOLTAGE: '1.3.6.1.2.1.33.1.3.3.1.3.1',
  OUTPUT_SOURCE: '1.3.6.1.2.1.33.1.4.1.0',
  OUTPUT_POWER: '1.3.6.1.2.1.33.1.4.4.1.4.1',
  OUTPUT_LOAD: '1.3.6.1.2.1.33.1.4.4.1.5.1',
};

/** upsBatteryStatus: low and depleted both mean "act now". */
export const UPS_BATTERY_STATUS = { UNKNOWN: 1, NORMAL: 2, LOW: 3, DEPLETED: 4 };

/** upsOutputSource: `normal` is the mains, `battery` the UPS running on it. */
export const UPS_OUTPUT_SOURCE = { OTHER: 1, NONE: 2, NORMAL: 3, BYPASS: 4, BATTERY: 5 };
