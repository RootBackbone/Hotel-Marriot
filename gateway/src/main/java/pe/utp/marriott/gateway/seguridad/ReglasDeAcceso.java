package pe.utp.marriott.gateway.seguridad;

import java.util.List;
import java.util.Set;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.PathContainer;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/**
 * Qué rol pide cada operación. Todo /api/v1 exige un JWT válido; estas reglas agregan
 * cuándo además hace falta ser personal del hotel (ADMIN). La primera regla que calza decide.
 *
 * <p>CAMBIO (roles web): GET /api/v1/clientes sigue siendo solo de ADMIN cuando lista a
 * TODOS, pero cuando trae ?email= (buscar la propia ficha por correo) basta con estar
 * autenticado. Así el sitio web puede recuperar el id del cliente tras registrarlo,
 * sin exponer el listado completo. La decisión usa el query string, por eso rolRequerido
 * recibe ahora también el query (ver FiltroJwt).</p>
 */
public final class ReglasDeAcceso {

    public static final String ADMIN = "ADMIN";

    private static final Set<HttpMethod> TODOS = Set.of();
    private static final Set<HttpMethod> ESCRITURAS =
            Set.of(HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE);

    private record Regla(Set<HttpMethod> metodos, PathPattern ruta, String rol) {

        boolean calza(HttpMethod metodo, PathContainer path) {
            return (metodos.isEmpty() || metodos.contains(metodo)) && ruta.matches(path);
        }
    }

    private static final PathPatternParser PARSER = new PathPatternParser();

    private static final List<Regla> REGLAS = List.of(
            // El cliente puede reservar un tour; el resto de escrituras de catálogo es del personal.
            regla(Set.of(HttpMethod.POST), "/api/v1/tours/{id}/reserva", null),
            regla(ESCRITURAS, "/api/v1/habitaciones/**", ADMIN),
            regla(ESCRITURAS, "/api/v1/paquetes/**", ADMIN),
            regla(ESCRITURAS, "/api/v1/tours/**", ADMIN),
            // Listar todos los clientes es del personal; registrarse y ver una ficha, de cualquiera.
            // (La excepción de ?email= se maneja en rolRequerido, no aquí.)
            regla(Set.of(HttpMethod.GET), "/api/v1/clientes", ADMIN),
            // Pagos y Notificaciones son utilidades internas: las usa Reservas por la red interna.
            regla(TODOS, "/api/v1/pagos/**", ADMIN),
            regla(TODOS, "/api/v1/notificaciones/**", ADMIN));

    private static final List<PathPattern> PUBLICAS = List.of(
            PARSER.parse("/api/v1/auth/**"),
            PARSER.parse("/actuator/health"));

    private ReglasDeAcceso() {
    }

    public static boolean esPublica(String ruta) {
        PathContainer path = PathContainer.parsePath(ruta);
        return PUBLICAS.stream().anyMatch(p -> p.matches(path));
    }

    /**
     * Devuelve el rol requerido, o null si basta con estar autenticado.
     * Sobrecarga sin query, por compatibilidad.
     */
    public static String rolRequerido(HttpMethod metodo, String ruta) {
        return rolRequerido(metodo, ruta, null);
    }

    /**
     * Igual que arriba, pero teniendo en cuenta el query string.
     * Excepción: GET /api/v1/clientes?email=... (buscar la propia ficha) no exige ADMIN.
     */
    public static String rolRequerido(HttpMethod metodo, String ruta, String query) {
        // Buscar un cliente por correo exacto es para cualquier usuario autenticado.
        boolean buscaPorEmail = HttpMethod.GET.equals(metodo)
                && "/api/v1/clientes".equals(ruta)
                && query != null && query.contains("email=");
        if (buscaPorEmail) {
            return null;
        }
        PathContainer path = PathContainer.parsePath(ruta);
        return REGLAS.stream()
                .filter(r -> r.calza(metodo, path))
                .findFirst()
                .map(Regla::rol)
                .orElse(null);
    }

    private static Regla regla(Set<HttpMethod> metodos, String ruta, String rol) {
        return new Regla(metodos, PARSER.parse(ruta), rol);
    }
}
