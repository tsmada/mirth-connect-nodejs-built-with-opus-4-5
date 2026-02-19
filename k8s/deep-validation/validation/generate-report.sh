#!/usr/bin/env bash
# =============================================================================
# Deep Validation Suite: HTML Report Generator
# =============================================================================
# Generates an HTML report from JSON verification results.
# Optionally includes k6 metrics and chaos scenario results.
#
# Usage: generate-report.sh [json-file] [--k6-json <file>] [--chaos-log <file>]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$DV_ROOT/reports}"

JSON_FILE=""
K6_JSON=""
CHAOS_LOG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --k6-json)
      K6_JSON="$2"
      shift 2
      ;;
    --chaos-log)
      CHAOS_LOG="$2"
      shift 2
      ;;
    *)
      JSON_FILE="$1"
      shift
      ;;
  esac
done

# Auto-detect latest JSON report if not specified
if [[ -z "$JSON_FILE" ]]; then
  JSON_FILE=$(ls -t "$REPORT_DIR"/verification-*.json 2>/dev/null | head -1)
  if [[ -z "$JSON_FILE" ]]; then
    echo "ERROR: No verification JSON found. Run verify-all.sh first." >&2
    exit 1
  fi
fi

if [[ ! -f "$JSON_FILE" ]]; then
  echo "ERROR: JSON file not found: $JSON_FILE" >&2
  exit 1
fi

OUTPUT_FILE="$REPORT_DIR/report.html"

echo "=== Generating HTML Report ==="
echo "  Source:  $JSON_FILE"
echo "  Output:  $OUTPUT_FILE"

# ── Parse JSON (using basic grep/sed since jq may not be available) ────────

# Extract fields from the JSON file
get_json_value() {
  local key="$1"
  grep "\"$key\"" "$JSON_FILE" | head -1 | sed 's/.*: *"\?\([^",}]*\)"\?.*/\1/'
}

TIMESTAMP=$(get_json_value "timestamp")
OVERALL=$(get_json_value "overall")
MSG_STATUS=$(grep -A3 '"messages"' "$JSON_FILE" | grep '"status"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
MSG_DURATION=$(grep -A3 '"messages"' "$JSON_FILE" | grep '"duration_seconds"' | head -1 | sed 's/.*: *\([0-9]*\).*/\1/')
STAT_STATUS=$(grep -A3 '"statistics"' "$JSON_FILE" | grep '"status"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
STAT_DURATION=$(grep -A3 '"statistics"' "$JSON_FILE" | grep '"duration_seconds"' | head -1 | sed 's/.*: *\([0-9]*\).*/\1/')
INT_STATUS=$(grep -A3 '"integrity"' "$JSON_FILE" | grep '"status"' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
INT_DURATION=$(grep -A3 '"integrity"' "$JSON_FILE" | grep '"duration_seconds"' | head -1 | sed 's/.*: *\([0-9]*\).*/\1/')

# Color helper
status_color() {
  if [[ "$1" == "PASS" ]]; then
    echo "#22c55e"  # green
  else
    echo "#ef4444"  # red
  fi
}

OVERALL_COLOR=$(status_color "$OVERALL")
MSG_COLOR=$(status_color "$MSG_STATUS")
STAT_COLOR=$(status_color "$STAT_STATUS")
INT_COLOR=$(status_color "$INT_STATUS")

# ── Generate HTML ──────────────────────────────────────────────────────────

cat > "$OUTPUT_FILE" << HTMLEOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deep Validation Report - $TIMESTAMP</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; color: #f8fafc; }
    h2 { font-size: 1.3rem; margin: 2rem 0 1rem; color: #cbd5e1; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
    .meta { color: #94a3b8; font-size: 0.9rem; margin-bottom: 2rem; }
    .overall { display: inline-block; padding: 0.5rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 1.2rem; color: white; background: ${OVERALL_COLOR}; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    th { text-align: left; padding: 0.75rem; background: #1e293b; color: #94a3b8; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.75rem; border-bottom: 1px solid #1e293b; }
    .pass { color: #22c55e; font-weight: 600; }
    .fail { color: #ef4444; font-weight: 600; }
    .skip { color: #f59e0b; font-weight: 600; }
    .section { background: #1e293b; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    pre { background: #0f172a; padding: 1rem; border-radius: 0.25rem; overflow-x: auto; font-size: 0.85rem; line-height: 1.5; color: #94a3b8; }
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #334155; color: #64748b; font-size: 0.8rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Deep Validation Report</h1>
    <div class="meta">
      <div>Timestamp: $TIMESTAMP</div>
      <div>Report: $(basename "$JSON_FILE")</div>
    </div>

    <div class="overall">$OVERALL</div>

    <h2>Verification Results</h2>
    <div class="section">
      <table>
        <tr>
          <th>Check</th>
          <th>Status</th>
          <th>Duration</th>
        </tr>
        <tr>
          <td>Message Processing</td>
          <td class="$(echo "$MSG_STATUS" | tr '[:upper:]' '[:lower:]')">$MSG_STATUS</td>
          <td>${MSG_DURATION}s</td>
        </tr>
        <tr>
          <td>Statistics Accuracy</td>
          <td class="$(echo "$STAT_STATUS" | tr '[:upper:]' '[:lower:]')">$STAT_STATUS</td>
          <td>${STAT_DURATION}s</td>
        </tr>
        <tr>
          <td>Data Integrity</td>
          <td class="$(echo "$INT_STATUS" | tr '[:upper:]' '[:lower:]')">$INT_STATUS</td>
          <td>${INT_DURATION}s</td>
        </tr>
      </table>
    </div>
HTMLEOF

# ── Optional: k6 metrics ──────────────────────────────────────────────────
if [[ -n "$K6_JSON" ]] && [[ -f "$K6_JSON" ]]; then
  # Extract key metrics from k6 JSON summary
  K6_VUS=$(grep '"vus"' "$K6_JSON" | head -1 | sed 's/.*"value": *\([0-9.]*\).*/\1/' || echo "N/A")
  K6_REQS=$(grep '"http_reqs"' "$K6_JSON" | head -1 | sed 's/.*"count": *\([0-9]*\).*/\1/' || echo "N/A")
  K6_DURATION=$(grep '"http_req_duration"' "$K6_JSON" | head -1 || echo "")
  K6_P95=$(echo "$K6_DURATION" | grep -o '"p(95)": *[0-9.]*' | sed 's/.*: *//' || echo "N/A")
  K6_ERRORS=$(grep '"http_req_failed"' "$K6_JSON" | head -1 | sed 's/.*"passes": *\([0-9]*\).*/\1/' || echo "N/A")

  cat >> "$OUTPUT_FILE" << K6EOF
    <h2>k6 Load Test Metrics</h2>
    <div class="section">
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Peak Virtual Users</td><td>$K6_VUS</td></tr>
        <tr><td>Total HTTP Requests</td><td>$K6_REQS</td></tr>
        <tr><td>p95 Response Time</td><td>${K6_P95}ms</td></tr>
        <tr><td>Failed Requests</td><td>$K6_ERRORS</td></tr>
      </table>
    </div>
K6EOF
fi

# ── Optional: chaos log ───────────────────────────────────────────────────
if [[ -n "$CHAOS_LOG" ]] && [[ -f "$CHAOS_LOG" ]]; then
  cat >> "$OUTPUT_FILE" << CHAOSEOF
    <h2>Chaos Engineering Results</h2>
    <div class="section">
      <pre>$(cat "$CHAOS_LOG" | head -50)</pre>
    </div>
CHAOSEOF
fi

# ── Footer ─────────────────────────────────────────────────────────────────
cat >> "$OUTPUT_FILE" << FOOTEREOF
    <div class="footer">
      Mirth Connect Node.js Runtime - Deep Validation Suite
    </div>
  </div>
</body>
</html>
FOOTEREOF

echo "  Report generated: $OUTPUT_FILE"
echo ""
echo "=== Done ==="
