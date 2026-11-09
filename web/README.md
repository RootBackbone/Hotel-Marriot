# Frontend — Sitio de reservas (soaweb.marioaponte.me)

Sitio web del hotel (HTML/CSS/JS) servido por nginx, que además hace de **proxy a la API**
bajo `/api` para que el navegador no tenga problemas de CORS (mismo origen).

## Estructura
```
web/
├─ sitio/index.html      # el sitio (un solo archivo)
├─ nginx.conf            # nginx: sirve el sitio + proxy /api -> gateway
└─ docker-compose.yml    # levanta nginx en la red del backend
```

## Despliegue en el VPS

Ya con el repo actualizado en el VPS (`git pull`), desde `/opt/Hotel-Marriot`:

```bash
# 1. Confirmar el nombre de la red del backend (debe existir)
docker network ls | grep marriott
#   -> jw-marriott-soa_backend   (si fuera distinto, ajústalo en web/docker-compose.yml)

# 2. Levantar el sitio
cd web
docker compose up -d
docker compose ps        # soa_web en Up

# 3. Probar localmente en el VPS
curl -s http://127.0.0.1:8088 | head -5          # debe devolver el HTML del sitio
curl -s http://127.0.0.1:8088/api/v1/habitaciones \
  -H "Authorization: Bearer $(curl -sk -X POST https://localhost:8443/api/v1/auth/token \
     -H 'Content-Type: application/json' -d '{"usuario":"cliente","clave":"cliente123"}' \
     | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
#   -> debe devolver la lista de habitaciones (proxy funcionando)
```

## Conectar el dominio (Cloudflare Tunnel)

El túnel ya existe (soa-marriott). Hay que añadir la ruta de `soaweb` hacia el nginx.

1. Editar el config del túnel:
```bash
nano ~/.cloudflared/config.yml
```
Dejar el bloque `ingress` así (soaweb va al nginx; soaapi se mantiene):
```yaml
ingress:
  - hostname: soaweb.marioaponte.me
    service: http://localhost:8088
  - hostname: soaapi.marioaponte.me
    service: https://localhost:8443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

2. Crear el DNS del subdominio y reiniciar el túnel:
```bash
cloudflared tunnel route dns soa-marriott soaweb.marioaponte.me
systemctl restart cloudflared
```

3. Abrir en el navegador: **https://soaweb.marioaponte.me**
   El sitio carga y el catálogo aparece en vivo desde la API. Reserva de prueba: cliente / cliente123.

## Actualizar el sitio después de un cambio
```bash
cd /opt/Hotel-Marriot && git pull
docker compose -f web/docker-compose.yml restart
# (nginx sirve el archivo montado; con un cambio de index.html basta el restart)
```
