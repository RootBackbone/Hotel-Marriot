# Frontend — Sitio del hotel (soaweb.marioaponte.me)

Sitio web dinámico del **JW Marriott Hotel Lima** (HTML/CSS/JS, multisección tipo SPA),
servido por nginx, que además hace de **proxy a la API** bajo `/api` para que el
navegador no tenga problemas de CORS (mismo origen).

## Estructura
```
web/
├─ sitio/
│  ├─ index.html        # estructura y secciones del sitio
│  ├─ styles.css        # estilos (paleta navy + dorado, Marcellus/Jost)
│  ├─ app.js            # navegación, catálogo (API), reserva y chatbot
│  └─ img/              # fotos reales optimizadas del hotel (~27 imágenes)
├─ nginx.conf           # nginx: sirve el sitio + proxy /api -> gateway
└─ docker-compose.yml   # levanta nginx en la red del backend
```

## Secciones del sitio
- **Inicio (hero)** con buscador de disponibilidad.
- **Habitaciones & Suites** — catálogo **en vivo desde la API** (`/api/v1/habitaciones`),
  con fotos por tipo, estado (disponible/mantenimiento) y reserva en 3 pasos.
- **Gastronomía & Restobar** — La Vista, Celesté Restobar, desayuno buffet, room service, lounge.
- **Áreas de Esparcimiento** — piscina, spa, gimnasio, salones, banquetes, Larcomar.
- **Galería** con lightbox.
- **Contacto & Ubicación**.
- **Chatbot "Jacques"** (concierge virtual) — asistente guiado por reglas (sin IA externa);
  responde FAQ (precios, horarios, cómo llegar), consulta disponibilidad **en vivo vía API**
  y guía al usuario hacia la sección correspondiente.

## Flujo de reserva (contra la API real)
El modal reserva con el cliente demo (`cliente` / `cliente123`) usando los endpoints reales:
`/api/v1/auth/token`, `/habitaciones`, `/paquetes`, `/tours` y `POST /reservas`
(con cabecera `Idempotency-Key`). Incluye un toggle para **simular pago rechazado**
y ver la compensación Saga.

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

> nginx sirve `sitio/` como raíz, así que `styles.css`, `app.js` e `img/` se cargan
> como rutas relativas (`/styles.css`, `/app.js`, `/img/...`). No hace falta tocar nada.

## Conectar el dominio (Cloudflare Tunnel)

El túnel ya existe (soa-marriott). La ruta de `soaweb` apunta al nginx:
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
> El servicio systemd de cloudflared lee **/etc/cloudflared/config.yml**, no el de `~/.cloudflared`.
> Tras editar: `cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml && systemctl restart cloudflared`.

Abrir: **https://soaweb.marioaponte.me**

## Actualizar el sitio después de un cambio
```bash
cd /opt/Hotel-Marriot && git pull
docker compose -f web/docker-compose.yml restart
# nginx sirve los archivos montados; con un restart basta.
```
