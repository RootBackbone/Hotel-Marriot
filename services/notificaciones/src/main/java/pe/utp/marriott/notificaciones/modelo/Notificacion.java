package pe.utp.marriott.notificaciones.modelo;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "notificacion")
@Getter
@Setter
@NoArgsConstructor
public class Notificacion {

    @Id
    @Column(length = 20)
    private String id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Canal canal;

    @Column(nullable = false, length = 150)
    private String destinatario;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Plantilla plantilla;

    @Column(length = 200)
    private String asunto;

    @Column(columnDefinition = "text")
    private String mensaje;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private EstadoNotificacion estado;

    @Column(name = "creado_en", nullable = false)
    private OffsetDateTime creadoEn;

    @Column(name = "enviado_en")
    private OffsetDateTime enviadoEn;
}
