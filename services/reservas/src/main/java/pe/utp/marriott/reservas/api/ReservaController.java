package pe.utp.marriott.reservas.api;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.utp.marriott.reservas.servicio.OrquestadorReservas;
import pe.utp.marriott.reservas.servicio.ReservasIdempotentes;

@RestController
@RequestMapping("/api/v1/reservas")
public class ReservaController {

    private final ReservasIdempotentes idempotentes;
    private final OrquestadorReservas orquestador;

    public ReservaController(ReservasIdempotentes idempotentes, OrquestadorReservas orquestador) {
        this.idempotentes = idempotentes;
        this.orquestador = orquestador;
    }

    /** Reserva integrada: habitación + tour y/o paquete + pago. 201, 400, 402 o 409. */
    @PostMapping
    public ResponseEntity<?> crear(@RequestHeader(name = "Idempotency-Key", required = false) String clave,
                                   @Valid @RequestBody CrearReservaRequest req) {
        return idempotentes.crear(clave, req);
    }
	
	 @GetMapping("/todas")
    public List<ReservaResponse> listarTodas() {
        return orquestador.listarTodas().stream().map(ReservaResponse::de).toList();
    }

    @GetMapping("/{id}")
    public ReservaResponse obtener(@PathVariable String id) {
        return ReservaResponse.de(orquestador.obtener(id));
    }

    @GetMapping
    public List<ReservaResponse> listar(@RequestParam(name = "cliente_id") String clienteId) {
        return orquestador.listarPorCliente(clienteId).stream().map(ReservaResponse::de).toList();
    }

    @DeleteMapping("/{id}")
    public ReservaResponse cancelar(@PathVariable String id) {
        return ReservaResponse.de(orquestador.cancelar(id));
    }
}
