package pe.utp.marriott.notificaciones.servicio;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;
import pe.utp.marriott.notificaciones.modelo.Canal;
import pe.utp.marriott.notificaciones.modelo.Notificacion;

/**
 * Proveedor de correo/SMS.
 *
 * <p>Si hay un JavaMailSender configurado (SMTP real, p.ej. Gmail o Brevo) y el canal
 * es EMAIL, envía un correo de verdad. Si no hay SMTP configurado, se comporta como
 * antes: deja el mensaje en el registro del contenedor (modo simulado). Así el sistema
 * funciona con o sin credenciales de correo, y para activarlo solo hace falta definir
 * las variables de entorno SMTP (ver application.yml).</p>
 */
@Component
public class ProveedorMensajeria {

    private static final Logger log = LoggerFactory.getLogger(ProveedorMensajeria.class);

    /** Puede ser null si no hay starter-mail/credenciales: en ese caso se simula. */
    private final JavaMailSender mailSender;
    private final String remitente;

    public ProveedorMensajeria(
            org.springframework.beans.factory.ObjectProvider<JavaMailSender> mailSenderProvider,
            @Value("${notificaciones.remitente:JW Marriott Hotel Lima <no-reply@marioaponte.me>}") String remitente) {
        this.mailSender = mailSenderProvider.getIfAvailable();
        this.remitente = remitente;
    }

    public void enviar(Notificacion n) {
        boolean puedeEnviarCorreo = mailSender != null && n.getCanal() == Canal.EMAIL;
        if (puedeEnviarCorreo) {
            try {
                SimpleMailMessage msg = new SimpleMailMessage();
                msg.setFrom(remitente);
                msg.setTo(n.getDestinatario());
                msg.setSubject(n.getAsunto());
                msg.setText(n.getMensaje());
                mailSender.send(msg);
                log.info("Correo enviado a {} | {}", n.getDestinatario(), n.getAsunto());
                return;
            } catch (RuntimeException ex) {
                // Si el SMTP falla, no perdemos la notificación: la dejamos registrada y
                // relanzamos para que el despachador la marque como FALLIDA.
                log.warn("Fallo al enviar correo a {}: {}", n.getDestinatario(), ex.getMessage());
                throw ex;
            }
        }
        // Modo simulado (sin SMTP o canal SMS): queda en el log del contenedor.
        log.info("[{}] a {} | {} | {}", n.getCanal(), n.getDestinatario(), n.getAsunto(), n.getMensaje());
    }
}
