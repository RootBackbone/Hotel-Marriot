package pe.utp.marriott.notificaciones.modelo;

import java.util.Map;

/**
 * Plantillas de mensaje. Los marcadores {clave} se reemplazan con los 'datos' de la solicitud.
 * El cuerpo es HTML (en español) para que el correo se vea con formato. El asunto es texto.
 */
public enum Plantilla {

    BIENVENIDA("Bienvenido a JW Marriott Hotel Lima",
            correo(
                "¡Bienvenido, {nombre}!",
                "<p>Gracias por registrarte en el <b>JW Marriott Hotel Lima</b>. "
                + "Ya puedes reservar habitaciones, paquetes gastronómicos y tours desde nuestro sitio.</p>"
                + "<p>¡Te esperamos frente al Pacífico!</p>")),

    RESERVA_CONFIRMADA("Reserva {reserva_id} confirmada — JW Marriott Hotel Lima",
            correo(
                "¡Reserva confirmada!",
                "<p>Hola <b>{nombre}</b>, tu reserva fue confirmada con éxito. "
                + "Estos son los detalles de tu estadía:</p>"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                + "style=\"border-collapse:collapse;margin:16px 0;font-size:14px;color:#1b2430\">"
                + "<tr><td style=\"padding:8px 0;color:#5c6472\">Código de reserva</td>"
                + "<td align=\"right\" style=\"padding:8px 0;font-weight:bold;color:#1f3a5f\">{reserva_id}</td></tr>"
                + "<tr><td style=\"padding:8px 0;border-top:1px solid #e6e9ee;color:#5c6472\">Habitación</td>"
                + "<td align=\"right\" style=\"padding:8px 0;border-top:1px solid #e6e9ee\">{habitacion}</td></tr>"
                + "<tr><td style=\"padding:8px 0;border-top:1px solid #e6e9ee;color:#5c6472\">Check-in</td>"
                + "<td align=\"right\" style=\"padding:8px 0;border-top:1px solid #e6e9ee\">{desde}</td></tr>"
                + "<tr><td style=\"padding:8px 0;border-top:1px solid #e6e9ee;color:#5c6472\">Check-out</td>"
                + "<td align=\"right\" style=\"padding:8px 0;border-top:1px solid #e6e9ee\">{hasta}</td></tr>"
                + "<tr><td style=\"padding:8px 0;border-top:1px solid #e6e9ee;color:#5c6472\">Noches</td>"
                + "<td align=\"right\" style=\"padding:8px 0;border-top:1px solid #e6e9ee\">{noches}</td></tr>"
                + "{desglose}"
                + "<tr><td style=\"padding:12px 0;border-top:2px solid #b08436;font-weight:bold;font-size:16px\">Total</td>"
                + "<td align=\"right\" style=\"padding:12px 0;border-top:2px solid #b08436;font-weight:bold;font-size:16px;color:#1f3a5f\">{moneda} {total}</td></tr>"
                + "</table>"
                + "<p>Te enviaremos los detalles del check-in antes de tu llegada. "
                + "Si necesitas ayuda, escríbenos a reservas.lima@marriott.com.</p>"
                + "<p>¡Te esperamos en el JW Marriott Hotel Lima!</p>")),

    RESERVA_CANCELADA("Reserva {reserva_id} cancelada — JW Marriott Hotel Lima",
            correo(
                "Reserva cancelada",
                "<p>Hola <b>{nombre}</b>, cancelamos tu reserva <b>{reserva_id}</b>. "
                + "Si hubo un cobro, se reembolsará al mismo medio de pago.</p>"
                + "<p>Esperamos recibirte pronto.</p>"));

    private final String asunto;
    private final String cuerpo;

    Plantilla(String asunto, String cuerpo) {
        this.asunto = asunto;
        this.cuerpo = cuerpo;
    }

    public String asunto(Map<String, String> datos) {
        return rellenar(asunto, datos);
    }

    public String cuerpo(Map<String, String> datos) {
        return rellenar(cuerpo, datos);
    }

    private static String rellenar(String texto, Map<String, String> datos) {
        String resultado = texto;
        for (Map.Entry<String, String> e : datos.entrySet()) {
            String valor = e.getValue() == null ? "" : e.getValue();
            resultado = resultado.replace("{" + e.getKey() + "}", valor);
        }
        // Limpia marcadores que no recibieron valor (p.ej. {desglose} sin extras).
        resultado = resultado.replaceAll("\\{[a-zA-Z_]+\\}", "");
        return resultado;
    }

    /** Envuelve el contenido en una plantilla HTML con cabecera dorada y pie, toda en español. */
    private static String correo(String titulo, String contenido) {
        return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>"
            + "<body style=\"margin:0;background:#f3f4f2;font-family:Arial,Helvetica,sans-serif\">"
            + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f3f4f2;padding:24px 0\">"
            + "<tr><td align=\"center\">"
            + "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" "
            + "style=\"max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e9ee\">"
            // Cabecera
            + "<tr><td style=\"background:#1f3a5f;padding:28px 32px;text-align:center\">"
            + "<div style=\"font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:1px\">JW MARRIOTT</div>"
            + "<div style=\"font-size:11px;color:#c9a35a;letter-spacing:3px;margin-top:2px\">HOTEL LIMA</div>"
            + "</td></tr>"
            // Título
            + "<tr><td style=\"padding:28px 32px 0\">"
            + "<h1 style=\"margin:0;font-size:22px;color:#1f3a5f\">" + titulo + "</h1></td></tr>"
            // Contenido
            + "<tr><td style=\"padding:12px 32px 28px;font-size:14px;line-height:1.6;color:#1b2430\">"
            + contenido + "</td></tr>"
            // Pie
            + "<tr><td style=\"background:#1b2430;padding:20px 32px;text-align:center;font-size:12px;color:#c7cfdb\">"
            + "JW Marriott Hotel Lima · Malecón de la Reserva 615, Miraflores<br>"
            + "(01) 217-7000 · reservas.lima@marriott.com</td></tr>"
            + "</table></td></tr></table></body></html>";
    }
}
