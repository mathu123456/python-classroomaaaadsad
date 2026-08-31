# Prompts de las fases pendientes — Python Classroom

> **Estado: las tres fases de este documento ya están construidas.**
> Se conservan los prompts tal cual, como especificación de lo que había que
> hacer y como referencia para revisar el resultado. Lo construido y cómo
> verificarlo está en el README; lo que quedó fuera del alcance o sin poder
> comprobar está dicho allí explícitamente.

Copia y pega el bloque de la fase que vayas a construir. Cada prompt es
autosuficiente: incluye el estado real del proyecto para que quien lo lea no
reconstruya lo que ya existe.

- [Fase 4 — Gamificación: insignias, premios y rankings](#fase-4)
- [Fase 5 — Estadísticas, informes y formato .pclass](#fase-5)
- [Fase 6 — Empaquetado, instaladores y actualizaciones](#fase-6)

---

<a name="fase-4"></a>

# FASE 4 — GAMIFICACIÓN: INSIGNIAS, PREMIOS Y RANKINGS
## PYTHON CLASSROOM

Construye la FASE 4 del proyecto Python Classroom.

==================================================
1. ESTADO ACTUAL DEL PROYECTO
==================================================

Las fases anteriores ya están terminadas y probadas. NO las reconstruyas.

YA EXISTE Y FUNCIONA:

- Electron + HTML + CSS nativo + JavaScript, sin frameworks.
- Editor CodeMirror 6 con autocompletado y comprobación de sintaxis.
- Python 3.11.9 embebido, consola, terminal y gestor de librerías con pip.
- SQLite local en `<userData>/python-classroom.db` (módulo `electron/sqlite.js`).
- Firebase Authentication (correo y contraseña) y Realtime Database.
- Security Rules publicadas en `firebase/database.rules.json`.
- Cola de sincronización SQLite → Firebase en `src/js/sync.js`.
- Temarios, ejercicios, clases, retos, entregas por intento, revisión con
  comentarios por línea, calificación con rúbrica e historial de notas.
- XP: se otorga al calificar y se acumula en `student_progress`.
- Progreso por tema, promedio, tiempo dedicado.
- `work.buildRankings()` YA CALCULA ranking global, por tema y por grado, y
  `sync.js` YA LO PUBLICA en el nodo `rankings/` de Firebase.

LO QUE FALTA Y ES EL OBJETO DE ESTA FASE:

- No hay ninguna pantalla que muestre los rankings.
- No existen insignias.
- No existen premios ni su concesión.
- Los retos tienen entidad y se pueden crear, pero el estudiante no los puede
  resolver como tales.

==================================================
2. ARQUITECTURA OBLIGATORIA
==================================================

Mantener exactamente la que ya hay:

- Electron.js, HTML, CSS nativo, JavaScript, CodeMirror.
- SQLite para lo local y offline.
- Firebase Authentication y Realtime Database.

NO utilizar: Django, Express, MongoDB, MySQL, PostgreSQL, Google Sheets,
Google Drive, Firebase Storage, Cloud Functions, servidores propios, ni
librerías de gráficas o de UI.

==================================================
3. REGLA DE SEGURIDAD QUE NO SE PUEDE ROMPER
==================================================

En la fase 3 se estableció que el XP y las notas SOLO los escribe el profesor,
y las Security Rules lo imponen.

Las insignias y los premios siguen la misma regla:

- El cliente del estudiante puede CALCULAR qué insignias le corresponden y
  mostrarlas, pero NUNCA las escribe en Firebase.
- La concesión real la escribe el cliente del profesor, en el mismo momento en
  que califica y recalcula rankings.
- Las reglas deben rechazar cualquier escritura de un estudiante en
  `badges/`, `userBadges/`, `rewards/` y `rankings/`.

Actualiza `firebase/database.rules.json` en consecuencia y documenta el cambio
en `firebase/CONFIGURACION.md`.

==================================================
4. MODELO DE DATOS
==================================================

Añadir a `electron/sqlite.js` (subir la versión del esquema y migrar sin
perder datos):

badges
    id
    name
    description
    icon            nombre de un símbolo del sprite de src/index.html
    color
    type            auto | manual
    rule            JSON con la condición (solo si type = auto)
    xpBonus
    active
    createdBy
    createdAt
    updatedAt

user_badges
    id
    studentId
    badgeId
    grantedAt
    grantedBy
    reason
    PRIMARY KEY compuesta (studentId, badgeId)

rewards
    id
    scope           global | topic | challenge
    topicId
    position        1 | 2 | 3
    badgeId
    title
    description
    active

En Firebase:

    badges/<id>
    userBadges/<uid>/<badgeId>
    rewards/<id>
    rankings/                 (ya existe)

==================================================
5. REGLAS DE INSIGNIA AUTOMÁTICA
==================================================

Cada regla debe poder evaluarse LOCALMENTE con lo que ya hay en SQLite. No
inventes condiciones que no se puedan comprobar.

Tipos mínimos:

    exercises_completed     >= N
    topic_completed         topicId concreto al 100 %
    perfect_scores          >= N entregas con la nota máxima
    challenges_completed    >= N
    no_late                 >= N entregas seguidas a tiempo
    fast_finish             entregado en menos del X % del tiempo límite
    streak_days             >= N días distintos con actividad
    first_submission        la primera entrega de su vida

Ejemplo de regla guardada:

    { "tipo": "exercises_completed", "n": 10 }
    { "tipo": "topic_completed", "topicId": "topic_xxx" }
    { "tipo": "fast_finish", "porcentaje": 50 }

Catálogo sugerido que el profesor puede cargar de una vez, igual que se hizo
con el temario sugerido:

    Pythonista          primera entrega
    Constante           10 ejercicios completados
    Maestro de lógica   5 notas perfectas
    Velocista           terminar en menos de la mitad del tiempo
    Puntual             10 entregas seguidas a tiempo
    Retador             completar un reto
    Maestro del tema    completar un tema entero

==================================================
6. CUÁNDO SE EVALÚAN
==================================================

La evaluación de insignias automáticas se dispara en el cliente del PROFESOR,
justo después de calificar, en el mismo flujo que ya recalcula el progreso y
publica los rankings.

    calificar
        ↓
    recalcular progreso
        ↓
    evaluar insignias automáticas del estudiante
        ↓
    conceder las nuevas (SQLite + cola de sincronización)
        ↓
    recalcular y publicar rankings
        ↓
    señal userSignals/<uid>/lastChange

Nunca conceder dos veces la misma insignia: la clave primaria compuesta lo
impide, pero compruébalo antes para no ensuciar la cola.

==================================================
7. PANTALLA DE RANKINGS
==================================================

Nueva página, accesible desde la barra de actividad, con tres pestañas:

    General   ·   Por tema   ·   Por grado

Ejemplo:

    🏆 RANKING GENERAL

    🥇  Juan Pérez        4270 XP    24 ejercicios
    🥈  María Gómez       4190 XP    23 ejercicios
    🥉  Carlos Díaz       4010 XP    22 ejercicios
     4   Ana Torres       3880 XP    21 ejercicios

    ─────────────────────────────────────────────
    TU POSICIÓN
     7   Mathias Corzo    3210 XP    18 ejercicios

Requisitos:

- El estudiante siempre ve su posición aunque no esté entre los primeros.
- El profesor puede limitar cuántos puestos se muestran a los estudiantes
  (opción en configuración, guardada en `config/` de Firebase).
- Sin conexión se muestra el último ranking descargado, con la fecha:
  "Actualizado hace 2 horas".
- No añadir escuchas permanentes sobre `rankings/`: se lee al entrar y cuando
  cambia `config/lastChange`.

==================================================
8. VITRINA DE INSIGNIAS
==================================================

En el tablero del estudiante, una sección con sus insignias:

    🐍 Pythonista     🔥 Retador     ⚡ Velocista
    🧠 Maestro        📚 Constante   🔒 (bloqueada)

- Las conseguidas en color, con la fecha y el motivo.
- Las que aún no tiene, en gris y con la condición que falta:
  "Te faltan 3 ejercicios".
- Al pulsar una, un diálogo con su descripción y cómo se consigue.

==================================================
9. PANEL DE PREMIOS DEL PROFESOR
==================================================

Nueva pestaña en la página de curso:

- Crear, editar y desactivar insignias.
- Cargar el catálogo sugerido.
- Conceder una insignia manualmente a un estudiante, con motivo escrito.
- Configurar premios por posición de ranking (1.º, 2.º y 3.º), en el ranking
  general o en el de un tema concreto.
- Ver quién tiene cada insignia.

Ejemplo de concesión manual:

    🎖 Premio especial

    Estudiante:  Juan Pérez
    Insignia:    Maestro de funciones
    Motivo:      "Excelente trabajo durante el proyecto."

    Otorgado por: Ana Ruiz  ·  hoy 10:42

==================================================
10. RETOS RESOLUBLES
==================================================

Los retos ya se crean, pero el estudiante no los puede resolver.

- Un reto puede tener un ejercicio asociado (`exerciseId`, campo ya existente).
- En la página de Ejercicios, sección "🔥 Retos", con su dificultad, XP, premio
  y fechas.
- Al comenzarlo se reutiliza EXACTAMENTE el mismo flujo de
  `src/js/exercise-session.js`: no crees un sistema paralelo.
- Al calificarlo, si el reto tiene premio, se concede la insignia asociada.

==================================================
11. RENDIMIENTO
==================================================

Pensado para unos 100 estudiantes.

- El ranking se recalcula solo cuando cambia algo (una calificación), no en un
  temporizador.
- La consulta de ranking en SQLite debe usar los índices que ya existen.
- No descargar `userBadges/` entero: cada estudiante lee el suyo, el profesor
  los lee todos solo cuando abre el panel de premios.

==================================================
12. QUÉ NO HACER EN ESTA FASE
==================================================

- Tienda de premios con monedas o economía virtual.
- Niveles, avatares o personalización.
- Notificaciones push.
- Animaciones pesadas al conseguir una insignia: basta un aviso discreto.
- Estadísticas ni gráficas del profesor (eso es la fase 5).
- Instaladores (fase 6).

==================================================
13. VERIFICACIÓN
==================================================

Amplía `scripts/e2e-fase3.js` o crea `scripts/e2e-fase4.js` enganchado igual,
usando el doble de Firebase de `src/js/test/fake-firebase.js`.

Debe comprobarse de extremo a extremo:

1. El profesor carga el catálogo de insignias y crea una manual.
2. Un estudiante completa un ejercicio y recibe automáticamente la insignia
   de primera entrega.
3. La insignia aparece en su vitrina con fecha y motivo.
4. La insignia NO se concede dos veces al recalificar.
5. Un estudiante NO puede escribir en `userBadges/` (las reglas lo rechazan).
6. El ranking general muestra el orden correcto por XP.
7. El estudiante ve su posición aunque esté fuera de los primeros puestos.
8. Sin conexión se muestra el ranking descargado con su fecha.
9. Un reto con ejercicio asociado se puede resolver y entregar.
10. Al calificar el reto se concede el premio configurado.

Todas las pruebas anteriores (99) deben seguir pasando.

==================================================
14. CALIDAD
==================================================

- Reutiliza `ui.js`, `router.js`, `dashboard.js` y el sistema de páginas.
- Reutiliza la cola de sincronización: no escribas en Firebase directamente
  desde la interfaz.
- Sin funciones gigantes, sin duplicación, sin variables globales innecesarias.
- Comentarios solo donde expliquen una decisión no obvia.
- Nada de datos de ejemplo: si algo aún no existe, muestra un guion o un estado
  vacío honesto.

---

<a name="fase-5"></a>

# FASE 5 — ESTADÍSTICAS, INFORMES Y FORMATO .PCLASS
## PYTHON CLASSROOM

Construye la FASE 5 del proyecto Python Classroom.

==================================================
1. ESTADO ACTUAL
==================================================

Fases 1 a 4 terminadas. NO reconstruyas nada de eso.

Ya existe: editor, Python embebido, SQLite, Firebase, temarios, ejercicios,
clases, retos, entregas por intento, revisión con comentarios por línea,
calificación con rúbrica e historial, progreso, XP, insignias y rankings.

Falta: que el profesor pueda LEER esos datos como información útil, y poder
sacar y meter información del sistema en un formato propio.

==================================================
2. ARQUITECTURA
==================================================

La misma de siempre. Para las gráficas:

- SVG escrito a mano, sin ninguna librería.
- El pliego original lo dice explícitamente: no usar librerías enormes para
  dibujar una gráfica sencilla.

==================================================
3. ESTADÍSTICAS DEL PROFESOR
==================================================

Nueva página "Estadísticas" con:

- Promedio general del curso.
- Promedio por estudiante.
- Promedio por tema.
- Ejercicios completados, pendientes y reprobados.
- Tiempo promedio por ejercicio.
- Número medio de intentos.
- Tasa de aprobación.
- Estudiantes destacados.
- Estudiantes con dificultades.
- Retos completados.
- XP repartido.

Todo calculado en SQLite con consultas indexadas, no en JavaScript sobre
listas completas.

==================================================
4. DETECCIÓN AUTOMÁTICA DE PROBLEMAS
==================================================

El sistema debe avisar cuando un tema va mal:

    ⚠ Tema con dificultades

    Funciones

    Promedio:                2.9 / 5.0
    Estudiantes con problemas:  14 / 30
    Intentos promedio:          2.7

Criterio explícito y configurable, por ejemplo: promedio por debajo del 60 %
de la nota máxima, o más de un tercio de los estudiantes reprobados.

Documenta el criterio en la propia pantalla: el profesor tiene que saber por
qué el sistema le está avisando.

==================================================
5. GRÁFICAS
==================================================

Cinco gráficas, todas en SVG propio, legibles en tema claro y oscuro:

- Barras: promedio por tema.
- Líneas: evolución del curso en el tiempo.
- Barras: distribución de notas (0-1, 1-2, 2-3, 3-4, 4-5).
- Barras horizontales: progreso por estudiante.
- Barras: ejercicios completados por semana.

Requisitos:

- Usar las variables CSS que ya existen para los colores.
- Etiquetas legibles y con contraste suficiente.
- Al pasar el ratón, un dato concreto; nada de animaciones.
- Si no hay datos suficientes, decirlo, no dibujar una gráfica vacía.

==================================================
6. FORMATO .PCLASS
==================================================

Formato propio de intercambio, en JSON dentro de un archivo `.pclass`.

Una entrega exportada contiene:

    formato: "pclass"
    version
    exportadoEn
    studentId, studentName
    exerciseId, exerciseTitle
    submissionId
    attemptNumber
    code
    files
    status
    startedAt, submittedAt
    timeSpentSec
    grade, maxScore, xpEarned
    teacherComment
    feedback[]

La aplicación debe poder:

- Exportar una entrega.
- Exportar todas las entregas de un ejercicio.
- Exportar un ejercicio completo (para compartirlo con otro profesor).
- Importar un ejercicio desde `.pclass`.
- Validar el archivo antes de importar y explicar qué falla si está mal.
- Abrir un `.pclass` desde el explorador y verlo en modo lectura.

Nunca sobrescribir algo existente al importar sin preguntar.

==================================================
7. INFORMES
==================================================

- Exportar a CSV: notas por estudiante y por ejercicio, listo para abrir en
  una hoja de cálculo.
- Exportar a JSON: todo el curso.
- Informe imprimible en HTML de un estudiante: sus notas, su progreso, sus
  comentarios y sus insignias.

==================================================
8. IMPORTAR DATOS
==================================================

Ya existe "Exportar mis datos". Falta la contraparte:

- Importar una copia de seguridad.
- Mostrar qué se va a importar ANTES de hacerlo.
- Resolver conflictos preguntando, nunca en silencio.
- Nunca borrar lo que ya hay sin confirmación explícita.

==================================================
9. QUÉ NO HACER
==================================================

- Predicciones, recomendaciones automáticas ni inteligencia artificial.
- Gráficas interactivas complejas con zoom o filtros dinámicos.
- Envío de informes por correo.
- Instaladores (fase 6).

==================================================
10. VERIFICACIÓN
==================================================

Pruebas de extremo a extremo que comprueben:

1. Las estadísticas coinciden con los datos reales de SQLite.
2. Un tema con notas bajas dispara el aviso.
3. Cada gráfica se dibuja con el número de elementos correcto.
4. Exportar e importar un ejercicio `.pclass` lo deja idéntico.
5. Un `.pclass` corrupto se rechaza con un mensaje claro.
6. El CSV tiene tantas filas como entregas calificadas.
7. Importar avisa antes de sobrescribir.

Las pruebas anteriores deben seguir pasando.

---

<a name="fase-6"></a>

# FASE 6 — EMPAQUETADO, INSTALADORES Y ACTUALIZACIONES
## PYTHON CLASSROOM

Construye la FASE 6 del proyecto Python Classroom.

==================================================
1. ESTADO ACTUAL
==================================================

La aplicación está completa y probada en desarrollo. `electron-builder` está
en `package.json` con objetivos configurados (nsis, AppImage, deb, dmg) y con
los scripts `dist:win`, `dist:linux` y `dist:mac`, pero NUNCA se ha ejecutado
ni se ha generado ningún instalador.

==================================================
2. PROBLEMA CONOCIDO QUE HAY QUE RESOLVER PRIMERO
==================================================

Está documentado en el README y es lo primero que hay que arreglar.

El runtime de Python vive en `resources/python/runtime`. Si la aplicación se
instala en `C:\Program Files`, esa carpeta queda en solo lectura para el
usuario y `pip install` fallaría sin permisos de administrador.

Dos soluciones posibles; elige una y justifícala:

a) Copiar el runtime a `<userData>/python/runtime` en el primer arranque,
   mostrando el progreso, y usar siempre esa copia.

b) Dejar el runtime donde está y dirigir pip a un `site-packages` propio del
   usuario mediante `PIP_TARGET` y `PYTHONPATH`.

Sea cual sea, `electron/runtime.js` debe seguir siendo el único sitio que
decide qué intérprete se usa.

==================================================
3. INSTALADOR DE WINDOWS
==================================================

NSIS, con:

- Elección de carpeta de instalación.
- Acceso directo en el escritorio y en el menú inicio.
- Icono propio.
- Desinstalador que NO borre los datos del usuario sin preguntar.

Durante la instalación o el primer arranque:

    Preparando Python Classroom

    ✓ Aplicación
    ✓ Python Runtime
    ✓ pip
    ✓ Entorno de Python
    ✓ Editor
    ✓ Paquetes educativos
    ✓ Configuración

    [ ABRIR ]

Si el instalador no incluye el runtime, el primer arranque debe ofrecer
descargarlo con la pantalla que ya existe en el panel "Runtime de Python".

==================================================
4. LINUX Y MACOS
==================================================

- Linux: AppImage y .deb.
- macOS: .dmg.
- Comprobar que las rutas de `userData` son correctas en cada sistema.
- Comprobar que `node:sqlite` funciona en los tres.

Si no puedes probar macOS o Linux en la máquina donde trabajas, DILO
claramente en el informe final en lugar de afirmar que funciona.

==================================================
5. ACTUALIZACIONES
==================================================

- Preparar la aplicación para actualizarse (electron-updater o el mecanismo
  que elijas, siempre sin servidor propio: por ejemplo releases de GitHub).
- Una actualización NUNCA puede borrar:
  la base de datos SQLite, las preferencias, los proyectos ni el runtime.
- Avisar al usuario y dejar que decida cuándo instalar.
- Si no vas a activar las actualizaciones automáticas ahora, deja la
  arquitectura preparada y documenta exactamente qué falta.

==================================================
6. COPIAS DE SEGURIDAD
==================================================

- Copia de seguridad automática de la base de datos antes de cada
  actualización de esquema.
- Copia manual desde la configuración.
- Restauración desde una copia, con confirmación.
- Conservar como máximo las últimas cinco copias.

==================================================
7. TAMAÑO Y ARRANQUE
==================================================

- No empaquetar `python/cache`, `__pycache__` ni archivos temporales.
- No empaquetar `node_modules` de desarrollo.
- Medir e informar del tamaño final del instalador.
- Medir e informar del tiempo de arranque en frío.

==================================================
8. PRUEBAS DEL INSTALADOR
==================================================

Hay que probarlo de verdad, no solo generarlo:

1. Instalar en una carpeta limpia.
2. Abrir la aplicación por primera vez.
3. Crear la cuenta del profesor.
4. Escribir y ejecutar código Python.
5. Instalar una librería con pip.
6. Cerrar y volver a abrir: la sesión y los datos siguen ahí.
7. Desinstalar y comprobar que los datos del usuario NO se han borrado.
8. Volver a instalar y comprobar que todo sigue en su sitio.

Documenta el resultado de cada punto con lo que realmente ocurrió.

==================================================
9. QUÉ NO HACER
==================================================

- Firma de código con certificado de pago.
- Publicación en tiendas de aplicaciones.
- Telemetría o analítica.
- Cambios funcionales: esta fase es solo empaquetado y distribución.

==================================================
10. REGLA FINAL
==================================================

Si algo no se puede probar en el equipo donde trabajas, dilo en el informe.
Es preferible un "esto no lo he podido verificar" a una afirmación falsa.
