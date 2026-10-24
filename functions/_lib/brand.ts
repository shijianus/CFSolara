/**
 * Central display-brand configuration for Pages Functions.
 *
 * Keep the public wire contract frozen: the wire brand field value "Sonic", /api/sonic/* routes,
 * X-Sonic-* headers, env names, and cache keys are compatibility identifiers, not display copy.
 */
export const BRAND_PARENT = 'epocanvas';
export const BRAND_PRODUCT = 'sonic';
export const BRAND_FULL = 'epocanvas sonic';
export const BRAND_TITLE = 'epocanvas sonic - Cloud Music Platform';
export const BRAND_DESCRIPTION = 'epocanvas sonic Music Cloud Platform';
export const BRAND_KEYWORDS = 'epocanvas, sonic, Music, Streaming, Cloud Platform';
export const BRAND_COPYRIGHT = '© epocanvas';
export const BRAND_STUDIO = 'STUDIO';
export const BRAND_TAGLINE = 'AUDIO ENGINE';

export const API_NAME = `${BRAND_FULL} Music Cloud Platform & Aggregation Gateway`;
export const API_DESCRIPTION =
  '轻量化音乐云平台与开放聚合网关，支持 Epomail OAuth 真人验证与细粒度 API 连结';

// Additive metadata for API consumers; the existing wire brand stays "Sonic" for compatibility.
export const BRANDING = {
  parent: BRAND_PARENT,
  product: BRAND_PRODUCT,
  full: BRAND_FULL,
  wireBrand: 'Sonic',
} as const;
