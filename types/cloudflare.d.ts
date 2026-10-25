// Minimal ambient declarations for Cloudflare Workers APIs used by the
// shared Pages Functions / Node engine code. Runtime types for KV, Durable
// Objects and Pages context are intentionally loose; security-critical code
// does not trust their contents.

interface RequestInit {
  cf?: any;
  duplex?: 'half';
}

declare const caches: any;
