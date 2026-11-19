package pe.utp.marriott.gateway.seguridad;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Autenticación y autorización centralizadas: los servicios no se exponen fuera de la red
 * interna, así que todo lo que llega desde afuera pasa por aquí con un JWT válido.
 */
@Component
public class FiltroJwt implements GlobalFilter, Ordered {

    public static final String CABECERA_USUARIO = "X-Usuario";
    public static final String CABECERA_ROLES = "X-Roles";

    private final JwtService jwt;
    private final ObjectMapper mapper;

    public FiltroJwt(JwtService jwt, ObjectMapper mapper) {
        this.jwt = jwt;
        this.mapper = mapper;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest req = exchange.getRequest();
        String ruta = req.getPath().value();
        // Las cabeceras de identidad solo las pone el gateway: si vienen de afuera, se descartan.
        ServerHttpRequest.Builder limpia = req.mutate().headers(h -> {
            h.remove(CABECERA_USUARIO);
            h.remove(CABECERA_ROLES);
        });
        if (ReglasDeAcceso.esPublica(ruta)) {
            return chain.filter(exchange.mutate().request(limpia.build()).build());
        }

        Optional<JwtService.Sesion> sesion = Optional.ofNullable(req.getHeaders().getFirst(HttpHeaders.AUTHORIZATION))
                .filter(v -> v.startsWith("Bearer "))
                .map(v -> v.substring(7).trim())
                .flatMap(jwt::validar);
        if (sesion.isEmpty()) {
            return rechazar(exchange.getResponse(), HttpStatus.UNAUTHORIZED, "NO_AUTENTICADO",
                    "Falta el token o no es válido. Obténgalo en POST /api/v1/auth/token.");
        }

        String rol = ReglasDeAcceso.rolRequerido(req.getMethod(), ruta, req.getURI().getRawQuery());
        if (rol != null && !sesion.get().tiene(rol)) {
            return rechazar(exchange.getResponse(), HttpStatus.FORBIDDEN, "ACCESO_DENEGADO",
                    "Esta operación es solo para el rol " + rol + ".");
        }

        ServerHttpRequest conIdentidad = limpia
                .header(CABECERA_USUARIO, sesion.get().usuario())
                .header(CABECERA_ROLES, String.join(",", sesion.get().roles()))
                .build();
        return chain.filter(exchange.mutate().request(conIdentidad).build());
    }

    @Override
    public int getOrder() {
        return -100;
    }

    private Mono<Void> rechazar(ServerHttpResponse resp, HttpStatus status, String codigo, String mensaje) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", codigo);
        body.put("mensaje", mensaje);
        resp.setStatusCode(status);
        resp.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        if (status == HttpStatus.UNAUTHORIZED) {
            resp.getHeaders().set(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        }
        try {
            byte[] bytes = mapper.writeValueAsBytes(body);
            return resp.writeWith(Mono.just(resp.bufferFactory().wrap(bytes)));
        } catch (JsonProcessingException e) {
            return resp.setComplete();
        }
    }
}
