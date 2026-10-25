// Sonic Gateway — Pure TypeScript Cryptographic Primitives (Zero Node/Worker Native Dependencies)
// Works identically in Cloudflare Pages Functions (Workers V8) and Linux Node.js 22+.
// Provides RFC 1321 MD5, FIPS 197 AES-128-ECB (PKCS#7), and NetEase linuxapi / eapi packet builders.

const encoder = new TextEncoder();

const HEX_UPPER = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase());
const HEX_LOWER = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function bytesToHex(bytes: Uint8Array, uppercase = false): string {
  const table = uppercase ? HEX_UPPER : HEX_LOWER;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += table[bytes[i]];
  }
  return out;
}

// ── RFC 1321 MD5 ──

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
}

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function md5Bytes(input: string | Uint8Array): Uint8Array {
  const msg = typeof input === 'string' ? encoder.encode(input) : input;
  const origLen = msg.length;
  const padZeroLen = (55 - (origLen % 64) + 64) % 64;
  const totalLen = origLen + 1 + padZeroLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(msg, 0);
  buf[origLen] = 0x80;

  const bitLenLow = (origLen * 8) >>> 0;
  const bitLenHigh = Math.floor((origLen * 8) / 4294967296) >>> 0;
  const dv = new DataView(buf.buffer);
  dv.setUint32(totalLen - 8, bitLenLow, true);
  dv.setUint32(totalLen - 4, bitLenHigh, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const m = new Uint32Array(16);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let j = 0; j < 16; j++) {
      m[j] = dv.getUint32(offset + j * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f = 0;
      let g = 0;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl32(sum, MD5_SHIFTS[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a0, true);
  outDv.setUint32(4, b0, true);
  outDv.setUint32(8, c0, true);
  outDv.setUint32(12, d0, true);
  return out;
}

export function md5Hex(input: string | Uint8Array, uppercase = false): string {
  return bytesToHex(md5Bytes(input), uppercase);
}

// ── FIPS 197 AES-128-ECB (PKCS#7 Padding) ──

const AES_SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const AES_RCON = new Uint8Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

function xtime(a: number): number {
  return ((a << 1) ^ (((a >>> 7) & 1) * 0x1b)) & 0xff;
}

function expandKey128(key: Uint8Array): Uint8Array {
  if (key.length !== 16) {
    throw new Error(`AES-128 requires a 16-byte key (got ${key.length})`);
  }
  const rk = new Uint8Array(176);
  rk.set(key, 0);

  let bytesGen = 16;
  let rconIdx = 1;
  const temp = new Uint8Array(4);

  while (bytesGen < 176) {
    for (let i = 0; i < 4; i++) {
      temp[i] = rk[bytesGen - 4 + i];
    }
    if (bytesGen % 16 === 0) {
      const t = temp[0];
      temp[0] = AES_SBOX[temp[1]] ^ AES_RCON[rconIdx++];
      temp[1] = AES_SBOX[temp[2]];
      temp[2] = AES_SBOX[temp[3]];
      temp[3] = AES_SBOX[t];
    }
    for (let i = 0; i < 4; i++) {
      rk[bytesGen] = rk[bytesGen - 16] ^ temp[i];
      bytesGen++;
    }
  }
  return rk;
}

function encryptBlock128(block: Uint8Array, offset: number, rk: Uint8Array, out: Uint8Array, outOffset: number): void {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    s[i] = block[offset + i] ^ rk[i];
  }

  for (let round = 1; round <= 10; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) {
      s[i] = AES_SBOX[s[i]];
    }

    // ShiftRows (column-major 4x4 state)
    let tmp = s[1];
    s[1] = s[5];
    s[5] = s[9];
    s[9] = s[13];
    s[13] = tmp;

    tmp = s[2];
    s[2] = s[10];
    s[10] = tmp;
    tmp = s[6];
    s[6] = s[14];
    s[14] = tmp;

    tmp = s[15];
    s[15] = s[11];
    s[11] = s[7];
    s[7] = s[3];
    s[3] = tmp;

    // MixColumns (skip in final round 10)
    if (round < 10) {
      for (let c = 0; c < 16; c += 4) {
        const s0 = s[c];
        const s1 = s[c + 1];
        const s2 = s[c + 2];
        const s3 = s[c + 3];
        const h = s0 ^ s1 ^ s2 ^ s3;
        s[c] ^= h ^ xtime(s0 ^ s1);
        s[c + 1] ^= h ^ xtime(s1 ^ s2);
        s[c + 2] ^= h ^ xtime(s2 ^ s3);
        s[c + 3] ^= h ^ xtime(s3 ^ s0);
      }
    }

    // AddRoundKey
    const rkBase = round * 16;
    for (let i = 0; i < 16; i++) {
      s[i] ^= rk[rkBase + i];
    }
  }

  out.set(s, outOffset);
}

export function aes128EcbEncrypt(plaintext: string | Uint8Array, key: string | Uint8Array): Uint8Array {
  const data = typeof plaintext === 'string' ? encoder.encode(plaintext) : plaintext;
  const keyBytes = typeof key === 'string' ? encoder.encode(key) : key;
  const rk = expandKey128(keyBytes);

  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data, 0);
  padded.fill(padLen, data.length);

  const out = new Uint8Array(padded.length);
  for (let offset = 0; offset < padded.length; offset += 16) {
    encryptBlock128(padded, offset, rk, out, offset);
  }
  return out;
}

export function aes128EcbEncryptHex(plaintext: string | Uint8Array, key: string | Uint8Array, uppercase = true): string {
  return bytesToHex(aes128EcbEncrypt(plaintext, key), uppercase);
}

// ── NetEase Protocol Packet Builders ──

const NETEASE_LINUXAPI_KEY = 'rFgB&h#%2?^eDg:Q';
const NETEASE_EAPI_KEY = 'e82ckenh8dichen8';

export function buildNeteaseLinuxApiParams(payload: Record<string, any>): string {
  return aes128EcbEncryptHex(JSON.stringify(payload), NETEASE_LINUXAPI_KEY, true);
}

// ── FIPS 180-4 SHA-256 ──

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const msg = typeof input === 'string' ? encoder.encode(input) : input;
  const origLen = msg.length;
  const padZeroLen = (55 - (origLen % 64) + 64) % 64;
  const totalLen = origLen + 1 + padZeroLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(msg, 0);
  buf[origLen] = 0x80;

  const bitLenHigh = Math.floor((origLen * 8) / 4294967296) >>> 0;
  const bitLenLow = (origLen * 8) >>> 0;
  const dv = new DataView(buf.buffer);
  dv.setUint32(totalLen - 8, bitLenHigh, false);
  dv.setUint32(totalLen - 4, bitLenLow, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = dv.getUint32(offset + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const s1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const s0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  outDv.setUint32(20, h5, false);
  outDv.setUint32(24, h6, false);
  outDv.setUint32(28, h7, false);
  return out;
}

export function sha256Hex(input: string | Uint8Array, uppercase = false): string {
  return bytesToHex(sha256Bytes(input), uppercase);
}

export function buildNeteaseEapiParams(apiPath: string, payload: Record<string, any>): string {
  const text = JSON.stringify(payload);
  const message = `nobody${apiPath}use${text}md5forencrypt`;
  const digest = md5Hex(message, false);
  const data = `${apiPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return aes128EcbEncryptHex(data, NETEASE_EAPI_KEY, true);
}
