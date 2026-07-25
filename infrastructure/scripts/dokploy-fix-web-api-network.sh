#!/usr/bin/env bash
# Run on the Dokploy host when /api/v1 returns plain-text "Internal Server Error"
# but /login still works (web cannot reach api over Docker DNS).
set -euo pipefail

WEB_MATCHES="$(docker ps --format '{{.Names}}' | grep -E 'knowledge-hub.*-web-' || true)"
API_MATCHES="$(docker ps --format '{{.Names}}' | grep -E 'knowledge-hub.*-api-' || true)"
# Two apps deploying this stack duplicate every service name. Connecting networks
# across them would wire web to the wrong api/postgres, so require an explicit pick.
EXPLICIT_PICK=0
[[ -n "${WEB:-}" && -n "${API:-}" ]] && EXPLICIT_PICK=1

if [[ $EXPLICIT_PICK -eq 0 ]] &&
  { [[ "$(echo "$WEB_MATCHES" | grep -c .)" -gt 1 ]] || [[ "$(echo "$API_MATCHES" | grep -c .)" -gt 1 ]]; }; then
  echo "Refusing: more than one KnowHub stack is running — picking one at random would" >&2
  echo "attach web to the wrong api/postgres. Delete the stale Dokploy app, or re-run" >&2
  echo "with WEB=<container> API=<container> for a single app." >&2
  echo "$WEB_MATCHES" >&2
  echo "$API_MATCHES" >&2
  exit 1
fi

WEB="${WEB:-$(echo "$WEB_MATCHES" | head -1)}"
API="${API:-$(echo "$API_MATCHES" | head -1)}"

if [[ -z "$WEB" || -z "$API" ]]; then
  echo "Could not find web/api containers. Running knowledge-hub containers:" >&2
  docker ps --format '{{.Names}}' | grep -i knowledge || true
  exit 1
fi

echo "web=$WEB"
echo "api=$API"
echo
echo "web networks: $(docker inspect "$WEB" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
echo "api networks: $(docker inspect "$API" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
echo

# Attach web to every network the api is on (and vice versa).
for net in $(docker inspect "$API" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'); do
  echo "connect web → $net"
  docker network connect "$net" "$WEB" 2>/dev/null || echo "  (already connected)"
done
for net in $(docker inspect "$WEB" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'); do
  echo "connect api → $net"
  docker network connect "$net" "$API" 2>/dev/null || echo "  (already connected)"
done

echo
echo "DNS from web:"
docker exec "$WEB" getent hosts api || docker exec "$WEB" sh -c 'ping -c1 api 2>/dev/null || true'
echo
echo "Health from web → http://api:3101/health :"
docker exec "$WEB" node -e "fetch('http://api:3101/health').then(async r=>console.log(r.status, await r.text())).catch(e=>{console.error(String(e)); process.exit(1)})"
