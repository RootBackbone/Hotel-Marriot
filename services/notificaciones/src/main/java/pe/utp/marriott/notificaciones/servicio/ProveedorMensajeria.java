package pe.utp.marriott.notificaciones.servicio;

import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import pe.utp.marriott.notificaciones.modelo.Canal;
import pe.utp.marriott.notificaciones.modelo.Notificacion;

/**
 * Proveedor de correo/SMS.
 *
 * <p>Si hay un JavaMailSender configurado (SMTP real) y el canal es EMAIL, envía un
 * correo HTML de verdad. Si no hay SMTP configurado, se comporta como antes: deja el
 * mensaje en el registro del contenedor (modo simulado). Así el sistema funciona con o
 * sin credenciales de correo.</p>
 */
@Component
public class ProveedorMensajeria {

    private static final Logger log = LoggerFactory.getLogger(ProveedorMensajeria.class);

    /** Puede ser null si no hay starter-mail/credenciales: en ese caso se simula. */
    private final JavaMailSender mailSender;
    private final String remitente;

    public ProveedorMensajeria(
            ObjectProvider<JavaMailSender> mailSenderProvider,
            @Value("${notificaciones.remitente:JW Marriott Hotel Lima <no-reply@marioaponte.me>}") String remitente) {
        this.mailSender = mailSenderProvider.getIfAvailable();
        this.remitente = remitente;
    }

    public void enviar(Notificacion n) {
        boolean puedeEnviarCorreo = mailSender != null && n.getCanal() == Canal.EMAIL;
        if (puedeEnviarCorreo) {
            try {
                MimeMessage mime = mailSender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(mime, false, "UTF-8");
                helper.setFrom(remitente);
                helper.setTo(n.getDestinatario());
                helper.setSubject(n.getAsunto());
                // true = el cuerpo es HTML.
                helper.setText(n.getMensaje(), true);
                mailSender.send(mime);
                log.info("Correo enviado a {} | {}", n.getDestinatario(), n.getAsunto());
                return;
            } catch (Exception ex) {
                // Si el SMTP falla, no perdemos la notificación: la relanzamos para que
                // el despachador la marque como FALLIDA, y queda registrada.
                log.warn("Fallo al enviar correo a {}: {}", n.getDestinatario(), ex.getMessage());
                throw new RuntimeException("No se pudo enviar el correo", ex);
            }
        }
        // Modo simulado (sin SMTP o canal SMS): queda en el log del contenedor.
        log.info("[{}] a {} | {} | {}", n.getCanal(), n.getDestinatario(), n.getAsunto(), n.getMensaje());
    }
}
