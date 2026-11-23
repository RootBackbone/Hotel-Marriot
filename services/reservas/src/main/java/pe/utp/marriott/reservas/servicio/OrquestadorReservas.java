package pe.utp.marriott.reservas.servicio;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import pe.utp.marriott.reservas.api.CrearReservaRequest;
import pe.utp.marriott.reservas.comun.Fechas;
import pe.utp.marriott.reservas.comun.Secuencias;
import pe.utp.marriott.reservas.error.ApiException;
import pe.utp.marriott.reservas.integracion.ClientesClient;
import pe.utp.marriott.reservas.integracion.ErrorRemoto;
import pe.utp.marriott.reservas.integracion.HabitacionesClient;
import pe.utp.marriott.reservas.integracion.NotificacionesClient;
import pe.utp.marriott.reservas.integracion.PagosClient;
import pe.utp.marriott.reservas.integracion.PaquetesClient;
import pe.utp.marriott.reservas.integracion.Remotos;
import pe.utp.marriott.reservas.integracion.ToursClient;
import pe.utp.marriott.reservas.modelo.EstadoReserva;
import pe.utp.marriott.reservas.modelo.Reserva;
import pe.utp.marriott.reservas.modelo.ReservaRepository;

/**
 * Servicio de proceso: compone Clientes, Habitaciones, Tours, Paquetes, Pagos y Notificaciones
 * para la reserva integrada. No hay una transacción distribuida: cada paso que ya se hizo se
 * deshace con su compensación si un paso posterior falla (patrón Saga orquestada).
 */
@Service
public class OrquestadorReservas {

    private static final Logger log = LoggerFactory.getLogger(OrquestadorReservas.class);

    private final ReservaRepository reservas;
    private final Secuencias secuencias;
    private final ClientesClient clientes;
    private final HabitacionesClient habitaciones;
    private final ToursClient tours;
    private final PaquetesClient paquetes;
    private final PagosClient pagos;
    private final NotificacionesClient notificaciones;

    public OrquestadorReservas(ReservaRepository reservas, Secuencias secuencias, ClientesClient clientes,
                               HabitacionesClient habitaciones, ToursClient tours, PaquetesClient paquetes,
                               PagosClient pagos, NotificacionesClient notificaciones) {
        this.reservas = reservas;
        this.secuencias = secuencias;
        this.clientes = clientes;
        this.habitaciones = habitaciones;
        this.tours = tours;
        this.paquetes = paquetes;
        this.pagos = pagos;
        this.notificaciones = notificaciones;
    }

    public Reserva crear(CrearReservaRequest req) {
        validarFechas(req.desde(), req.hasta());

        // 1. Validar referencias y calcular el total (solo lecturas: nada que compensar).
        Remotos.Cliente cliente = referencia(() -> clientes.obtener(req.clienteId()),
                "CLIENTE_NO_ENCONTRADO", "El cliente " + req.clienteId() + " no existe.");
        if (!"ACTIVO".equals(cliente.estado())) {
            throw ApiException.solicitudInvalida("CLIENTE_INACTIVO", "El cliente " + cliente.id() + " no está activo.");
        }
        Remotos.Habitacion habitacion = referencia(() -> habitaciones.obtener(req.habitacionId()),
                "HABITACION_NO_ENCONTRADA", "La habitación " + req.habitacionId() + " no existe.");
        Remotos.Tour tour = req.tourId() == null ? null : referencia(() -> tours.obtener(req.tourId()),
                "TOUR_NO_ENCONTRADO", "El tour " + req.tourId() + " no existe.");
        Remotos.Paquete paquete = req.paqueteId() == null ? null : referencia(() -> paquetes.obtener(req.paqueteId()),
                "PAQUETE_NO_ENCONTRADO", "El paquete " + req.paqueteId() + " no existe.");

        if (tour != null && (tour.fecha().isBefore(req.desde()) || tour.fecha().isAfter(req.hasta()))) {
            throw ApiException.solicitudInvalida("TOUR_FUERA_DE_ESTADIA",
                    "El tour " + tour.id() + " es el " + tour.fecha() + ", fuera de la estadía.");
        }
        if (paquete != null && !paquete.activo()) {
            throw ApiException.solicitudInvalida("PAQUETE_INACTIVO", "El paquete " + paquete.id() + " ya no se ofrece.");
        }

        String moneda = habitacion.moneda();
        int noches = (int) ChronoUnit.DAYS.between(req.desde(), req.hasta());
        BigDecimal total = habitacion.tarifaNoche().multiply(BigDecimal.valueOf(noches));
        List<String> items = new ArrayList<>();
        items.add(habitacion.id() + " x" + noches + (noches == 1 ? " noche" : " noches"));
        if (tour != null) {
            exigirMoneda(moneda, tour.moneda(), tour.id());
            total = total.add(tour.precio());
            items.add(tour.id());
        }
        if (paquete != null) {
            exigirMoneda(moneda, paquete.moneda(), paquete.id());
            total = total.add(paquete.precio());
            items.add(paquete.id());
        }
        total = total.setScale(2, RoundingMode.HALF_UP);

        // 2. La reserva nace PENDIENTE: ya tiene id para referenciarla en los demás servicios.
        Reserva r = new Reserva();
        r.setId(secuencias.siguiente("seq_reserva", "RES", 6));
        r.setClienteId(cliente.id());
        r.setHabitacionId(habitacion.id());
        r.setTourId(req.tourId());
        r.setPaqueteId(req.paqueteId());
        r.setDesde(req.desde());
        r.setHasta(req.hasta());
        r.setNoches(noches);
        r.setTotal(total);
        r.setMoneda(moneda);
        r.setListaItems(items);
        r.setEstado(EstadoReserva.PENDIENTE);
        r.setCreadoEn(Fechas.ahora());
        r = reservas.save(r);

        boolean habitacionBloqueada = false;
        boolean tourReservado = false;
        String txnCobrado = null;
        try {
            // 3. Bloquear el cupo de la habitación.
            try {
                habitaciones.bloquear(habitacion.id(), r.getId(), req.desde(), req.hasta());
                habitacionBloqueada = true;
            } catch (ErrorRemoto e) {
                throw traducir(e, HttpStatus.CONFLICT, Map.of("sugerencias", e.getCuerpo().getOrDefault("sugerencias", List.of())));
            }

            // 4. Reservar el tour.
            if (tour != null) {
                try {
                    tours.reservar(tour.id(), cliente.id(), r.getId());
                    tourReservado = true;
                } catch (ErrorRemoto e) {
                    throw traducir(e, HttpStatus.CONFLICT, Map.of());
                }
            }

            // 5. Cobrar. Es el último paso: si falla, se deshace todo lo anterior.
            Remotos.Pago pago;
            try {
                pago = pagos.cobrar(total, moneda, req.pago().metodo(), req.pago().tokenTarjeta(), r.getId());
            } catch (ErrorRemoto e) {
                throw traducir(e, e.getStatus() == 402 ? HttpStatus.PAYMENT_REQUIRED : HttpStatus.BAD_REQUEST, Map.of());
            }
            txnCobrado = pago.txnId();

            r.setEstado(EstadoReserva.CONFIRMADA);
            r.setPagoTxnId(pago.txnId());
            r.setPagoEstado(pago.estado());
            r.setActualizadoEn(Fechas.ahora());
            r = reservas.save(r);
        } catch (RuntimeException fallo) {
            compensar(r, habitacionBloqueada, tourReservado, txnCobrado, fallo);
            throw fallo;
        }

        notificaciones.avisar(cliente.email(), "RESERVA_CONFIRMADA",
                datosAviso(r, cliente, habitacion, paquete, tour));
        return r;
    }

    public Reserva obtener(String id) {
        return reservas.findById(id).orElseThrow(() -> ApiException.noEncontrado("La reserva", id));
    }

    public List<Reserva> listarPorCliente(String clienteId) {
        return reservas.findByClienteIdOrderByCreadoEnDesc(clienteId);
    }
	/** Todas las reservas (para el panel de administración). */
    public List<Reserva> listarTodas() {
        return reservas.findAll();
    }


    /**
     * Cancela una reserva confirmada: libera la habitación, devuelve el cupo del tour y reembolsa.
     * Cada paso es idempotente en su servicio, así que si algo falla a la mitad se puede reintentar.
     */
    public Reserva cancelar(String id) {
        Reserva r = obtener(id);
        if (r.getEstado() == EstadoReserva.CANCELADA) {
            throw ApiException.conflicto("YA_CANCELADA", "La reserva " + id + " ya estaba cancelada.");
        }
        if (r.getEstado() == EstadoReserva.PENDIENTE) {
            throw ApiException.conflicto("RESERVA_EN_PROCESO", "La reserva " + id + " aún se está procesando.");
        }
        if (!Fechas.ahora().toLocalDate().isBefore(r.getDesde())) {
            throw ApiException.conflicto("NO_CANCELABLE",
                    "La estadía de la reserva " + id + " ya empezó; acérquese a recepción.");
        }

        habitaciones.liberar(r.getId());
        if (r.getTourId() != null) {
            tours.cancelar(r.getId());
        }
        if (r.getPagoTxnId() != null) {
            Remotos.Pago reembolso = pagos.reembolsar(r.getPagoTxnId());
            r.setPagoEstado(reembolso.estado());
        }
        r.setEstado(EstadoReserva.CANCELADA);
        r.setMotivo("Cancelada por el cliente.");
        r.setActualizadoEn(Fechas.ahora());
        r = reservas.save(r);

        try {
            Remotos.Cliente cliente = clientes.obtener(r.getClienteId());
            notificaciones.avisar(cliente.email(), "RESERVA_CANCELADA", datosAviso(r, cliente));
        } catch (RuntimeException e) {
            log.warn("Reserva {} cancelada sin aviso al cliente: {}", r.getId(), e.getMessage());
        }
        return r;
    }

    private void compensar(Reserva r, boolean habitacionBloqueada, boolean tourReservado, String txnCobrado,
                           RuntimeException fallo) {
        log.info("Reserva {} no se completó ({}): compensando", r.getId(), fallo.getMessage());
        if (txnCobrado != null) {
            intentar(() -> pagos.reembolsar(txnCobrado), "reembolsar el cobro " + txnCobrado, r.getId());
        }
        if (tourReservado) {
            intentar(() -> tours.cancelar(r.getId()), "devolver el cupo del tour", r.getId());
        }
        if (habitacionBloqueada) {
            intentar(() -> habitaciones.liberar(r.getId()), "liberar la habitación", r.getId());
        }
        r.setEstado(EstadoReserva.CANCELADA);
        r.setMotivo(fallo.getMessage() == null ? "Flujo no completado." : truncar(fallo.getMessage()));
        r.setActualizadoEn(Fechas.ahora());
        intentar(() -> reservas.save(r), "marcar la reserva como cancelada", r.getId());
    }

    private static void intentar(Runnable paso, String que, String reservaId) {
        try {
            paso.run();
        } catch (RuntimeException e) {
            // Queda en el registro para revisión manual: el resto de la compensación sigue.
            log.error("Compensación pendiente: no se pudo {} de la reserva {}", que, reservaId, e);
        }
    }

    /** Una referencia del cuerpo que no existe es un error de la solicitud (400), no del recurso /reservas. */
    private static <T> T referencia(Supplier<T> lectura, String codigo, String mensaje) {
        try {
            return lectura.get();
        } catch (ErrorRemoto e) {
            if (e.getStatus() == 404) {
                throw ApiException.solicitudInvalida(codigo, mensaje);
            }
            throw ApiException.solicitudInvalida(e.codigo(), e.mensaje());
        }
    }

    private static ApiException traducir(ErrorRemoto e, HttpStatus status, Map<String, Object> extra) {
        return new ApiException(status, e.codigo(), e.mensaje(), extra);
    }

    private static void validarFechas(LocalDate desde, LocalDate hasta) {
        if (!desde.isBefore(hasta)) {
            throw ApiException.solicitudInvalida("FECHAS_INVALIDAS", "'desde' debe ser anterior a 'hasta'.");
        }
        if (desde.isBefore(Fechas.ahora().toLocalDate())) {
            throw ApiException.solicitudInvalida("FECHAS_INVALIDAS", "No se puede reservar en una fecha pasada.");
        }
    }

    private static void exigirMoneda(String esperada, String recibida, String item) {
        if (!esperada.equals(recibida)) {
            throw ApiException.solicitudInvalida("MONEDA_DISTINTA",
                    item + " está en " + recibida + " y la habitación en " + esperada + ".");
        }
    }

    /** Datos para la cancelación (sin desglose de extras). */
    private static Map<String, String> datosAviso(Reserva r, Remotos.Cliente cliente) {
        return datosAviso(r, cliente, null, null, null);
    }

    /** Datos para la confirmación: usa los nombres de habitación, paquete y tour. */
    private static Map<String, String> datosAviso(Reserva r, Remotos.Cliente cliente,
            Remotos.Habitacion habitacion, Remotos.Paquete paquete, Remotos.Tour tour) {
        Map<String, String> datos = new LinkedHashMap<>();
        datos.put("nombre", cliente.nombres());
        datos.put("reserva_id", r.getId());
        datos.put("habitacion", habitacion != null
                ? nombreHabitacion(habitacion.tipo()) + " (" + habitacion.id() + ")"
                : r.getHabitacionId());
        datos.put("desde", r.getDesde().toString());
        datos.put("hasta", r.getHasta().toString());
        datos.put("noches", String.valueOf(r.getNoches()));
        datos.put("moneda", r.getMoneda());
        datos.put("total", r.getTotal().toPlainString());
        datos.put("desglose", filasDesglose(paquete, tour));
        return datos;
    }

    private static String nombreHabitacion(String tipo) {
        if (tipo == null) return "Habitación";
        switch (tipo.toUpperCase()) {
            case "SIMPLE":        return "Habitación Deluxe";
            case "DOBLE":         return "Habitación Doble Superior";
            case "SUITE":         return "Suite Ejecutiva";
            case "PRESIDENCIAL":  return "Suite Presidencial";
            default:              return "Habitación " + tipo;
        }
    }

    /** Filas HTML con los extras (paquete y tour), usando sus nombres. */
    private static String filasDesglose(Remotos.Paquete paquete, Remotos.Tour tour) {
        StringBuilder sb = new StringBuilder();
        if (paquete != null) {
            sb.append(filaExtra("Paquete", paquete.nombre()));
        }
        if (tour != null) {
            sb.append(filaExtra("Tour", tour.nombre()));
        }
        return sb.toString();
    }

    private static String filaExtra(String etiqueta, String valor) {
        return "<tr><td style=\"padding:8px 0;border-top:1px solid #e6e9ee;color:#5c6472\">"
                + etiqueta + "</td>"
                + "<td align=\"right\" style=\"padding:8px 0;border-top:1px solid #e6e9ee\">"
                + valor + "</td></tr>";
    }

    private static String truncar(String texto) {
        return texto.length() <= 300 ? texto : texto.substring(0, 300);
    }
}
