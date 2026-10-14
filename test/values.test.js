import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTER32_WRAP,
  COUNTER64_WRAP,
  TYPES,
  bufferToNumber,
  isPresent,
  rateKbps,
  ticksToDays,
  toNumber,
  toText,
} from '../src/snmp/values.js';
import { counter64 } from './helpers/fakeAgent.js';

test('absent objects are neither numbers nor texts', () => {
  for (const type of [TYPES.NO_SUCH_OBJECT, TYPES.NO_SUCH_INSTANCE, TYPES.END_OF_MIB_VIEW]) {
    const varbind = { oid: '1.2', type, value: null };
    assert.equal(isPresent(varbind), false);
    assert.equal(toNumber(varbind), null);
    assert.equal(toText(varbind), null);
  }
});

test('Counter64 buffers become numbers', () => {
  assert.equal(toNumber({ oid: '1', ...counter64(123456789012) }), 123456789012);
  assert.equal(bufferToNumber(Buffer.from([1, 0])), 256);
});

test('OctetStrings are text, or hex when binary (a MAC address)', () => {
  assert.equal(toText({ type: TYPES.OCTET_STRING, value: Buffer.from('nas') }), 'nas');
  assert.equal(
    toText({ type: TYPES.OCTET_STRING, value: Buffer.from([0x00, 0x11, 0x32, 0xab]) }),
    '00:11:32:ab',
  );
  assert.equal(toNumber({ type: TYPES.OCTET_STRING, value: Buffer.from('0.42') }), 0.42);
});

test('rates in kbit/s, null on the first reading', () => {
  assert.equal(rateKbps(undefined, { value: 10, at: 0 }), null);
  // 750 000 octets in 60 s = 100 kbit/s.
  assert.equal(rateKbps({ value: 0, at: 0 }, { value: 750000, at: 60000 }), 100);
});

test('a counter that wraps still gives the rate', () => {
  const previous = { value: COUNTER32_WRAP - 1000, at: 0 };
  assert.equal(rateKbps(previous, { value: 6500, at: 60000 }, COUNTER32_WRAP), 1);
  assert.ok(
    rateKbps({ value: COUNTER64_WRAP - 10, at: 0 }, { value: 10, at: 10000 }, COUNTER64_WRAP) >= 0,
  );
});

test('a counter that restarts (reboot) gives no rate', () => {
  assert.equal(rateKbps({ value: 5_000_000, at: 0 }, { value: 100, at: 60000 }), null);
});

test('sysUpTime in days', () => {
  assert.equal(ticksToDays(8640000 * 1.5), 1.5);
  assert.equal(ticksToDays(null), null);
});
