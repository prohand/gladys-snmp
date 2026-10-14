// -----------------------------------------------------------------------------
// From SNMP varbinds to plain JavaScript values.
//
// net-snmp hands back what the wire carries: an OctetString is a Buffer, a
// Counter64 is a Buffer too (8 big-endian bytes), an absent object is a varbind
// typed NoSuchObject / NoSuchInstance / EndOfMibView. The rest of the code only
// wants a number, a string, or "nothing there".
// -----------------------------------------------------------------------------

/** The varbind types net-snmp uses (snmp.ObjectType), copied to stay pure. */
export const TYPES = {
  BOOLEAN: 1,
  INTEGER: 2,
  OCTET_STRING: 4,
  NULL: 5,
  OID: 6,
  IP_ADDRESS: 64,
  COUNTER: 65,
  GAUGE: 66,
  TIME_TICKS: 67,
  OPAQUE: 68,
  COUNTER64: 70,
  NO_SUCH_OBJECT: 128,
  NO_SUCH_INSTANCE: 129,
  END_OF_MIB_VIEW: 130,
};

const ABSENT = [TYPES.NO_SUCH_OBJECT, TYPES.NO_SUCH_INSTANCE, TYPES.END_OF_MIB_VIEW, TYPES.NULL];

/** 2^32 and 2^64: where the interface counters wrap. */
export const COUNTER32_WRAP = 2 ** 32;
export const COUNTER64_WRAP = 2 ** 64;

/** Does the agent have this object at all? */
export function isPresent(varbind) {
  return Boolean(varbind) && !ABSENT.includes(varbind.type);
}

/**
 * The value of a varbind as a number, or `null` when it is absent or not a
 * number (a text that does not parse).
 */
export function toNumber(varbind) {
  if (!isPresent(varbind)) {
    return null;
  }
  const { value } = varbind;
  if (
    varbind.type === TYPES.COUNTER64 ||
    (Buffer.isBuffer(value) && varbind.type !== TYPES.OCTET_STRING)
  ) {
    return bufferToNumber(value);
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (Buffer.isBuffer(value)) {
    // Some agents publish numbers as text ("42.5" in UCD-SNMP laLoad).
    const parsed = Number.parseFloat(value.toString('utf8'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The value of a varbind as a readable string, or `null` when absent. */
export function toText(varbind) {
  if (!isPresent(varbind)) {
    return null;
  }
  const { value } = varbind;
  if (varbind.type === TYPES.COUNTER64) {
    return String(bufferToNumber(value));
  }
  if (Buffer.isBuffer(value)) {
    return printable(value) ? value.toString('utf8') : hex(value);
  }
  return String(value);
}

/** A Counter64 as a Number: exact up to 2^53 bytes (8 PiB), plenty for octets. */
export function bufferToNumber(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  let result = 0n;
  for (const byte of buffer) {
    result = (result << 8n) + BigInt(byte);
  }
  return Number(result);
}

function printable(buffer) {
  // Text if every byte is printable ASCII/UTF-8 or a usual whitespace: a MAC
  // address or a binary blob reads better in hex.
  const text = buffer.toString('utf8');
  return !text.includes('\uFFFD') && /^[\t\n\r\x20-\x7E\u00A0-\uFFFF]*$/u.test(text);
}

function hex(buffer) {
  return [...buffer].map((byte) => byte.toString(16).padStart(2, '0')).join(':');
}

/**
 * The rate between two readings of a counter, in kilobits per second.
 *
 * @param {{ value: number, at: number } | undefined} previous octets + ms
 * @param {{ value: number, at: number }} current
 * @param {number} wrap where the counter wraps (2^32 or 2^64)
 * @returns {number|null} `null` on the first reading, after a reboot or when
 *   the two readings are too close to say anything
 */
export function rateKbps(previous, current, wrap = COUNTER32_WRAP) {
  if (!previous || previous.value === null || current.value === null) {
    return null;
  }
  const seconds = (current.at - previous.at) / 1000;
  if (!(seconds >= 1)) {
    return null;
  }
  let delta = current.value - previous.value;
  if (delta < 0) {
    // A counter going back either wrapped or was reset (agent reboot). A wrap
    // only explains a small step back from near the top: anything else is a
    // reset, and there is no rate to tell.
    if (previous.value < wrap * 0.75) {
      return null;
    }
    delta += wrap;
  }
  return Math.round(((delta * 8) / 1000 / seconds) * 10) / 10;
}

/** sysUpTime (hundredths of a second) in days, two decimals. */
export function ticksToDays(ticks) {
  if (ticks === null || ticks === undefined) {
    return null;
  }
  return Math.round((Number(ticks) / 8640000) * 100) / 100;
}
