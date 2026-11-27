#!/usr/bin/env bash
# =====================================================================
#  DATOS DE DEMOSTRACIÓN para la sustentación (sábado 5-dic-2026)
#  JW Marriott Hotel Lima — SOA, Grupo 2
#
#  Qué hace: crea tours con fecha de diciembre y 3 reservas de ejemplo
#  que incluyen PAQUETE + TOUR, para mostrar en vivo que el sistema
#  permite agregar paquetes y tours a una reserva.
#
#  Cómo usarlo (en el VPS):
#     chmod +x demo-5dic.sh
#     ./demo-5dic.sh
#
#  Requisitos: la API respondiendo en https://soaapi.marioaponte.me
#  y el usuario recepción con su clave (ajústala abajo si ya la cambiaste).
# =====================================================================
set -euo pipefail

BASE="https://soaapi.marioaponte.me"
ADMIN_USER="recepcion"
ADMIN_PASS="6PV2r#_5NRr##E5X5ujJeG#m"   # clave nueva de recepción

# Habitaciones que ya existen en el sistema (ajusta si usas otras).
HAB_SIMPLE="HAB-301"
HAB_SUITE="HAB-901"

echo "==> 1. Token de recepción (ADMIN)"
TK=$(curl -sk -X POST "$BASE/api/v1/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"usuario\":\"$ADMIN_USER\",\"clave\":\"$ADMIN_PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
echo "    token OK (${#TK} chars)"
AUTH="Authorization: Bearer $TK"

echo "==> 2. Crear tours con fecha DENTRO de la semana de la sustentación"
# Tour del 5-dic (el día de la demo) y uno del 4-dic.
TOUR1=$(curl -sk -X POST "$BASE/api/v1/tours" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"City Tour Lima Colonial","fecha":"2026-12-05","cupoTotal":20,"precio":180.00,"moneda":"PEN"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo "    Tour 1 (05-dic): $TOUR1"

TOUR2=$(curl -sk -X POST "$BASE/api/v1/tours" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"Gastronomía y Barranco","fecha":"2026-12-06","cupoTotal":15,"precio":220.00,"moneda":"PEN"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo "    Tour 2 (06-dic): $TOUR2"

echo "==> 3. Verificar que haya un paquete activo (usa el primero activo)"
PAQ=$(curl -sk "$BASE/api/v1/paquetes?activo=true" -H "$AUTH" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);d=d if isinstance(d,list) else d.get('paquetes',[]);print(d[0]['id'] if d else '')")
echo "    Paquete activo: $PAQ"

# ---------------------------------------------------------------------
# Función: registra un cliente (si no existe) y crea una reserva
# con habitación + paquete + tour.
# ---------------------------------------------------------------------
crear_reserva () {
  local nombre="$1" apellido="$2" email="$3" doc="$4" hab="$5" desde="$6" hasta="$7" tour="$8" paq="$9"

  echo "    - Registrando a $nombre $apellido ($email)"
  local CID
  CID=$(curl -sk -X POST "$BASE/api/v1/clientes" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"nombres\":\"$nombre\",\"apellidos\":\"$apellido\",\"email\":\"$email\",\"documento\":\"$doc\",\"telefono\":\"999000111\"}" \
    | python3 -c "import sys,json
try:
    d=json.load(sys.stdin); print(d.get('id',''))
except: print('')")
  # Si ya existía (409), lo buscamos por correo.
  if [ -z "$CID" ]; then
    CID=$(curl -sk "$BASE/api/v1/clientes?email=$email" -H "$AUTH" \
      | python3 -c "import sys,json
d=json.load(sys.stdin); d=d if isinstance(d,list) else d.get('clientes',[d] if isinstance(d,dict) else [])
print(d[0]['id'] if d else '')")
  fi
  echo "      clienteId = $CID"

  # El campo tourId se incluye solo si hay tour (si es "null" se omite).
  local tourJson=""
  if [ "$tour" != "null" ] && [ -n "$tour" ]; then
    tourJson="\"tourId\":\"$tour\","
  fi

  echo "      Creando reserva $hab  $desde -> $hasta  (paquete $paq, tour ${tour})"
  curl -sk -X POST "$BASE/api/v1/reservas" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{
      \"clienteId\":\"$CID\",\"habitacionId\":\"$hab\",
      \"desde\":\"$desde\",\"hasta\":\"$hasta\",
      ${tourJson}\"paqueteId\":\"$paq\",
      \"pago\":{\"metodo\":\"TARJETA\",\"tokenTarjeta\":\"tok_ok_demo\"}
    }" | python3 -m json.tool
  echo ""
}

echo "==> 4. Crear reservas de demostración (habitación + paquete + tour)"
# Reserva A: estadía 4-7 dic, incluye paquete y el tour del 5-dic
crear_reserva "Ana"   "Torres"  "ana.demo@gmail.com"   "70111222" "$HAB_SIMPLE" "2026-12-04" "2026-12-07" "$TOUR1" "$PAQ"
# Reserva B: estadía 5-8 dic (suite), incluye paquete y el tour del 6-dic
crear_reserva "Bruno" "Salas"   "bruno.demo@gmail.com" "70333444" "$HAB_SUITE"  "2026-12-05" "2026-12-08" "$TOUR2" "$PAQ"
# Reserva C: estadía 3-5 dic, solo paquete (sin tour) — para variar
crear_reserva "Carla" "Mendoza" "carla.demo@gmail.com" "70555666" "$HAB_SIMPLE" "2026-12-03" "2026-12-05" "null"   "$PAQ"

echo "==> 5. Listo. Revisa el panel admin -> Reservas: verás las 3 reservas"
echo "    confirmadas con su paquete y tour. En el Dashboard filtra el rango"
echo "    2026-12-03 a 2026-12-08 para verlas en los gráficos."
