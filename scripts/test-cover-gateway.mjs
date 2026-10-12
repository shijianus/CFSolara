// Test suite for Cover Resolution and Proxy Gateway
import { onRequestGet } from '../functions/api/music/cover';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Running Cover Gateway Test Suite ===\n');

  const mockEnv = {};

  // Test 1: Fallback SVG when no params
  console.log('1. Testing GET /api/music/cover with no params');
  {
    const req = new Request('http://localhost/api/music/cover');
    const res = await onRequestGet({ request: req, env: mockEnv });
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(res.headers.get('content-type')?.includes('image/svg+xml'), 'Returns SVG fallback');
    const text = await res.text();
    assert(text.includes('<svg') && text.includes('sonicCoverGrad'), 'Contains valid SVG vector graphic');
  }

  // Test 2: NetEase song ID resolution
  console.log('\n2. Testing NetEase Song ID Cover Resolution');
  {
    // Beyond - 海阔天空 ID: 347230
    const req = new Request('http://localhost/api/music/cover?id=347230&source=netease');
    const res = await onRequestGet({ request: req, env: mockEnv });
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    const contentType = res.headers.get('content-type');
    assert(contentType && (contentType.includes('image/') || contentType.includes('svg')), `Content type is valid (${contentType})`);
    assert(res.headers.get('access-control-allow-origin') === '*', 'CORS Allow-Origin header is *');
  }

  // Test 3: QQ Music mid resolution
  console.log('\n3. Testing QQ Music Mid Cover Resolution');
  {
    // Jay Chou - 晴天 albummid: 000QgDxv39bMKQ
    const req = new Request('http://localhost/api/music/cover?id=000QgDxv39bMKQ&source=qq');
    const res = await onRequestGet({ request: req, env: mockEnv });
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    const contentType = res.headers.get('content-type');
    assert(contentType && contentType.includes('image/'), `Returns valid image format (${contentType})`);
  }

  // Test 4: Artist Avatar Fallback
  console.log('\n4. Testing Artist Avatar Search Fallback');
  {
    const req = new Request('http://localhost/api/music/cover?artist=%E5%91%A8%E6%9D%B0%E4%BC%A6');
    const res = await onRequestGet({ request: req, env: mockEnv });
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    const contentType = res.headers.get('content-type');
    assert(contentType && (contentType.includes('image/') || contentType.includes('svg')), `Returns artist image (${contentType})`);
  }

  // Test 5: Direct URL Proxy with Anti-Hotlinking
  console.log('\n5. Testing Direct URL Proxy Mode');
  {
    const target = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000QgDxv39bMKQ.jpg';
    const req = new Request(`http://localhost/api/music/cover?url=${encodeURIComponent(target)}`);
    const res = await onRequestGet({ request: req, env: mockEnv });
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(res.headers.get('access-control-allow-origin') === '*', 'CORS Allow-Origin header is present on proxy');
    const len = res.headers.get('content-length') || 'unknown';
    assert(res.headers.get('content-type')?.includes('image/'), `Image content type is preserved (len=${len})`);
  }

  // Test 6: Invalid image URL gracefully falls back to SVG
  console.log('\n6. Testing Invalid Target URL Fallback');
  {
    const target = 'https://example.com/nonexistent_image_123456789.png';
    const req = new Request(`http://localhost/api/music/cover?url=${encodeURIComponent(target)}`);
    const res = await onRequestGet({ request: req, env: mockEnv });
    assert(res.status === 200, `Status is 200 (got ${res.status})`);
    assert(res.headers.get('content-type')?.includes('image/svg+xml'), 'Fails over to SVG fallback instead of 404');
  }

  console.log(`\n========================================`);
  console.log(`Cover Gateway Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
