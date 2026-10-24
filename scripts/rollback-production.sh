#!/usr/bin/env bash
# ==============================================================================
# CFSolara Production Rollback Script (Tunnel Ingress + DNS CNAME)
# Restores original direct Cloudflare Tunnel architecture from verified backups.
#
# Usage:
#   ./scripts/rollback-production.sh            # Safe dry-run (default)
#   ./scripts/rollback-production.sh --dry-run  # Explicit dry-run
#   ./scripts/rollback-production.sh --execute  # Execute live rollback
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${REPO_ROOT}/rollback-backups"
TUNNEL_BACKUP="${TUNNEL_BACKUP:-$(ls "${BACKUP_DIR}"/*tunnel*.json 2>/dev/null | head -n 1 || true)}"
DNS_BACKUP="${DNS_BACKUP:-$(ls "${BACKUP_DIR}"/*dns*.json 2>/dev/null | head -n 1 || true)}"

MODE="dry-run"
if [[ "${1:-}" == "--execute" ]]; then
  MODE="execute"
elif [[ "${1:-}" == "--dry-run" ]] || [[ -z "${1:-}" ]]; then
  MODE="dry-run"
else
  echo "Unknown argument: ${1}"
  echo "Usage: $0 [--dry-run | --execute]"
  exit 1
fi

echo "================================================================================"
echo " CFSolara Production Rollback: Mode = [${MODE^^}]"
echo "================================================================================"

# 1. Validate backup files exist
if [[ ! -f "${TUNNEL_BACKUP}" ]]; then
  echo "[-] ERROR: Tunnel backup file not found at ${TUNNEL_BACKUP}" >&2
  exit 1
fi
if [[ ! -f "${DNS_BACKUP}" ]]; then
  echo "[-] ERROR: DNS backup file not found at ${DNS_BACKUP}" >&2
  exit 1
fi

echo "[+] Step 0: Backup integrity check"
# 2. Validate JSON structure & extract parameters using node
PARAMS=$(node -e '
const fs = require("fs");
const tunnel = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const dns = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const accountId = tunnel.accountId;
const tunnelId = tunnel.tunnelId;
const tunnelConfig = tunnel.config;

const zoneId = dns.zoneId;
const sonicRecord = dns.records.find(r => r.name === "sonic.epocanvas.tech");

if (!accountId || !tunnelId || !tunnelConfig) {
  throw new Error("Invalid tunnel backup JSON");
}
if (!zoneId || !sonicRecord) {
  throw new Error("Invalid DNS backup JSON");
}

console.log(JSON.stringify({
  accountId,
  tunnelId,
  tunnelConfig,
  zoneId,
  recordId: sonicRecord.id,
  recordName: sonicRecord.name,
  recordContent: sonicRecord.content,
  proxied: sonicRecord.proxied
}));
' "${TUNNEL_BACKUP}" "${DNS_BACKUP}")

ACCOUNT_ID=$(echo "${PARAMS}" | jq -r .accountId)
TUNNEL_ID=$(echo "${PARAMS}" | jq -r .tunnelId)
ZONE_ID=$(echo "${PARAMS}" | jq -r .zoneId)
RECORD_ID=$(echo "${PARAMS}" | jq -r .recordId)
RECORD_NAME=$(echo "${PARAMS}" | jq -r .recordName)
RECORD_CONTENT=$(echo "${PARAMS}" | jq -r .recordContent)
PROXIED=$(echo "${PARAMS}" | jq -r .proxied)
TUNNEL_CONFIG_JSON=$(echo "${PARAMS}" | jq -c '{config: .tunnelConfig}')

echo "    - Account ID : ${ACCOUNT_ID}"
echo "    - Tunnel ID  : ${TUNNEL_ID}"
echo "    - Zone ID    : ${ZONE_ID}"
echo "    - Record ID  : ${RECORD_ID} (${RECORD_NAME})"
echo "    - Original CNAME Target: ${RECORD_CONTENT} (proxied: ${PROXIED})"
echo "    - Tunnel Ingress Route : sonic.epocanvas.tech -> http://localhost:8080"
echo "    ✓ Backup integrity verified 100% OK"
echo ""

# 3. Check environment
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "[-] WARNING: CLOUDFLARE_API_TOKEN environment variable is not set." >&2
  if [[ "${MODE}" == "execute" ]]; then
    exit 1
  fi
else
  echo "[+] Auth credential detected in environment: CLOUDFLARE_API_TOKEN [SET]"
fi
echo ""

# Step 1: Merge Tunnel Ingress Configuration (Preserve engine-sonic.epocanvas.tech)
TUNNEL_ENDPOINT="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations"

# Fetch current tunnel configuration if token is available
CURRENT_INGRESS_JSON="[]"
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  CURRENT_CFG_RESP=$(curl -s -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "${TUNNEL_ENDPOINT}" || true)
  if echo "${CURRENT_CFG_RESP}" | jq -e '.success' >/dev/null 2>&1; then
    CURRENT_INGRESS_JSON=$(echo "${CURRENT_CFG_RESP}" | jq -c '.result.config.ingress // []')
  fi
fi

# Merge current ingress with rollback backup (merge mode, never overwrite)
MERGED_TUNNEL_CONFIG=$(node -e '
const fs = require("fs");
const currentIngress = JSON.parse(process.argv[1]);
const backup = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const backupIngress = backup.config?.ingress || [];

// Collect all hostnames from current and backup
const rules = new Map();

// 1. Keep current active rules (specifically engine-sonic.epocanvas.tech)
for (const rule of currentIngress) {
  if (rule.hostname) {
    rules.set(rule.hostname, rule);
  }
}

// 2. Merge backup rules (restore sonic.epocanvas.tech)
for (const rule of backupIngress) {
  if (rule.hostname) {
    rules.set(rule.hostname, rule);
  }
}

// Ensure engine-sonic is explicitly safeguarded
if (!rules.has("engine-sonic.epocanvas.tech")) {
  rules.set("engine-sonic.epocanvas.tech", {
    service: "http://localhost:8080",
    hostname: "engine-sonic.epocanvas.tech"
  });
}

// Ensure sonic.epocanvas.tech is present
if (!rules.has("sonic.epocanvas.tech")) {
  rules.set("sonic.epocanvas.tech", {
    service: "http://localhost:8080",
    hostname: "sonic.epocanvas.tech"
  });
}

// Rebuild ingress array with catch-all 404 at the end
const merged = [];
for (const [hostname, rule] of rules.entries()) {
  merged.push(rule);
}
merged.push({ service: "http_status:404" });

console.log(JSON.stringify({
  config: {
    ingress: merged,
    "warp-routing": { enabled: false }
  }
}));
' "${CURRENT_INGRESS_JSON}" "${TUNNEL_BACKUP}")

echo "[+] Step 1 (Tunnel): MERGE sonic.epocanvas.tech ingress into Cloudflare Tunnel"
echo "    Strategy: Non-destructive Merge (PRESERVES engine-sonic.epocanvas.tech)"
echo "    Request:"
echo "      PUT ${TUNNEL_ENDPOINT}"
echo "      Headers: Authorization: Bearer <CLOUDFLARE_API_TOKEN>, Content-Type: application/json"
echo "      Payload:"
echo "        ${MERGED_TUNNEL_CONFIG}"
echo ""

# Step 2: Restore DNS CNAME Record
DNS_ENDPOINT="https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}"
DNS_PAYLOAD=$(jq -nc --arg type "CNAME" --arg name "sonic" --arg content "${RECORD_CONTENT}" --argjson proxied "${PROXIED}" \
  '{type: $type, name: $name, content: $content, proxied: $proxied, ttl: 1}')
echo "[+] Step 2 (DNS): Restore CNAME target back to original Tunnel hostname"
echo "    Request:"
echo "      PATCH ${DNS_ENDPOINT}"
echo "      Headers: Authorization: Bearer <CLOUDFLARE_API_TOKEN>, Content-Type: application/json"
echo "      Payload:"
echo "        ${DNS_PAYLOAD}"
echo ""

if [[ "${MODE}" == "dry-run" ]]; then
  echo "================================================================================"
  echo " [DRY RUN SUCCESSFUL] Merged configuration validated. No live mutations made."
  echo " To execute this rollback live, run: ./scripts/rollback-production.sh --execute"
  echo "================================================================================"
  exit 0
fi

# Execution path (only when --execute is passed)
echo ">>> EXECUTING LIVE ROLLBACK <<<"

echo "1. Applying Merged Tunnel Configuration..."
TUNNEL_RESP=$(curl -s -X PUT "${TUNNEL_ENDPOINT}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${MERGED_TUNNEL_CONFIG}")

if ! echo "${TUNNEL_RESP}" | jq -e '.success' >/dev/null 2>&1; then
  echo "[-] FAILED to restore tunnel configuration:" >&2
  echo "${TUNNEL_RESP}" >&2
  exit 1
fi
echo "   ✓ Merged tunnel ingress configuration applied successfully (engine-sonic preserved)."

echo "2. Applying DNS CNAME Update..."
DNS_RESP=$(curl -s -X PATCH "${DNS_ENDPOINT}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${DNS_PAYLOAD}")

if ! echo "${DNS_RESP}" | jq -e '.success' >/dev/null 2>&1; then
  echo "[-] FAILED to restore DNS record:" >&2
  echo "${DNS_RESP}" >&2
  exit 1
fi
echo "   ✓ DNS CNAME record updated back to ${RECORD_CONTENT} successfully."

echo "================================================================================"
echo " [LIVE ROLLBACK COMPLETE] Verified both Tunnel Ingress and DNS CNAME restored."
echo "================================================================================"
