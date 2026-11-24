package pe.utp.marriott.gateway.salud;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Agregador de salud del SOA. Consulta en paralelo el /actuator/health interno de cada
 * microservicio y devuelve un único JSON con el estado de todos. Pensado para el panel de
 * administración (monitoreo estilo "SIEM"): un semáforo por servicio con su latencia.
 *
 * <p>La ruta es pública (ver {@code ReglasDeAcceso.PUBLICAS}) porque solo informa UP/DOWN y
 * una latencia; no expone datos de negocio ni detalles internos del health (disk, db, etc.).</p>
 */
@RestController
@RequestMapping("/api/v1/salud")
public class SaludController {

    /** Cada servicio con su nombre visible y la URL interna (misma env que usan las rutas). */
    private record Servicio(String id, String nombre, String url) {
    }

    private final WebClient http = WebClient.builder().build();
    private final List<Servicio> servicios;

    public SaludController(
            @Value("${CLIENTES_URL:http://clientes:8080}") String clientes,
            @Value("${HABITACIONES_URL:http://habitaciones:8080}") String habitaciones,
            @Value("${RESERVAS_URL:http://reservas:8080}") String reservas,
            @Value("${PAQUETES_URL:http://paquetes:8080}") String paquetes,
            @Value("${TOURS_URL:http://tours:8080}") String tours,
            @Value("${PAGOS_URL:http://pagos:8080}") String pagos,
            @Value("${NOTIFICACIONES_URL:http://notificaciones:8080}") String notificaciones) {
        this.servicios = List.of(
                new Servicio("clientes", "Clientes", clientes),
                new Servicio("habitaciones", "Habitaciones", habitaciones),
                new Servicio("reservas", "Reservas", reservas),
                new Servicio("paquetes", "Paquetes", paquetes),
                new Servicio("tours", "Tours", tours),
                new Servicio("pagos", "Pagos", pagos),
                new Servicio("notificaciones", "Notificaciones", notificaciones));
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> salud() {
        long inicioGlobal = System.currentTimeMillis();
        return Flux.fromIterable(servicios)
                .flatMap(this::consultar)
                .collectList()
                .map(lista -> {
                    long arriba = lista.stream().filter(m -> "UP".equals(m.get("estado"))).count();
                    // El gateway mismo: si respondió esta petición, está arriba.
                    Map<String, Object> gateway = Map.of(
                            "id", "gateway", "nombre", "API Gateway", "estado", "UP",
                            "latencia_ms", System.currentTimeMillis() - inicioGlobal);
                    int total = lista.size() + 1;
                    long up = arriba + 1;
                    String resumen = up == total ? "OPERATIVO" : (up == 1 ? "CAIDO" : "DEGRADADO");
                    return Map.of(
                            "resumen", resumen,
                            "arriba", up,
                            "total", total,
                            "gateway", gateway,
                            "servicios", lista);
                });
    }

    /** Pinga un servicio; nunca falla: traduce timeout/5xx/conexión en estado DOWN. */
    private static final ParameterizedTypeReference<Map<String, Object>> TIPO_MAP =
            new ParameterizedTypeReference<>() {
            };

    private Mono<Map<String, Object>> consultar(Servicio s) {
        long inicio = System.currentTimeMillis();
        return http.get()
                .uri(s.url() + "/actuator/health")
                .retrieve()
                .bodyToMono(TIPO_MAP)
                .timeout(Duration.ofSeconds(3))
                .map(cuerpo -> estado(s, inicio, "UP".equalsIgnoreCase(String.valueOf(cuerpo.get("status")))))
                .onErrorResume(e -> Mono.just(estado(s, inicio, false)));
    }

    private Map<String, Object> estado(Servicio s, long inicio, boolean up) {
        return Map.of(
                "id", s.id(),
                "nombre", s.nombre(),
                "estado", up ? "UP" : "DOWN",
                "latencia_ms", System.currentTimeMillis() - inicio);
    }
}
