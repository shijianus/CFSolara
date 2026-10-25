// epocanvas sonic Gateway — Outbound URL / SSRF guard
// Protocol + port + hostname validation, IP literal normalization, strict
// allow-list suffix matching, and redirect-safe fetch.

import type { AppEnv } from '../types';
import { isEnvEnabled } from './config';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.svc',
  '.cluster.local',
  '.onion',
];

// Hosting services that encode arbitrary IPs in DNS names (nip.io and friends)
// can otherwise turn any loopback/private address into a public hostname.
const IP_ECHO_HOSTS = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'traefik.me',
];

const encoder = new TextEncoder();

export class OutboundError extends Error {
  readonly code: string;

  constructor(code: string, message = 'Outbound request rejected') {
    super(message);
    this.name = 'OutboundError';
    this.code = code;
  }
}

export interface UrlValidation {
  ok: boolean;
  url?: URL;
  reason?: string;
}

export interface OutboundOptions {
  allowHttp?: boolean;
  allowedHosts?: string[];
}

export function normalizeHostname(hostname: string): string {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

function parseIpv4Strict(host: string): Uint8Array | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const value = Number(parts[i]);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

/**
 * Parse the legacy IPv4 forms accepted by inet_aton and WHATWG URL:
 * 2130706433, 0x7f.0.0.1, 0177.0.0.1, 127.1.
 */
function parseLooseIpv4(host: string): Uint8Array | null {
  if (!host || host.includes(':') || host.includes('%')) return null;
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      value = Number.parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
      value = Number.parseInt(part.slice(1), 8);
    } else if (/^\d+$/.test(part)) {
      value = Number.parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(value) || value < 0) return null;
    values.push(value);
  }

  let address = 0;
  if (values.length === 1) {
    if (values[0] > 0xffffffff) return null;
    address = values[0];
  } else if (values.length === 2) {
    if (values[0] > 0xff || values[1] > 0xffffff) return null;
    address = values[0] * 0x1000000 + values[1];
  } else if (values.length === 3) {
    if (values[0] > 0xff || values[1] > 0xff || values[2] > 0xffff) return null;
    address = values[0] * 0x1000000 + values[1] * 0x10000 + values[2];
  } else {
    if (values.some((value) => value > 0xff)) return null;
    address = ((values[0] << 24) >>> 0) + (values[1] << 16) + (values[2] << 8) + values[3];
  }

  return new Uint8Array([
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
  ]);
}

function parseIpv6(host: string): Uint8Array | null {
  let input = normalizeHostname(host);
  if (!input.includes(':')) return null;
  input = input.split('%')[0];

  const doubleColon = input.indexOf('::');
  if (doubleColon !== input.lastIndexOf('::')) return null;

  let left = doubleColon >= 0 ? input.slice(0, doubleColon) : input;
  let right = doubleColon >= 0 ? input.slice(doubleColon + 2) : '';

  const parseSide = (side: string): string[] | null => {
    if (!side) return [];
    const groups = side.split(':');
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
        // An embedded IPv4 address is legal only as the final group.
        return null;
      }
    }
    return groups;
  };

  const expandEmbeddedIpv4 = (side: string): string | null => {
    if (!side.includes('.')) return side;
    const lastColon = side.lastIndexOf(':');
    const ipPart = lastColon >= 0 ? side.slice(lastColon + 1) : side;
    const v4 = parseIpv4Strict(ipPart);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    return `${lastColon >= 0 ? side.slice(0, lastColon + 1) : ''}${hi}:${lo}`;
  };

  const leftExpanded = expandEmbeddedIpv4(left);
  const rightExpanded = expandEmbeddedIpv4(right);
  if (leftExpanded === null || rightExpanded === null) return null;
  left = leftExpanded;
  right = rightExpanded;

  const leftGroups = parseSide(left);
  const rightGroups = parseSide(right);
  if (!leftGroups || !rightGroups) return null;

  let groups: string[];
  if (doubleColon >= 0) {
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 1) return null;
    groups = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    if (leftGroups.length !== 8) return null;
    groups = leftGroups;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const value = Number.parseInt(groups[i], 16);
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

export function isBlockedIpv4Bytes(bytes: Uint8Array): boolean {
  if (bytes.length !== 4) return true;
  const [a, b, c, d] = bytes;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  // Keep TS happy about the unused fourth octet while documenting the tuple.
  void d;
  return false;
}

export function isBlockedIpv6Bytes(bytes: Uint8Array): boolean {
  if (bytes.length !== 16) return true;
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return true;

  // ::1
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;

  // fc00::/7 unique local
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // fe80::/10 link local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  // ff00::/8 multicast
  if (bytes[0] === 0xff) return true;

  // 2001:db8::/32 documentation
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

  const embeddedIpv4 = (offset: number): Uint8Array => bytes.slice(offset, offset + 4);

  // IPv4-mapped ::ffff:a.b.c.d
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIpv4Bytes(embeddedIpv4(12));
  }

  // IPv4-compatible ::a.b.c.d (includes `::`)
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return isBlockedIpv4Bytes(embeddedIpv4(12));
  }

  // IPv4-translated ::ffff:0:a.b.c.d
  if (bytes.slice(0, 8).every((byte) => byte === 0) && bytes[8] === 0xff && bytes[9] === 0xff) {
    return isBlockedIpv4Bytes(embeddedIpv4(12));
  }

  // NAT64 64:ff9b::/96
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) {
    return isBlockedIpv4Bytes(embeddedIpv4(12));
  }

  // Teredo 2001::/32 and 6to4 2002::/16 carry an IPv4 destination.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isBlockedIpv4Bytes(embeddedIpv4(2));
  }

  return false;
}

export function isBlockedSsrfHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;

  if (host.includes(':')) {
    const ipv6 = parseIpv6(host);
    return ipv6 ? isBlockedIpv6Bytes(ipv6) : true;
  }

  const ipv4 = parseLooseIpv4(host);
  if (ipv4) return isBlockedIpv4Bytes(ipv4);

  if (host === 'localhost' || host === 'localhost.localdomain' || host === 'ip6-localhost' || host === 'ip6-loopback') {
    return true;
  }
  if (host.startsWith('engine-sonic.')) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (IP_ECHO_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  if (!host.includes('.')) return true;

  return false;
}

export function isHostAllowed(hostname: string, allowlist: readonly string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  const host = normalizeHostname(hostname);
  if (!host) return false;
  return allowlist.some((entry) => {
    const allowed = normalizeHostname(entry);
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function effectiveAllowHttp(env: AppEnv | undefined, explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  return isEnvEnabled(env?.SONIC_ALLOW_HTTP_OUTBOUND, false);
}

export function validateOutboundUrl(
  raw: string | URL,
  env?: AppEnv,
  options: OutboundOptions = {},
): UrlValidation {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.toString()) : new URL(String(raw));
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const allowHttp = effectiveAllowHttp(env, options.allowHttp);
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: 'protocol_not_allowed' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'userinfo_not_allowed' };
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    return { ok: false, reason: 'port_not_allowed' };
  }

  if (!url.hostname) {
    return { ok: false, reason: 'missing_host' };
  }

  if (isBlockedSsrfHost(url.hostname)) {
    return { ok: false, reason: 'blocked_host' };
  }

  if (options.allowedHosts && !isHostAllowed(url.hostname, options.allowedHosts)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  return { ok: true, url };
}

export function validateRedirectTarget(
  previous: URL,
  location: string,
  env?: AppEnv,
  options: OutboundOptions = {},
): UrlValidation {
  let next: URL;
  try {
    next = new URL(location, previous);
  } catch {
    return { ok: false, reason: 'invalid_redirect' };
  }
  if (previous.protocol === 'https:' && next.protocol === 'http:') {
    return { ok: false, reason: 'https_downgrade' };
  }
  return validateOutboundUrl(next, env, options);
}

function buildHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers(init);
  // Never forward hop-by-hop or caller credentials to a proxied target.
  for (const name of [
    'cookie',
    'authorization',
    'proxy-authorization',
    'host',
    'x-forwarded-host',
    'x-forwarded-for',
    'cf-connecting-ip',
    'x-sonic-client-ip',
    'x-sonic-engine-key',
  ]) {
    headers.delete(name);
  }
  return headers;
}

function limitResponseBody(response: Response, maxBytes: number): Response {
  if (response.status === 204 || response.status === 304) return response;
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      response.body?.cancel().catch(() => {});
      throw new OutboundError('response_too_large', 'Upstream response is too large');
    }
  }
  if (!response.body) return response;

  let seen = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(new OutboundError('response_too_large', 'Upstream response is too large'));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  return new Response(response.body.pipeThrough(limiter), {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

export interface SafeFetchOptions extends OutboundOptions {
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetch an untrusted URL with protocol/port/host validation on every hop.
 * - follow at most `maxRedirects` (default 3) manually
 * - revalidate every Location
 * - refuse HTTPS -> HTTP downgrades
 * - apply an overall timeout and optional response-size cap
 */
export async function safeFetch(
  initialUrl: string | URL,
  init: RequestInit,
  env?: AppEnv,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = Math.max(0, Math.min(5, options.maxRedirects ?? DEFAULT_MAX_REDIRECTS));
  const timeoutMs = Math.max(1_000, Math.min(120_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxBytes = options.maxBytes;
  const outboundOptions: OutboundOptions = {
    allowHttp: effectiveAllowHttp(env, options.allowHttp),
    allowedHosts: options.allowedHosts,
  };

  let currentValidation = validateOutboundUrl(initialUrl, env, outboundOptions);
  if (!currentValidation.ok || !currentValidation.url) {
    throw new OutboundError(currentValidation.reason || 'invalid_url');
  }
  let current = currentValidation.url;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = init.signal;
  const combinedSignal =
    callerSignal && typeof (AbortSignal as any).any === 'function'
      ? (AbortSignal as any).any([timeoutSignal, callerSignal])
      : timeoutSignal;

  let redirects = 0;
  while (true) {
    const response = await fetch(current.toString(), {
      ...init,
      headers: buildHeaders(init.headers),
      redirect: 'manual',
      signal: combinedSignal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return maxBytes ? limitResponseBody(response, maxBytes) : response;
      if (redirects >= maxRedirects) {
        response.body?.cancel().catch(() => {});
        throw new OutboundError('too_many_redirects', 'Too many upstream redirects');
      }
      const nextValidation = validateRedirectTarget(current, location, env, outboundOptions);
      if (!nextValidation.ok || !nextValidation.url) {
        response.body?.cancel().catch(() => {});
        throw new OutboundError(nextValidation.reason || 'invalid_redirect');
      }
      response.body?.cancel().catch(() => {});
      current = nextValidation.url;
      redirects += 1;
      continue;
    }

    return maxBytes ? limitResponseBody(response, maxBytes) : response;
  }
}

/**
 * Remove URLs, paths and stack frames from an error before exposing it to a
 * client. Upstream response bodies must never be put into this function.
 */
export function sanitizeErrorForClient(error: unknown, fallback = 'Request failed'): string {
  let message = '';
  if (error instanceof Error) {
    message = error.message || '';
  } else if (typeof error === 'string') {
    message = error;
  }
  message = message.split('\n')[0].split('\r')[0];
  message = message.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]');
  message = message.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'<>/]+\/)+[^\s"'<>]*/g, '[redacted-path]');
  message = message.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]');
  message = message.trim().slice(0, 240);
  return message || fallback;
}

export function isIpLiteral(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  if (host.includes(':')) return parseIpv6(host) !== null;
  return parseIpv4Strict(host) !== null;
}

export function isBlockedIpLiteral(ip: string): boolean {
  const host = normalizeHostname(ip);
  if (!host) return true;
  if (host.includes(':')) {
    const bytes = parseIpv6(host);
    return bytes ? isBlockedIpv6Bytes(bytes) : true;
  }
  const bytes = parseLooseIpv4(host);
  return bytes ? isBlockedIpv4Bytes(bytes) : true;
}

export const outboundEncoder = encoder;
