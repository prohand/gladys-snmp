// -----------------------------------------------------------------------------
// The SNMP client: net-snmp behind four promise-based methods.
//
// Everything that talks to the network goes through `createClient(agent,
// config)`, so the tests can hand the rest of the code a fake one (see
// test/helpers/fakeAgent.js) and never send a packet.
//
//   get(oids)            -> varbinds, in the order asked; an absent object
//                           comes back typed NoSuchObject, never as an error
//   subtree(oid, limit)  -> every varbind under `oid` (GETBULK, GETNEXT in v1)
//   set(varbinds)        -> the varbinds the agent echoed
//   close()
// -----------------------------------------------------------------------------

import snmp from 'net-snmp';
import { TYPES } from './values.js';

/** How many OIDs go in one GET: small agents (printers, UPS cards) cap the PDU. */
export const GET_BATCH = 16;

/** The SNMP types a value can be written with (`set_type` of a custom OID). */
export const SET_OBJECT_TYPES = {
  integer: TYPES.INTEGER,
  unsigned: TYPES.GAUGE,
  gauge: TYPES.GAUGE,
  string: TYPES.OCTET_STRING,
};

/**
 * Open a session to an agent.
 *
 * @param {object} agent normalized agent (see src/config.js)
 * @param {object} config normalized configuration (timeout, retries)
 */
export function createClient(agent, config) {
  const options = {
    port: agent.port,
    retries: config.retries,
    timeout: config.timeout * 1000,
    transport: agent.host.includes(':') ? 'udp6' : 'udp4',
    // An agent behind a NAT or a load balancer may answer from another
    // request id space: the oid check below is ours.
    reportOidMismatchErrors: false,
    idBitsSize: 32,
  };

  let session;
  if (agent.version === '3') {
    options.version = snmp.Version3;
    options.context = agent.v3.context;
    session = snmp.createV3Session(agent.host, v3User(agent.v3), options);
  } else {
    options.version = agent.version === '1' ? snmp.Version1 : snmp.Version2c;
    session = snmp.createSession(agent.host, agent.community, options);
  }
  // A socket error (unreachable network) is also reported by the pending
  // request: without a listener, it would crash the whole process.
  session.on('error', () => {});

  return {
    async get(oids) {
      const result = [];
      for (let i = 0; i < oids.length; i += GET_BATCH) {
        result.push(...(await getBatch(session, agent, oids.slice(i, i + GET_BATCH))));
      }
      return result;
    },

    subtree(oid, limit = 200) {
      return new Promise((resolve, reject) => {
        const varbinds = [];
        session.subtree(
          oid,
          20,
          (batch) => {
            for (const varbind of batch) {
              if (!snmp.isVarbindError(varbind)) {
                varbinds.push(varbind);
              }
            }
            // Returning true stops the walk: a whole MIB would never end.
            return varbinds.length >= limit;
          },
          (error) => (error ? reject(error) : resolve(varbinds.slice(0, limit))),
        );
      });
    },

    set(varbinds) {
      return new Promise((resolve, reject) => {
        session.set(varbinds, (error, answer) => {
          if (error) {
            reject(error);
            return;
          }
          const failed = answer.find((varbind) => snmp.isVarbindError(varbind));
          if (failed) {
            reject(new Error(snmp.varbindError(failed)));
            return;
          }
          resolve(answer);
        });
      });
    },

    close() {
      try {
        session.close();
      } catch {
        // Already closed: nothing left to release.
      }
    },
  };
}

function getBatch(session, agent, oids) {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (!error) {
        resolve(varbinds);
        return;
      }
      // SNMPv1 has no per-object "no such object": one unknown OID fails the
      // whole request with noSuchName. Ask again one by one, so the objects the
      // agent has still come through.
      if (
        error instanceof snmp.RequestFailedError &&
        error.status === snmp.ErrorStatus.NoSuchName &&
        oids.length > 1
      ) {
        Promise.all(oids.map((oid) => getBatch(session, agent, [oid]).catch(() => [absent(oid)])))
          .then((parts) => resolve(parts.flat()))
          .catch(reject);
        return;
      }
      if (
        error instanceof snmp.RequestFailedError &&
        error.status === snmp.ErrorStatus.NoSuchName
      ) {
        resolve([absent(oids[0])]);
        return;
      }
      reject(error);
    });
  });
}

function absent(oid) {
  return { oid, type: TYPES.NO_SUCH_OBJECT, value: null };
}

function v3User(v3) {
  const user = { name: v3.user, level: snmp.SecurityLevel[v3.level] };
  if (v3.level !== 'noAuthNoPriv') {
    user.authProtocol = snmp.AuthProtocols[v3.authProtocol];
    user.authKey = v3.authKey;
  }
  if (v3.level === 'authPriv') {
    user.privProtocol = snmp.PrivProtocols[v3.privProtocol];
    user.privKey = v3.privKey;
  }
  return user;
}

/** Is this error a timeout, i.e. the agent did not answer at all? */
export function isTimeout(error) {
  return error instanceof snmp.RequestTimedOutError || error?.name === 'RequestTimedOutError';
}

/**
 * A short, human reason for a failed request — without the community or the
 * v3 keys, which net-snmp never puts in its messages anyway.
 */
export function describeError(error) {
  if (isTimeout(error)) {
    return 'no answer (timeout)';
  }
  if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') {
    return 'host name not found';
  }
  if (error?.code === 'EHOSTUNREACH' || error?.code === 'ENETUNREACH') {
    return 'host unreachable';
  }
  return String(error?.message ?? error ?? 'unknown error').slice(0, 200);
}
