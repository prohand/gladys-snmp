// -----------------------------------------------------------------------------
// The SNMP request the discovery broadcasts, and the check of its replies.
//
// The integration runs on a Docker bridge: a broadcast it sends never reaches
// the LAN. The Gladys core sends it instead (`scanNetwork('udp-active-
// broadcast')`), but the core only carries bytes: the request has to be built
// here, BER-encoded by hand since net-snmp does not export its encoder.
//
// Only a GetRequest is needed (SNMPv1 or v2c, same layout), and a reply is
// only checked to be a GetResponse: the agents that answer are then asked
// again in unicast through the regular client, which does the real decoding.
// -----------------------------------------------------------------------------

const TAG = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  SEQUENCE: 0x30,
  GET_REQUEST: 0xa0,
  GET_RESPONSE: 0xa2,
};

/** The `version` field of the message: v1 is 0, v2c is 1. */
const VERSION_FIELD = { 1: 0, '2c': 1 };

/**
 * A GetRequest message.
 *
 * @param {object} request
 * @param {'1' | '2c'} request.version
 * @param {string} request.community
 * @param {string[]} request.oids numeric OIDs
 * @param {number} request.requestId
 * @returns {Buffer}
 */
export function encodeGetRequest({ version, community, oids, requestId }) {
  const varbinds = oids.map((oid) => tlv(TAG.SEQUENCE, encodeOid(oid), tlv(TAG.NULL)));
  const pdu = tlv(
    TAG.GET_REQUEST,
    encodeInteger(requestId),
    encodeInteger(0), // error-status
    encodeInteger(0), // error-index
    tlv(TAG.SEQUENCE, ...varbinds),
  );
  return tlv(
    TAG.SEQUENCE,
    encodeInteger(VERSION_FIELD[version] ?? VERSION_FIELD['2c']),
    tlv(TAG.OCTET_STRING, Buffer.from(community, 'utf8')),
    pdu,
  );
}

/**
 * Is this datagram an SNMP GetResponse? Anything else that reaches the port
 * (a stray packet, a v3 report) is ignored.
 *
 * @param {Buffer} buffer
 */
export function isGetResponse(buffer) {
  try {
    const message = readTlv(buffer, 0);
    if (message.tag !== TAG.SEQUENCE) {
      return false;
    }
    const version = readTlv(buffer, message.start);
    if (version.tag !== TAG.INTEGER) {
      return false;
    }
    const community = readTlv(buffer, version.end);
    if (community.tag !== TAG.OCTET_STRING) {
      return false;
    }
    return readTlv(buffer, community.end).tag === TAG.GET_RESPONSE;
  } catch {
    return false;
  }
}

function tlv(tag, ...parts) {
  const content = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function encodeLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  for (let rest = length; rest > 0; rest >>= 8) {
    bytes.unshift(rest & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** A signed integer, in the fewest two's complement bytes. */
function encodeInteger(value) {
  const bytes = [];
  let rest = value;
  do {
    bytes.unshift(rest & 0xff);
    rest >>= 8;
  } while (!((rest === 0 && (bytes[0] & 0x80) === 0) || (rest === -1 && (bytes[0] & 0x80) !== 0)));
  return tlv(TAG.INTEGER, Buffer.from(bytes));
}

function encodeOid(oid) {
  const [first, second, ...rest] = oid.split('.').map(Number);
  const bytes = [];
  for (const arc of [first * 40 + second, ...rest]) {
    const chunk = [arc & 0x7f];
    for (let value = Math.floor(arc / 128); value > 0; value = Math.floor(value / 128)) {
      chunk.unshift((value & 0x7f) | 0x80);
    }
    bytes.push(...chunk);
  }
  return tlv(TAG.OID, Buffer.from(bytes));
}

/** One TLV at `offset`: its tag, where its content starts and where it ends. */
function readTlv(buffer, offset) {
  const tag = buffer[offset];
  let length = buffer[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) {
      throw new Error('unsupported length');
    }
    length = buffer.readUIntBE(start, count);
    start += count;
  }
  const end = start + length;
  if (tag === undefined || end > buffer.length) {
    throw new Error('truncated');
  }
  return { tag, start, end };
}
