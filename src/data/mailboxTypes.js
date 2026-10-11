export const MAILBOX_TYPES = {
  "Aplicativo": {
    "i": "phone",
    "sc": "Solo para mejoras de la web, mejoras del sistema y errores que hayas detectado.",
    "lbl": "¿Qué quieres enviarnos?",
    "send": "Enviar al equipo",
    "dn": "Sugerencia archivada",
    "err": 2,
    "tipos": [
      [
        "Mejora de la web",
        "Diseño, navegación o contenido de la página",
        "monitor"
      ],
      [
        "Mejora del sistema",
        "Funciones, datos o procesos que podrían ser mejores",
        "sliders"
      ],
      [
        "Error detectado",
        "Algo no funciona como debería",
        "bug"
      ]
    ],
    "ph": [
      "Cuéntanos qué cambiarías en la página y por qué te ayudaría…",
      "Cuéntanos qué función o proceso del sistema podría mejorar y cómo…",
      "Describe el error con el mayor detalle posible…"
    ],
    "tpl": "¿Qué intentabas hacer?\n\n¿Qué esperabas que pasara?\n\n¿Qué ocurrió en realidad?\n",
    "f": [
      [
        "ref",
        "Sección de la página",
        "sel",
        [
          "Inicio",
          "Malla Curricular",
          "Calendario/Horarios",
          "Grupos de estudio",
          "Mod Focus",
          "Asesor IA",
          "Brújula IA",
          "Recursos",
          "Buzón de sugerencias",
          "Toda la página"
        ],
        "Selecciona una sección",
        [
          2
        ]
      ]
    ],
    "tips": [
      "Indica en qué sección ocurre y qué cambiarías.",
      "Si es un error, cuéntanos qué hacías, qué esperabas y qué ocurrió.",
      "Un mensaje por tema nos ayuda a priorizar mejor."
    ],
    "after": [
      "Recibimos tu mensaje y lo clasificamos por tipo.",
      "El equipo del aplicativo lo revisa.",
      "Lo tenemos en cuenta al priorizar los próximos cambios."
    ],
    "pv": "No escribas contraseñas ni datos personales en tu mensaje.",
    "ok": "Gracias por ayudarnos a mejorar la página. Revisaremos tu mensaje al priorizar los próximos cambios."
  },
  "Docente": {
    "i": "teach",
    "sc": "Comentarios para los docentes: en qué pueden mejorar, qué está bien y cualquier otro mensaje.",
    "lbl": "¿Qué quieres comentar?",
    "send": "Enviar comentario",
    "dn": "Comentario archivado",
    "tipos": [
      [
        "En qué mejorar",
        "Aspectos del docente o del curso que podrían cambiar",
        "trend"
      ],
      [
        "Lo que está bien",
        "Reconoce lo que funciona y debería mantenerse",
        "thumb"
      ],
      [
        "Otros comentarios",
        "Cualquier otro mensaje para el docente",
        "msg"
      ]
    ],
    "ph": [
      "Describe qué podría mejorar: qué pasó, cuándo y cómo afectó tu aprendizaje…",
      "Cuéntanos qué hace bien el docente y por qué te sirve…",
      "Escribe tu comentario con respeto y de forma concreta…"
    ],
    "f": [
      [
        "course",
        "Curso",
        "sel",
        [],
        "Selecciona un curso",
        1
      ],
      [
        "who",
        "Docente",
        "txt",
        null,
        "Nombre del docente"
      ],
      [
        "asp",
        "Aspecto",
        "sel",
        [
          "Explicación de los temas",
          "Evaluaciones y retroalimentación",
          "Material y recursos",
          "Trato y comunicación",
          "Organización y puntualidad",
          "Otro aspecto"
        ],
        "Selecciona un aspecto"
      ]
    ],
    "anon": 1,
    "ad": "Tu nombre no se asocia al comentario.",
    "tips": [
      "Describe hechos concretos: qué pasó y cuándo.",
      "Propón qué podría cambiar o qué debería mantenerse.",
      "Evita insultos y datos personales de terceros."
    ],
    "after": [
      "Tu comentario queda archivado con el curso indicado.",
      "Se revisa antes de derivarse.",
      "Sirve como referencia para mejorar la enseñanza."
    ],
    "pv": "Con el anonimato activado, tu nombre no se asocia al comentario.",
    "ok": "Gracias por compartir tu experiencia. Tu comentario quedó guardado para su revisión."
  },
  "Universidad": {
    "i": "landmark",
    "sc": "Qué aspectos de la universidad podrían mejorar, qué se podría agregar y otros comentarios.",
    "lbl": "¿Qué quieres proponer?",
    "send": "Enviar mensaje",
    "dn": "Mensaje archivado",
    "tipos": [
      [
        "Aspectos a mejorar",
        "Servicios, trámites o espacios que podrían ser mejores",
        "trend"
      ],
      [
        "Algo que agregar",
        "Servicios, recursos o actividades que hoy faltan",
        "plus"
      ],
      [
        "Otros comentarios",
        "Cualquier otro mensaje para la universidad",
        "msg"
      ]
    ],
    "ph": [
      "Cuéntanos qué ocurre, dónde y qué cambiarías…",
      "Cuéntanos qué te gustaría que existiera y para qué serviría…",
      "Escribe tu mensaje con el mayor detalle posible…"
    ],
    "f": [
      [
        "ref",
        "Área o servicio",
        "sel",
        [
          "Biblioteca",
          "Secretaría Académica",
          "Bienestar Estudiantil",
          "Tecnologías de la información",
          "Cafetería y servicios",
          "Infraestructura y aulas",
          "Seguridad y campus",
          "Otra área"
        ],
        "Selecciona un área"
      ]
    ],
    "anon": 0,
    "ad": "Si lo desactivas, el mensaje se envía con tu nombre.",
    "tips": [
      "Indica el área o servicio y dónde ocurre.",
      "Cuéntanos qué cambiaría para ti y para otros estudiantes.",
      "Si propones algo nuevo, explica para qué serviría."
    ],
    "after": [
      "Tu mensaje queda archivado con el área indicada.",
      "Se revisa y se deriva al área correspondiente.",
      "Se tiene en cuenta como aporte de los estudiantes."
    ],
    "pv": "Puedes enviarlo con tu nombre o de forma anónima.",
    "ok": "Gracias por escribirnos. Tu mensaje quedó registrado y se derivará al área que corresponda."
  }
}
