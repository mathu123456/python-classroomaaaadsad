# Python Classroom

IDE educativo de Python **offline-first**: editor CodeMirror 6 + **Python real embebido**
dentro de una aplicación de escritorio Electron, con **SQLite** en local y
**Firebase** (Authentication + Realtime Database) para identidad y sincronización.

> Estado actual: **versión 2.0.0**. Las seis fases del pliego original (1.0.0) están
> construidas y probadas (núcleo, Python real, sistema académico, gamificación,
> estadísticas e instaladores), más el pulido final: sincronización con cola y
> prioridades, tiempo real, trabajo sin conexión, fotos de perfil y **entregas de
> varios archivos que el profesor ejecuta desde la propia revisión**. La 2.0.0 añade
> **Cursos**: cada profesor con los suyos, aislados de verdad hasta en Firebase, con
> código de acceso, elección de rol al registrarse (con aprobación) y asignación de
> ejercicios a estudiantes o grupos concretos -un cambio de fondo en cómo se organizan
> los datos, no solo una función más, de ahí el salto de versión-. **259 pruebas de
> extremo a extremo en verde**.
> Además hay una **app móvil** (PWA) para el estudiante en [`mobile/`](mobile/).

---

## Qué funciona hoy

### Fase 1 — Núcleo

| | |
|---|---|
| Aplicación Electron | Ventana sin marco, controles propios, tema claro/oscuro, estado recordado |
| Editor CodeMirror 6 | Números de línea, plegado, resaltado Python, selección múltiple, buscar/reemplazar |
| Autocompletado | Palabras reservadas, funciones integradas con firma, plantillas, símbolos del documento, miembros tras `.`, módulos reales del intérprete |
| Atajos | `Ctrl+S`, `Ctrl+Z`, `Ctrl+Y`, `Ctrl+F`, `Ctrl+H`, `Ctrl+A`, `Ctrl+/`, `Tab`, `Shift+Tab`, `F11`, `Ctrl+Enter`, y más |
| Pestañas y proyectos | Varios archivos abiertos, explorador lateral, crear/renombrar/eliminar |
| Persistencia | Preferencias y sesión en `userData`, borradores en IndexedDB |

### Fase 2 — Python

| | |
|---|---|
| Python embebido | CPython 3.11.9 dentro de la app; el usuario no instala nada |
| Ejecución aislada | Proceso hijo separado, nunca dentro de Electron |
| Tiempo máximo | Configurable (5 s … sin límite); mata el árbol de procesos completo |
| Consola | stdout, stderr, colores ANSI, código de salida, duración, `input()` interactivo |
| Terminal | `python`, `pip`, `cd`… con el runtime interno **por delante en el PATH** |
| Gestor de librerías | Buscar, ver información, instalar, actualizar, desinstalar (estilo Arduino IDE) |
| Comprobación de sintaxis | El compilador real de CPython marca los errores en el editor y en «Problemas» |

### Fase 3 — Sistema académico y evaluación

| | |
|---|---|
| Persistencia local | **SQLite real** (`node:sqlite`, sin módulos nativos que compilar) en `<userData>/python-classroom.db` |
| Identidad | **Firebase Authentication** (correo y contraseña). El rol de profesor se autoriza en Firebase o lo asigna otro profesor: la aplicación nunca lo concede |
| Datos centrales | **Firebase Realtime Database** con reglas de seguridad que impiden que un estudiante se ponga nota o se ascienda |
| Temarios | Alta, edición, orden y temario sugerido de 17 temas |
| Ejercicios | Tipos (normal, cronometrado, de clase, reto, proyecto), dificultad, XP, nota máxima, tiempo, intentos, fechas, entrega tardía y criterios |
| Estados | `draft → published → active → closed → archived`; hasta publicar, nadie lo ve |
| Clases | Agrupan ejercicios y se abren y cierran; los ejercicios «solo en clase» dependen de ellas |
| Retos | Entidad propia con dificultad, XP, premio, requisitos y fechas |
| Sesión de trabajo | Cronómetro local, autoguardado cada 7 s en SQLite, registro de salidas de la ventana |
| Entregas | Un registro por intento; **nunca** se sobrescribe el código anterior |
| Revisión | Tres paneles: estudiante · código en CodeMirror de solo lectura · evaluación |
| Comentarios por línea | `error`, `warning`, `suggestion`, `positive`, `question`, marcados en el margen del código |
| Calificación | Nota, XP, comentario general, rúbrica que calcula la nota e **historial de cambios de nota** |
| Progreso | Completados, aprobados, promedio, XP por tema, tiempo dedicado; datos para los rankings |
| Sincronización | Cola en SQLite → Firebase. Nada local se borra hasta confirmar el envío |
| Sin conexión | Se sigue programando, ejecutando y entregando; la cola espera y se vacía sola al volver Internet |

#### Cómo fluyen los datos

```
editor  →  SQLite  →  cola de sincronización  →  Firebase
                ↑                                    │
                └──────────  arrastre  ←─────────────┘
```

El autoguardado **nunca** llega a Firebase. Solo suben los hechos importantes:
publicar, entregar, calificar, comentar, cambiar de estado.

#### Reparto de responsabilidades

- **XP y notas los escribe solo el profesor.** El estudiante ve «XP pendiente»
  hasta que le califican. Las reglas de la base lo imponen; el cliente no puede
  saltárselo.
- La retroalimentación, el historial y los eventos van anidados bajo la entrega
  o el estudiante, para que una sola regla decida quién puede leerlos.
- El profesor descarga como mucho las 400 entregas más recientes; el estudiante
  solo las suyas (consulta indexada por `studentId`).

#### Pasos que tienes que hacer tú en Firebase

No se pueden automatizar. Están detallados en
[`firebase/CONFIGURACION.md`](firebase/CONFIGURACION.md):

1. Activar **Authentication → Email/Password**.
2. Publicar **`firebase/database.rules.json`** en Realtime Database → Rules.

Hasta entonces la aplicación muestra una pantalla de diagnóstico explicando
exactamente qué falta.

#### Qué NO hace todavía

- Tienda de premios con monedas, niveles o avatares: fuera del alcance del pliego.
- Predicciones o recomendaciones automáticas sobre las estadísticas: fuera del alcance.
- Actualizaciones automáticas: la arquitectura está lista, la descarga automática no
  (ver «Actualizaciones» más abajo).
- El **primer** inicio de sesión en cada equipo necesita Internet: Firebase
  Authentication no puede verificar una contraseña sin conexión. Después la
  sesión queda guardada y todo funciona sin red.
- El control de salida de pestaña **deja constancia**, no impide nada. Es un
  mecanismo académico, no un sistema anti-trampas.

### Fase 4 — Gamificación

- **Insignias**: catálogo propio del profesor, con símbolo, color, XP extra y
  condición. Siete insignias sugeridas se cargan de una vez, igual que el temario.
- **Condiciones automáticas** evaluables sin conexión, con lo que ya hay en SQLite:
  primera entrega, N ejercicios completados, N notas perfectas, N retos, N entregas
  seguidas a tiempo, terminar en menos del X % del tiempo, N días con actividad y
  completar un tema entero.
- **Cuándo se conceden**: al calificar. La cadena es calificar → recalcular progreso
  → evaluar insignias → conceder las nuevas (SQLite + cola) → recalcular y publicar
  el ranking → señal `userSignals/<uid>/lastChange`. Nunca dos veces la misma:
  la clave primaria compuesta lo impide y además se comprueba antes de encolar.
- **Vitrina del estudiante**: las conseguidas en color, con fecha y motivo; las que
  faltan en gris, con la condición exacta que queda («Te faltan 3 ejercicios»).
- **Panel de premios del profesor** (pestaña *Premios* de la página de curso):
  crear, editar y desactivar insignias, cargar el catálogo sugerido, conceder a mano
  con motivo escrito, configurar premios de 1.º, 2.º y 3.º puesto —del ranking general
  o de un tema— y ver quién tiene cada insignia.
- **Rankings** (Ctrl+6): general, por tema y por grado. El estudiante ve siempre su
  posición aunque el profesor limite cuántos puestos se muestran, y sin conexión ve
  la última copia descargada con su fecha («Actualizado hace 2 horas»). No hay ninguna
  escucha permanente sobre `rankings/`: se lee al entrar y cuando cambia la señal.
- **Retos resolubles**: el reto con ejercicio asociado se abre con el mismo flujo de
  `exercise-session.js` que cualquier otro ejercicio; al calificarlo, si tiene premio
  configurado, se concede su insignia.

El XP extra de una insignia se muestra en la vitrina del estudiante, pero **no** se
suma al XP del ranking: la clasificación depende solo del trabajo calificado, para que
no se pueda subir de puesto con premios manuales.

Seguridad: las insignias siguen la regla de la nota. El cliente del estudiante
**calcula** lo que le corresponde, pero **nunca lo escribe**; la concesión la escribe
el profesor y las reglas rechazan cualquier escritura de un estudiante en `badges/`,
`userBadges/`, `rewards/` y `rankings/`.

### Fase 5 — Estadísticas, informes y formato .pclass

- **Página de Estadísticas** (Ctrl+7, solo profesor): promedio general, promedio por
  estudiante y por tema, ejercicios completados/pendientes/reprobados, tiempo medio,
  intentos medios, tasa de aprobación, destacados, estudiantes con dificultades, retos
  completados y XP repartido. Todo con consultas agregadas de SQLite; nada se recalcula
  en JavaScript sobre listas completas.
- **Detección automática de problemas**: un tema se marca cuando su promedio baja del
  60 % de la nota máxima, cuando reprueba más de un tercio de las entregas con nota o
  cuando hacen falta 2,5 intentos de media. El criterio es configurable **y se explica
  en la propia pantalla**, para que el profesor sepa por qué se le está avisando.
- **Cinco gráficas en SVG escrito a mano** (`src/js/charts.js`, sin ninguna librería):
  promedio por tema, evolución semanal, distribución de notas en cinco tramos, progreso
  por estudiante en barras horizontales y ejercicios completados por semana. Usan las
  variables CSS del tema, muestran el dato exacto al pasar el ratón y, cuando no hay
  datos suficientes, lo dicen en vez de dibujar una gráfica vacía.
- **Formato `.pclass`**: JSON propio para exportar una entrega, todas las entregas de un
  ejercicio o un ejercicio completo, e importar ejercicios de otro profesor. Se valida
  antes de importar y se explica exactamente qué falla. Un `.pclass` se puede abrir en
  **modo lectura** desde *Archivo → Abrir un .pclass…*.
- **Informes**: CSV de notas listo para una hoja de cálculo (con BOM, para que Excel
  respete los acentos), JSON con todo el curso e informe imprimible en HTML de un
  estudiante (notas, progreso, comentarios e insignias).
- **Importar datos**: la contraparte de «Exportar mis datos». Muestra qué va a entrar y
  cuántas filas chocan **antes** de tocar nada, pregunta si conservar o reemplazar, y
  guarda una copia de seguridad de la base antes de aplicar.

### Fase 6 — Empaquetado, instaladores y actualizaciones

- **El problema del runtime de solo lectura, resuelto**: si la carpeta de instalación
  no se puede escribir (el caso de `C:\Program Files`), en el primer arranque el runtime
  de Python se copia a `<userData>/python/runtime` y se usa esa copia. Se eligió copiar
  en lugar de `PIP_TARGET` + `PYTHONPATH` porque con `--target` **pip no sabe
  desinstalar**, y la aplicación tiene un gestor de librerías con botón de desinstalar:
  quedaría a medias. `electron/runtime.js` sigue siendo el único sitio que decide qué
  intérprete se usa.
- **Pantalla de primer arranque**: comprueba de verdad —una a una— aplicación, runtime,
  pip, entorno de Python, editor, paquetes educativos y configuración, y muestra el
  progreso de la copia. Se puede repetir desde *Archivo → Comprobar la instalación…*.
- **Copias de seguridad**: automática antes de cada migración de esquema y antes de
  importar datos, manual desde *Configuración → Copias y actualizaciones*, restauración
  con confirmación (y copia previa, para poder deshacer) y como máximo las cinco últimas.
- **Actualizaciones**: `electron/updates.js` consulta la última publicación de GitHub y
  avisa; **no descarga ni instala nada solo**. Lo que falta para que sean automáticas
  está escrito en la cabecera de ese archivo y resumido más abajo.
- **Instaladores**: NSIS para Windows (carpeta elegible, accesos directos, icono propio
  y desinstalador que **no** borra los datos del usuario), AppImage y `.deb` para Linux
  y `.dmg` para macOS. Del empaquetado se excluyen `python/cache`, `__pycache__`, los
  `.pyc` y `node_modules` (la interfaz usa los bundles ya generados en `src/js/vendor`).

### Pulido final (1.0.0)

Lo que cambió al cerrar la versión 1.0.0. Nada de esto añade dependencias nuevas: es
el mismo esquema local-first (SQLite manda en pantalla, Firebase reparte) afinado para
un curso real de hasta 60 estudiantes y un profesor.

#### Entregas de varios archivos, y ejecutarlas sin copiar nada

Un trabajo de clase no siempre cabe en un archivo. Si el ejercicio pide módulos
—`main.py` que importa `utilidades.py`, una carpeta con funciones, un `datos.py`—,
lo que se entrega es **la carpeta**, no «el código».

**El estudiante** tiene dos caminos, y los dos acaban igual:

1. **Desde el ejercicio.** Trabaja en la carpeta que le crea la aplicación y añade
   los archivos que necesite (o trae una carpeta suya con *Añadir carpeta*). Al
   entregar se envía la carpeta completa; la barra del ejercicio dice cuántos
   archivos van.
2. **Desde lo que ya estaba haciendo.** *Archivo → Entregar esta carpeta como
   ejercicio…* (Ctrl+E), o el botón **Entregar…** de cada proyecto en *Mis
   proyectos*. Elige a qué ejercicio va y cuál es el archivo por el que empieza su
   programa, y se envía tal cual está.

Lo que se recoge y lo que no: archivos de texto, hasta 200 KB cada uno, 60
archivos y 1,5 MB en total; nunca el enunciado, ni `__pycache__`, ni entornos
virtuales. Lo que queda fuera **se le dice, con su motivo**.

**El profesor** abre la entrega y ve **un archivo por pestaña**, con el principal
señalado y con el número de comentarios de cada uno —los comentarios por línea
quedan apuntados al archivo en el que se escriben, no sueltos—. Y **ejecuta la
entrega ahí mismo**, en una consola dentro de la propia pantalla de revisión:

- se escribe la entrega completa en una carpeta temporal y se ejecuta su archivo
  principal, así que **los `import` del estudiante funcionan** sin tocar nada;
- no hay que copiar el código a ningún sitio ni salir de la revisión, y los
  comentarios que estaba escribiendo siguen ahí;
- es una copia de usar y tirar: lo que se toque no afecta a la entrega.

Y si prefiere trastear, *Abrir en el editor* le deja esa misma copia abierta.

**El arreglo de fondo.** El Python embebido de Windows llega con un
`python311._pth` que fija la lista de rutas de importación entera, y con él
Python deja de hacer lo que hace siempre: añadir la carpeta del archivo que se
ejecuta. Con eso, **ningún** programa repartido en módulos funcionaba —ni el del
estudiante en su propio equipo—, y `PYTHONPATH` tampoco servía porque `._pth`
también lo ignora. Se restablece el comportamiento normal con un
`sitecustomize.py` dentro del runtime, que la aplicación escribe al arrancar si
no está (`electron/runtime.js`) y el instalador de Python deja puesto de entrada.

#### La cola de sincronización

`sync_queue` dejó de ser una lista de cambios para convertirse en una cola con reglas
(`electron/sqlite.js`, `src/js/sync.js`):

- **Identificador de operación** (`opId = entidad:id:operación`): guardar cinco veces el
  mismo tema deja **una** operación en la cola, con el último contenido. Es un índice
  único parcial (solo sobre lo que está pendiente), no un `UNIQUE` a secas: el historial
  de lo ya enviado puede repetir la misma operación sin chocar.
- **Prioridades**: entregas, notas y comentarios primero (1); progreso, insignias y
  perfiles después (5); registro de sesiones al final (9). Dentro de cada prioridad, lo
  más antiguo primero.
- **Dueño** (`ownerUid`): en el computador del colegio se turnan varias personas. Cada
  operación queda a nombre de quien la generó y una sesión **solo envía lo suyo** (el
  profesor puede enviar lo del curso, porque las reglas se lo permiten). Antes, la sesión
  de un estudiante intentaba subir lo que había dejado a medias el profesor, las reglas lo
  rechazaban —con razón— y ese cambio se quedaba sin subir.
- **Una operación rechazada no bloquea la cola**: si las reglas dicen no, se marca y se
  sigue con el resto. Solo un fallo de red corta la vuelta, porque ese sí es pasajero.
- **Todo en fila de una en una**: antes, si llegaba una subida mientras había una bajada
  en marcha, la subida se descartaba. Ahora espera su turno.
- **Ni la bajada pisa lo recién escrito**: si una entrega tiene un cambio propio esperando
  en la cola, lo que venga de fuera para esa entrega se ignora en esa pasada.

#### Tiempo real sin escuchar la base entera

Tres marcas de tiempo, no colecciones:

| Señal | Quién la escucha | Qué provoca |
| --- | --- | --- |
| `config/lastChange` | todos | el profesor publicó o cambió algo del curso |
| `userSignals/<uid>/lastChange` | cada estudiante, solo la suya | te calificaron o te concedieron una insignia |
| `submissionSignals/lastChange` | solo el profesor | alguien entregó |

Con 60 estudiantes son 60 oyentes sobre **valores de texto**. Al recibir una señal se baja
solo lo que corresponde, con 600 ms de espera para agrupar varias señales seguidas.

#### Tres estados de conexión, y ninguno más

🟢 **Conectado** · 🟡 **Sincronizando…** · 🔴 **Sin conexión**. La barra no dice nunca el
nombre de un servicio ni un código de error; al pasar el ratón explica qué significa
(«Tu trabajo se guarda en este equipo y se enviará solo cuando vuelva la conexión»).

**Recuperación automática**: la aplicación escucha la conexión real con la base de datos,
no solo lo que diga el sistema operativo —en el colegio pasa a menudo que el wifi sigue
«conectado» pero no llega nada—. En cuanto vuelve, sube lo que quedó esperando sin que
nadie pulse nada, y avisa una sola vez: «Todo actualizado».

#### Los cinco estados de una entrega

Con estos nombres exactos, iguales para el estudiante y para el profesor, cada uno con su
explicación en un ⓘ: **Pendiente de revisión**, **En revisión**, **Calificado**,
**Abandonado**, **Fuera de tiempo**. Donde no hay dato todavía se lee «Pendiente» o «Sin
información», nunca un hueco ni un `null`.

#### Un error de Python no cuesta nada

Equivocarse **no gasta intentos y no marca la entrega como abandonada** —está probado con
ejecuciones seguidas de código roto, también sin conexión—. Y el error se explica en
castellano (`src/js/py-errors.js`): tipo, línea, qué significa y qué mirar, más el
recordatorio de que corregirlo no cuesta ningún intento.

#### Fotos de perfil (Cloudinary, solo esto)

`electron/cloudinary.js` sube **únicamente fotos de perfil**, con un **preset sin firmar**:
la aplicación no lleva ninguna clave secreta dentro. Un programa de escritorio se puede
abrir y leer, y con el `api_secret` cualquiera podría borrar la cuenta entera de imágenes.

- La imagen se recorta a un cuadrado y se reduce a **256×256** en el propio equipo, en
  **WebP** (con JPEG de respaldo), por debajo de 90 KB, **antes** de salir.
- En la base de datos viaja **solo la dirección** (`photoURL`), nunca la imagen.
- Se pide ya recortada al tamaño en que se va a ver, y al doble para pantallas densas
  (`c_fill,g_face,w_,h_,f_auto,q_auto`). Cada subida tiene su propia dirección con
  versión, así que la caché del navegador la guarda sin quedarse con una foto vieja.
- Si no hay foto, o la imagen no carga, se ven las **iniciales**. Nunca un hueco roto, ni
  una dirección a la vista, ni `null`.

#### Rendimiento con un curso entero

Medido en la suite con 60 estudiantes y una entrega cada uno (grupo 36): bajada completa
**795 ms**, tablero del profesor **184 ms**, estadísticas **97 ms**, ranking de 62 en
**66 ms**, y la interfaz contestando en **27 ms** mientras todo eso pasa. La bandeja de
entregas se pinta **por tandas de 60** con un botón «Ver más»; el ranking y las
estadísticas se calculan en el proceso principal, con caché.

### Cursos — aislamiento por profesor, código de acceso y asignación

Antes de esto la aplicación era un único tenant: un equipo del colegio = una clase
entera, cualquier profesor veía y podía tocar a todos los estudiantes del colegio, y
un ejercicio publicado lo veía todo el mundo. Ahora cada profesor tiene sus propios
**cursos** (uno o varios), cada uno con su propio código de acceso, totalmente
aislado de los demás — y dentro de un curso se puede dirigir un ejercicio a
estudiantes concretos o a un grupo con nombre.

- **Un profesor, varios cursos**: «Mis cursos» (dentro de «Estudiantes y cuentas») deja
  crear cursos nuevos, cambiarles el nombre, regenerar su código de acceso, archivarlos
  y elegir cuál está activo ahora — se ve en la barra de estado. Las instalaciones que
  ya tenían datos de antes de que existieran los cursos se migran solas a un
  «Curso general», sin pasos manuales y sin perder nada; un profesor que entra por
  primera vez en un equipo limpio recibe el suyo en el momento.
- **Unirse con un código**: el alta de un estudiante pide el código de la clase de su
  profesor; si se equivoca, la cuenta se crea igual y puede reintentarlo. Un estudiante
  pertenece a un único curso.
- **Elegir el rol al registrarse**: el alta también deja elegir «quiero ser profesor», pero
  eso no concede el rol por sí solo — ver «[Quién es profesor: la barrera de
  seguridad](#quién-es-profesor-la-barrera-de-seguridad)» para el bootstrap del primero y
  la solicitud pendiente de los siguientes.
- **Aislamiento total, hasta en Firebase**: lo académico de un curso (ejercicios,
  clases, retos, entregas, comentarios, calificaciones, progreso, insignias concedidas,
  ranking) vive anidado bajo `courses/<id>/…` — el curso lo decide la **ruta**, no una
  condición que se pueda olvidar. Un profesor ya no puede leer `users/` de nadie: ve a
  sus estudiantes por una copia de su perfil (`roster`) que cada quien escribe de sí
  mismo al sincronizar. Sigue siendo global solo lo que de verdad es compartido por
  todo el colegio: el temario, y el catálogo de insignias y premios (quién ganó cada
  una sí es del curso).
- **Asignación individual y por grupo**: dentro de un curso, el profesor arma grupos
  con nombre («Equipo A», «Refuerzo») en la sección «Grupos». En el editor de un
  ejercicio, «¿Para quién es?» deja elegir entre todo el curso (lo de siempre, sin
  destinatarios no cambia nada) o estudiantes y grupos concretos; quien no aparezca ni
  directo ni por su grupo lo ve como si no existiera, con el mismo mecanismo que ya
  ocultaba un ejercicio fuera de horario de clase. Borrar un grupo no borra a nadie del
  curso, solo deja de dirigirles lo que tenía asignado.

Riesgos aceptados a propósito, documentados y no ocultos: el código de acceso no es un
secreto criptográfico fuerte (mismo modelo de confianza que Google Classroom) — si
alguien lo adivinara se cuela como estudiante, y el profesor lo ve en su lista y lo da
de baja con un clic; una instalación que ya tenía más de un profesor sin ningún
aislamiento migra a todos juntos al mismo «Curso general» (los demás profesores entran
como co-profesores), porque no hay forma de reconstruir «quién era de quién». Repartirlos
después ya no depende de tocar Firebase a mano: en «Estudiantes y cuentas», cada fila de
estudiante tiene un botón «Mover a otro curso» que lo pasa, uno por uno, a otro curso
propio del mismo profesor (`courses.moveStudent`); y desde su propio menú de cuenta,
cualquier profesor tiene «Ser coprofesor de otro curso», que se une con el mismo código
que usan los estudiantes (`courses.joinCoTeacher`). Un
coprofesor ve el curso entero -estudiantes, ejercicios, entregas- pero **no puede crear
ni calificar todavía**: la interfaz no se lo impide de por sí en el equipo local, pero
las reglas de Firebase solo dejan escribir `exercises/`, `classes/`, `challenges/` y
calificar al dueño (`teacherId`), así que lo que intente crear un coprofesor se queda sin
sincronizar -limitación conocida, pendiente de una UI de coenseñanza que reparta también
ese permiso-. El dueño puede quitar a un coprofesor cuando quiera (`courses.removeCoTeacher`).
Un curso ya archivado y sin ninguna entrega se puede borrar de verdad
(`courses.remove`); uno con entregas, o uno sin archivar antes, se rechaza con su motivo.
La limpieza de los nodos planos que quedan huérfanos en Firebase tras la migración
(`exercises/`, `submissions/`, … en la raíz, ya sin usar desde que todo vive bajo
`courses/<id>/…`) sigue siendo manual y opcional -se borran a mano desde la consola de
Firebase, si se quiere liberar ese espacio-: no hay ninguna herramienta en la aplicación
que lo haga por ti todavía.

### Verificación

`npm run test:e2e` ejecuta **259 pruebas** sobre la aplicación real, conduciendo la
interfaz de verdad: escribe en CodeMirror, ejecuta Python, usa pip y la terminal,
recorre el circuito completo hasta Firebase (sustituido por un doble en memoria), intenta
saltarse la barrera de seguridad del rol, comprueba el aislamiento entre cursos y cambia
el tamaño de la ventana para comprobar el diseño adaptable.

En la última ejecución completa pasaron **241 de 241**.

Para iterar sobre un grupo concreto sin esperar a toda la suite:

```bash
PC_E2E_ONLY=responsive npm run test:e2e
```

Acepta `fase3`, `fase4`, `fase5`, `fase6`, `v1`, `offline`, `multiarchivo`, `cursos`,
`seguridad` y `responsive`, separados por comas. El arranque y el acceso se ejecutan
siempre, porque sin sesión no hay nada que probar. Todos los grupos menos `responsive`
trabajan sobre lo que crea la fase 3 (temario, ejercicio y estudiante), así que hay
que pedirlos junto a ella:
`PC_E2E_ONLY=fase3,fase5`. Si te olvidas, la suite te lo avisa.

**Fases 1 y 2** — arranque y layout, resaltado, autocompletado (variables del alumno,
métodos por tipo inferido y símbolos reales de módulos), deshacer/rehacer, comentar,
buscar, ejecución con salida y errores, UTF-8, `input()` interactivo, corte por tiempo
máximo, botón Detener, comprobación de sintaxis, terminal (comandos con comillas, REPL,
`pip`, `cd`), gestor de librerías (instalar, importar y desinstalar un paquete real),
proyectos, guardado en disco, pestañas independientes, temas, zoom y preferencias.

**Fase 3** — el flujo completo del pliego, de punta a punta:

1. La aplicación arranca en el acceso; el profesor, autorizado antes en
   `roles/<uid>`, entra con su cuenta y el rol se comprueba contra Firebase.
2. Temario sugerido, ejercicio con criterios, rechazo de configuraciones incoherentes,
   borrador invisible para el estudiante, publicación, clase y reto.
3. Un estudiante se registra, recibe el ejercicio, lo abre (se crea su carpeta),
   ve el cronómetro descontar, **ejecuta Python de verdad**, autoguarda en SQLite y entrega.
4. La entrega llega a la base remota con el código; la cola queda vacía.
5. El profesor revisa en tres paneles, comenta tres líneas de distintos tipos
   (que se marcan en el margen del código), califica y cambia la nota → queda historial.
6. El estudiante recibe nota, XP y comentarios; su progreso y su tablero se actualizan.
7. Segundo intento: el primero conserva su código y su nota.
8. **Sin conexión**: la entrega se guarda y espera en la cola; al volver, se vacía sola.
9. **Permisos**: un estudiante no puede crear ejercicios, ni listar cuentas, ni
   escribirse una nota, ni ascenderse a profesor.
10. Se comprueba en disco que la base local es un archivo SQLite real.

**Fase 4** — el profesor carga el catálogo de insignias (y cargarlo dos veces no
duplica nada), crea una insignia manual, el sistema rechaza una condición inventada,
se publican catálogo y premios; un estudiante entrega, al calificar recibe
automáticamente sus insignias, **recalificar no las concede dos veces**, su vitrina las
muestra con fecha y motivo y dice qué le falta para las bloqueadas; un estudiante **no**
puede escribir en `userBadges/`, `badges/`, `rewards/` ni `rankings/`; el ranking sale
ordenado por XP y se publica; el profesor limita los puestos y el estudiante sigue viendo
su posición aparte; sin conexión se muestra el ranking descargado con su fecha; un reto
con ejercicio asociado se resuelve con el flujo normal y al calificarlo se concede el
premio configurado.

**Fase 5** — un tema con notas bajas dispara el aviso y el criterio se puede cambiar y
se aplica; las cifras de la página cuadran con las entregas reales (calificadas,
promedio, XP y número de estudiantes); cada gráfica se dibuja con el número exacto de
elementos —o dice que no hay datos—; exportar e importar un ejercicio `.pclass` lo deja
idéntico y avisa antes de sobrescribir; un `.pclass` roto, incompleto o de otro formato
se rechaza con su motivo; el CSV tiene una fila por entrega calificada; el JSON del curso
trae todos los bloques; el informe de un estudiante se genera con sus cuatro secciones;
importar una copia enseña qué entra y conserva lo propio si así se elige.

**Fase 6** — detección de si la carpeta de instalación se puede escribir; **la copia del
runtime a la carpeta del usuario se ejercita de verdad** (2878 archivos copiados, pip y
el intérprete siguen funcionando desde la copia); la pantalla de preparación comprueba
sus siete piezas; se mide el arranque en frío; copia manual de la base, poda a las cinco
últimas, restauración con copia previa y rechazo de rutas que no son copias; la
comprobación de actualizaciones responde sin romper nada y su configuración persiste; y
el empaquetado excluye `python/cache`, `__pycache__` y `node_modules`, con icono propio y
un desinstalador que no borra los datos.

**Cursos** — la migración silenciosa crea «Curso general» con el profesor más antiguo
de dueño, matricula a todo el mundo y no deja ninguna fila sin curso asignado; un
profesor crea un segundo curso con su propio código, lo usa, lo renombra, le cambia el
código y lo archiva/reactiva sin perder nada; un estudiante no puede crear, renombrar ni
activar cursos ajenos; un estudiante nuevo se une escribiendo el código en el alta, un
código equivocado no bloquea la cuenta (se reintenta), ya con curso no puede unirse a
otro, y un curso archivado no admite estudiantes nuevos. **Aislamiento entre profesores**:
con un segundo profesor y su propio curso, el primero no ve su curso entre los suyos, no
puede leer NADA de él directamente en Firebase (ni el curso, ni ejercicios, ni roster, ni
miembros, ni entregas, ni rankings), no puede escribir nada tampoco, y el panel de
estadísticas de un estudiante ajeno se rechaza aunque se sepa su identificador. **Grupos y
asignación**: un grupo con nombre se crea con los estudiantes que se le pongan; un
ejercicio asignado a un grupo solo lo ve quien está en él; asignarlo directo a un
estudiante funciona igual; quitar los destinatarios lo devuelve a todo el curso; borrar
un grupo no borra a nadie del curso.

**Seguridad del rol** (10 pruebas) — que pedir `remoteRole: 'teacher'` desde la interfaz
no sirve de nada; que un estudiante no puede usar ningún canal de profesor (seis
comprobados); que no se puede suplantar el uid de otra persona; que una sesión sin token
se rechaza; que **borrar la base local no convierte al estudiante en profesor** y que el
profesor autorizado sí recupera su rol; y el comportamiento sin conexión en los tres
casos (estudiante, profesor ya verificado y profesor sin nada verificado en ese equipo).

**Diseño adaptable** (10 pruebas) — cambiando el tamaño real de la ventana: barra de
actividad a la izquierda en escritorio y abajo en teléfono, revisión a una columna en
tableta, ninguna de las siete páginas se sale a lo ancho ni a 390 px ni a 360 px, la tabla
del curso se desplaza dentro de su caja, los diálogos ocupan el ancho completo, los campos
miden 15 px y ningún botón baja de 34 px. Además deja capturas en la carpeta temporal para
revisarlas a ojo.

#### Estado de la verificación

**259 pruebas, 0 fallos**, con el modelo de acceso estricto que hay ahora: la aplicación
**no concede el rol de profesor sin más** -salvo la única excepción, deliberada y de un
solo uso, del primer profesor de una instalación vacía (bootstrap)- y arranca siempre en
la pantalla de acceso. El rol se autoriza en `roles/<uid>` desde Firebase, lo asigna otro
profesor, o lo aprueba el dueño de un curso a partir de una solicitud.

El arranque de la suite hace lo que haría una persona con acceso a la consola de Firebase:
crea la cuenta del profesor en Authentication y siembra `roles/<uid> = teacher` en el
doble; después entra por el formulario de acceso normal. Y comprueba además lo que el
nuevo modelo promete: que la pantalla de setup **no ofrece ningún campo para crear
cuentas**, y — con una instalación todavía vacía, antes de sembrar nada — que elegir
«profesor» en el alta autoriza de una sola vez al primer profesor (bootstrap) pero deja a
cualquier «profesor» posterior de estudiante con una solicitud pendiente, visible y
resoluble solo por el dueño del curso al que apuntó su código (grupo «Elegir rol al
registrarse», repartido entre `scripts/e2e.js` y el grupo 48 de `scripts/e2e-cursos.js`).

#### Lista de comprobación antes de instalar en el colegio

Lo que la suite **no puede** comprobar sola, porque necesita tu Firebase, tu cuenta de
imágenes, dos computadores de verdad o un equipo limpio. Se hace una vez por versión.

| # | Comprobación | Cómo se ve que está bien |
| --- | --- | --- |
| 1 | Publicar `firebase/database.rules.json` en el proyecto real | La consola de Firebase acepta las reglas sin avisos |
| 2 | Entrar con una cuenta de **estudiante** real | Ve sus ejercicios, entrega, y **no** ve la lista de cuentas ni las notas de otros |
| 3 | Intentar escribir una nota desde la sesión de un estudiante (consola del navegador) | Firebase lo rechaza; la aplicación lo cuenta como «se quedó atrás», no se cuelga |
| 4 | Un profesor autoriza a otro (`roles/<uid>`) | El segundo profesor entra y ve el curso completo |
| 5 | Crear el preset **sin firmar** en la cuenta de imágenes y subir una foto real | La foto se ve en el ranking y en la vitrina; en la base de datos solo hay la dirección |
| 6 | Dos computadores a la vez: el profesor publica un ejercicio | Aparece en el del estudiante **sin recargar**, en menos de 5 segundos |
| 7 | Dos computadores a la vez: el estudiante entrega | Aparece en la bandeja del profesor sin recargar |
| 8 | Dos computadores a la vez: el profesor califica | El estudiante recibe el aviso «Nueva calificación» |
| 9 | Cortar el wifi durante una clase, trabajar 10 minutos y volver a conectar | 🔴 → se sigue trabajando → 🟡 → 🟢 «Todo actualizado», sin perder nada |
| 10 | Un curso entero (30–60 estudiantes) entregando el mismo día | La bandeja se abre en menos de 2 segundos y se ve por tandas |
| 11 | Instalar el `.exe` en un equipo limpio, sin Python | Primer arranque: copia el runtime, ejecuta `print("hola")` |
| 12 | Instalar **encima** una versión anterior | Ejercicios, entregas y notas siguen ahí (los datos viven en `userData`) |
| 13 | Desinstalar | Se quita el programa y **no** se borran los datos del usuario |
| 14 | Restaurar una copia de seguridad | Vuelve el estado guardado, con copia previa por si acaso |
| 15 | Abrir la aplicación en una ventana pequeña (tableta y teléfono) | Nada se sale de la pantalla; los controles siguen alcanzables |

Y lo que se comprueba solo, con `npm run test:e2e`, cada vez que se toca algo:
`PC_E2E_ONLY=fase3,v1` (tiempo real, cola, fotos, lenguaje, 60 estudiantes),
`PC_E2E_ONLY=fase3,offline` (sin conexión y red lenta),
`PC_E2E_ONLY=fase3,multiarchivo` (entregas con módulos y ejecución en la revisión),
`PC_E2E_ONLY=fase3,seguridad` (la barrera del rol) y
`PC_E2E_ONLY=responsive` (tableta y teléfono).

#### Cómo se prueba sin tocar tu Firebase

Las pruebas sustituyen el SDK por un **doble en memoria**
(`src/js/test/fake-firebase.js`) que aplica una versión reducida de las mismas
reglas de seguridad. Así se ejercita todo el circuito —registro, roles, cola,
subida, bajada y permisos— sin escribir nada en el proyecto del colegio.

Eso sí: **el doble no sustituye a probar las reglas reales**. Cuando publiques
`firebase/database.rules.json`, haz una prueba con una cuenta de estudiante real.

---

## Instalación para desarrollo

```bash
npm install          # dependencias + bundle de CodeMirror
npm run setup:python # descarga y prepara el Python embebido (~12 MB, una sola vez)
npm start
```

Comprobar que todo está bien:

```bash
npm run doctor
```

Pruebas funcionales completas (conducen la interfaz real: escriben en el editor,
ejecutan Python, usan la terminal y pip):

```bash
npm run test:e2e
```

Opciones útiles:

```bash
npm run setup:python -- --full     # añade numpy, pandas y matplotlib
npm run setup:python -- --force    # reinstala el runtime desde cero
npm run watch:vendor               # recompila CodeMirror al vuelo
npm run dev                        # arranca con logs del renderer en la consola
```

---

## Estructura

```
python-classroom/
├── electron/            proceso principal
│   ├── main.js          ventana, menú, ciclo de vida
│   ├── preload.js       puente seguro (contextBridge)
│   ├── runtime.js       resolución del intérprete de Python
│   ├── store.js         preferencias y sesión (por usuario)
│   ├── sqlite.js        base de datos local (node:sqlite) + cola de sync
│   ├── firebase-config.js  configuración del proyecto de Firebase
│   ├── catalog.js       catálogo educativo de librerías
│   ├── repos/
│   │   ├── users.js     espejo local de perfiles y roles
│   │   ├── courses.js   cursos: alta, código de acceso, curso activo, migración
│   │   ├── groups.js    grupos con nombre y a quién va dirigido un ejercicio
│   │   ├── academic.js  temarios, ejercicios, clases y retos
│   │   ├── work.js      entregas, feedback, notas, eventos y progreso
│   │   ├── gamification.js  insignias, premios, rankings
│   │   └── stats.js     estadísticas del curso e informe por estudiante
│   └── ipc/
│       ├── files.js     sistema de archivos (con lista de rutas permitidas)
│       ├── python.js    ejecución, timeout, stdin, comprobación de sintaxis
│       ├── terminal.js  terminal integrada
│       ├── packages.js  pip + PyPI
│       ├── data.js      única puerta a los datos, con control de rol
│       ├── exchange.js  informes, CSV/JSON, formato .pclass, copias de seguridad
│       └── system.js    preferencias, ventana, instalación del runtime
│
├── src/                 interfaz (HTML + CSS + JS nativo, sin frameworks)
│   ├── index.html
│   ├── css/             reset · variables · app · components · editor · dashboard
│   └── js/
│       ├── app.js       cableado y atajos globales
│       ├── editor.js    CodeMirror 6
│       ├── completions.js  autocompletado de Python
│       ├── documents.js pestañas y guardado
│       ├── explorer.js  árbol de archivos
│       ├── console.js   consola de ejecución
│       ├── terminal.js  terminal
│       ├── packages.js  gestor de librerías
│       ├── settings.js  configuración
│       ├── runtime-panel.js
│       ├── firebase.js  cliente de Auth + Realtime Database
│       ├── sync.js      cola de sincronización y arrastre
│       ├── auth.js      acceso, registro y perfil
│       ├── router.js    IDE ⇄ páginas a pantalla completa
│       ├── dashboard.js tableros de estudiante y profesor
│       ├── exercises.js temario, ejercicios, clases y retos
│       ├── exercise-session.js  cronómetro, autoguardado y entrega
│       ├── review.js    bandeja y pantalla de revisión del profesor
│       ├── projects.js  carpetas de trabajo del usuario
│       ├── tutorial.js  tutorial interactivo
│       └── test/fake-firebase.js  doble en memoria (solo pruebas)
│       ├── stream.js    render de salida con ANSI
│       ├── storage.js   IndexedDB
│       ├── theme.js     temas y resaltado
│       └── vendor/cm6.js  (generado por esbuild)
│
├── firebase/
│   ├── database.rules.json  reglas de seguridad (hay que publicarlas)
│   └── CONFIGURACION.md     pasos en Firebase Console
│
├── python/
│   ├── runtime/         intérprete embebido (generado)
│   └── tools/pcheck.py  comprobador de sintaxis
│
└── scripts/
    ├── build-vendor.js  empaqueta CodeMirror
    ├── setup-python.js  prepara el runtime
    ├── doctor.js        diagnóstico
    ├── e2e.js           pruebas de las fases 1 y 2
    ├── e2e-fase3.js     pruebas de la fase 3
    ├── e2e-fase4.js     pruebas de la fase 4 (insignias, premios, ranking)
    ├── e2e-fase5.js     pruebas de la fase 5 (estadísticas, informes, .pclass)
    ├── e2e-fase6.js     pruebas de la fase 6 (runtime, copias, actualizaciones)
    ├── e2e-v1.js        pruebas de la 1.0.0 (tiempo real, cola, 60 estudiantes…)
    ├── e2e-offline.js   pruebas de trabajar sin conexión y con red lenta
    ├── e2e-multiarchivo.js  pruebas de entregas de varios archivos
    ├── e2e-cursos.js    pruebas de cursos, aislamiento entre profesores y grupos
    ├── e2e-seguridad.js pruebas de la barrera del rol
    ├── e2e-responsive.js pruebas del diseño adaptable
    ├── make-icon.js     dibuja los iconos por código (png, ico y los del móvil)
    ├── serve-mobile.js  servidor estático para probar la app móvil
    └── run-e2e.js       lanza las pruebas con un perfil temporal
```

### Dónde viven los datos

Todo fuera de la carpeta de instalación, para que actualizar la app nunca borre nada:

```
<userData>/
├── python-classroom.db   SQLite: usuarios, cursos, grupos, temario, ejercicios,
│                         clases, retos, entregas, feedback, notas, eventos,
│                         progreso, insignias, premios y la cola de sync
├── backups/              las cinco últimas copias de la base de datos
├── python/runtime/       copia escribible del runtime (si hace falta)
├── firebase.json         (opcional) configuración propia de Firebase
└── usuarios/<uid>/
    ├── settings.json     preferencias de esa persona
    ├── session.json      carpeta y pestañas abiertas
    └── proyectos/        sus proyectos y ejercicios
```

Las contraseñas **no se guardan en ningún sitio de la aplicación**: las gestiona
Firebase Authentication.

---

## Decisiones de diseño

- **Sin frameworks**: HTML, CSS y JavaScript nativo. Solo CodeMirror se empaqueta con esbuild.
- **Sin backend propio**: no hay servidor que mantener. SQLite manda en pantalla y
  Firebase (Authentication + Realtime Database) reparte entre equipos. Cloudinary
  aparece solo para las fotos de perfil, y con un preset sin firmar.
- **Seguridad**: `contextIsolation` activo, `nodeIntegration` desactivado, CSP estricta,
  y las operaciones de archivo se limitan a las carpetas que el usuario abre.
- **Los datos del usuario viven fuera de la instalación** (`userData`), para que una
  actualización nunca borre el trabajo de los estudiantes.
- **Terminal sin PTY nativo**: se evita compilar módulos nativos (`node-pty`), lo que
  mantiene el instalador pequeño y la compilación sin dependencias de Visual Studio.
  A cambio, no hay redibujado de aplicaciones de pantalla completa tipo `vim`.

## Quién es profesor: la barrera de seguridad

### El agujero que había

El rol se decidía **en el cliente**: la interfaz leía `roles/<uid>` en Firebase y le
pasaba el resultado al proceso principal, que se lo creía. Con eso, dos caminos:

1. Abrir las herramientas de desarrollo y llamar a mano
   `window.pc.session.set({ uid, email, remoteRole: 'teacher' })`: profesor en ese
   equipo, con calificaciones, XP, insignias y la lista completa de cuentas.
2. **Borrar la base de datos local** para que el equipo «empezara de cero»: sin nadie
   registrado, la primera cuenta que entraba se quedaba con el rol que pidiera.

Los datos del servidor nunca estuvieron expuestos —las Security Rules los protegen—,
pero en ese equipo el estudiante veía y hacía cosas de profesor, y eso ya es un problema.

### Cómo está resuelto ahora

**El rol lo decide el proceso principal, no la interfaz** (`electron/role-verify.js`):

1. `accounts:lookup` de la API REST de Firebase con el **ID token** de la sesión:
   confirma que el token es válido, que no ha caducado, que es de este proyecto y **de
   quién es**. El uid y el correo salen del token, no de lo que diga la interfaz.
2. `GET roles/<uid>.json?auth=<idToken>` en la Realtime Database: el rol, leído de la
   fuente de verdad con los permisos de ese mismo usuario.

Consecuencias, todas comprobadas con pruebas:

- Pedir `remoteRole: 'teacher'` desde la interfaz **no hace nada**: el campo ya no existe
  en el canal, y aunque se envíe se ignora.
- **No se puede suplantar a nadie**: si el token es de un estudiante y se pide entrar con
  el uid del profesor, la sesión queda como la del estudiante.
- Una sesión **sin token se rechaza**.
- **Borrar la base local ya no da nada**: el rol de profesor solo se conserva si ese
  equipo lo verificó antes (`users.roleVerifiedAt`); si no hay nada verificado, se entra
  como estudiante hasta que se pueda comprobar.
- **Sin conexión** se conserva el rol ya verificado en ese equipo y se avisa de que la
  comprobación quedó pendiente; lo que no se hace es conceder un rol nuevo que nadie
  puede demostrar.
- La aplicación **no tiene ningún camino** que escriba `roles/<uid> = teacher`. Eso lo
  autoriza una persona en la consola de Firebase.
- **Empaquetada**: las herramientas de desarrollo están desactivadas, `window.__pc` no
  existe y el canal de pruebas (`test:seedIdentity`) no se registra, aunque se lance con
  `--dev` o con `PC_E2E`.

Lo que sigue siendo cierto y conviene saber: el **primer** inicio de sesión de un profesor
en un equipo nuevo **necesita Internet**. Sin red no hay forma honesta de demostrar un rol.

### Cómo se autoriza un profesor

La aplicación arranca **siempre** en la pantalla de acceso: no hay pantalla de
configuración inicial ni «proyecto pendiente de autorización». El alta sí deja elegir
entre «Quiero ser estudiante» y «Quiero ser profesor», pero elegir «profesor» **nunca
concede el rol por sí solo** — solo decide cuál de estos tres caminos sigue
`establecerSesion()` (`src/js/auth.js`):

1. **Bootstrap del primer profesor.** Una instalación de Firebase completamente nueva (sin
   ningún profesor todavía) tiene un nodo `config/bootstrap` sin reclamar. La primera
   persona que elige «profesor» lo reclama con una escritura que las reglas solo aceptan
   **una vez** (`!data.exists()`) y queda como profesor de una, con su propio «Curso
   general». Nadie más, nunca, vuelve a poder reclamarlo: ni siquiera si esa cuenta se
   borra.
2. **Solicitud pendiente.** Cualquier «profesor» después del primero necesita el código de
   acceso de un curso ya existente (el mismo que usa un estudiante para unirse). La cuenta
   queda como **estudiante**, con una solicitud escrita directamente en el roster de ese
   curso (`courses/<id>/roster/<uid>`, con `teacherRequestedAt`/`teacherRequestedCourseId`
   — es una escritura directa y no la cola normal, porque quien pide el rol todavía no es
   miembro de ningún curso). Solo el **dueño** de ese curso la ve, en *Estudiantes y
   cuentas → Solicitudes para ser profesor*, y decide con un botón: **Aprobar** lo deja
   como coprofesor de su curso (mismo modelo de coenseñanza de la sección anterior, ver
   `courses:aprobarSolicitudDeProfesor`); **Rechazar** solo borra la marca pendiente.
3. **Sin bootstrap y sin código.** La cuenta queda de estudiante, sin ninguna solicitud
   registrada — se avisa con un mensaje, no es un error.

Sigue existiendo una tercera vía, la de siempre, para promover a alguien sin pasar por
ninguna solicitud: **en la consola de Firebase** (`Realtime Database → roles → <UID> →
"teacher"`) o **desde otro profesor**, en *Estudiantes y cuentas*, con el botón de cambiar
rol.

Las reglas de `roles/<uid>` permiten exactamente tres cosas: que una cuenta nueva se ponga
`student` a sí misma una vez; que se ponga `teacher` a sí misma una vez, solo si ganó el
bootstrap (`config/bootstrap` == su propio uid); y que un profesor ya existente escriba
cualquier rol (necesario para que la aprobación de una solicitud llegue también a
Firebase). Nada más.

## Diseño adaptable (tableta y teléfono)

`src/css/responsive.css` adapta toda la interfaz a pantallas pequeñas y a pantallas sin
ratón. Solo contiene reglas dentro de `@media`, así que en un monitor no cambia nada.

- **≤ 1024 px (tableta)**: menos aire, rejillas más estrechas y la revisión de una entrega
  pasa de tres columnas a una.
- **≤ 760 px (teléfono)**: la barra de actividad se va **abajo**, como en una app de móvil;
  las páginas quedan a una columna; las tablas se desplazan dentro de su caja y no rompen
  la página; los diálogos se convierten en hojas inferiores a ancho completo; los campos
  usan 15 px para que Safari no haga zoom al enfocarlos; barra lateral oculta y panel más
  bajo en el editor.
- **≤ 420 px**: se recorta lo accesorio (los indicadores quedan en dos columnas, la
  condición de una insignia se ve al pulsarla).
- **Sin ratón** (`hover: none`): los botones de fila se ven siempre, sin depender de pasar
  por encima, y se quitan los efectos de hover.
- **iPhone**: `viewport-fit=cover` y `env(safe-area-inset-*)` en la barra inferior, la de
  estado y los laterales, para el notch y la barra de gestos.

Verificado cambiando el tamaño real de la ventana en las pruebas (1280×800, 820×1100,
390×844 y 360×640): la barra baja, ninguna página se sale a lo ancho en ninguna de las
siete pantallas, la tabla del curso se desplaza sola, el diálogo ocupa el ancho completo
y ningún botón baja de 34 px de alto.

## App móvil (`mobile/`)

Ya existe y funciona: una **PWA** —aplicación web instalable— pensada para el
estudiante, en la misma carpeta del proyecto.

```bash
npm run movil     # http://localhost:5173/mobile/
```

Desde el teléfono, en la misma wifi, con la IP que imprime el comando. Para
*instalarla* en la pantalla de inicio hace falta `https` o `localhost`: por IP
carga, pero el navegador no ofrece instalarla.

### Qué es y qué no

- **Misma base de datos y mismas reglas**: escribe en los mismos nodos que la
  aplicación de escritorio, así que una entrega hecha desde el móvil aparece en la
  bandeja del profesor como cualquier otra.
- **Sin SQLite**: aquí la fuente de verdad es Firebase. Lo que se guarda en el
  teléfono (`localStorage`) es una copia para poder mirar sin conexión, y cuando
  se muestra esa copia **la pantalla lo dice**, con su antigüedad.
- **Python de verdad, dentro del navegador**: [Pyodide](https://pyodide.org)
  (CPython compilado a WebAssembly). Medido en este equipo: **3,3 s la primera
  vez** (descarga ~10 MB, luego queda en caché) y **4–30 ms** por ejecución.
- **Editor con colores**: el mismo CodeMirror 6 que el escritorio, con
  configuración de móvil y un `<textarea>` de respaldo si no cargara.
- **Alcance**: la parte del estudiante — ejercicios, retos, resolver, ejecutar,
  entregar, mis entregas con nota y comentarios por línea, ranking e insignias.
  Un profesor puede entrar y mirar, y la propia pantalla le dice que calificar,
  crear ejercicios y conceder insignias se hacen en el escritorio.
- **Lo que NO tiene** (y no puede tener en un navegador): `pip install`, terminal,
  archivos del sistema y el control de abandono de la sesión de examen.

### Cómo está hecho

```
mobile/
├── index.html              caparazón: acceso, cabecera, pestañas
├── manifest.webmanifest    instalable en la pantalla de inicio
├── sw.js                   guarda la app para abrir sin conexión
├── css/mobile.css          lo propio del móvil (reusa el CSS del escritorio)
└── js/
    ├── app.js              arranque, sesión y navegación
    ├── acceso.js           entrar, alta de ESTUDIANTE y recuperar contraseña
    ├── pantallas.js        ejercicios, resolver, entregas, ranking, insignias, yo
    ├── data.js             Realtime Database + copia local honesta
    ├── editor.js           CodeMirror 6 para pantalla táctil
    └── python.js           Pyodide: ejecutar y comprobar sintaxis
```

Aquí tampoco hay forma de crear un profesor: el alta escribe `roles/<uid> =
student` y las reglas no admiten otra cosa desde un cliente.

### Para publicarla de verdad

1. Servir `mobile/` (y `src/css`, `src/js`) por **https** en cualquier hosting
   estático — Firebase Hosting es el camino corto, ya que el proyecto existe.
2. Añadir los dominios a *Authentication → Settings → Authorized domains*.
3. Y si se quiere en la App Store o Play, envolverla con Capacitor: el código no
   cambia, cambia el empaquetado y la firma.

### Y para llevarla a Android o iPhone de verdad

Conviene decirlo claro: **esto no la convierte en una app de móvil**. Python Classroom es
Electron con CPython embebido, y eso no se instala en un iPhone. Con el diseño adaptable la
interfaz ya es usable con el dedo y en pantalla pequeña —que es el requisito previo—, pero
un puerto real necesita decidir antes qué pasa con la ejecución de Python:

- **Camino web (el más corto)**: servir `src/` como aplicación web y sustituir el proceso
  local de Python por un servicio que ejecute el código. Hay que reemplazar todo lo que
  hoy pasa por `window.pc` (SQLite, archivos, terminal, pip) y decidir el aislamiento del
  código de los estudiantes; sin eso, ejecutar Python de terceros en un servidor es un
  riesgo, no una funcionalidad.
- **Camino app nativa** (Capacitor o similar): misma interfaz empaquetada, con Python
  sobre WebAssembly (Pyodide) para lo básico. Sin pip real ni terminal, y el paquete crece
  bastante.

Ninguno de los dos es un cambio de CSS: son otra fase de proyecto. Lo que está hecho y
probado es la parte adaptable de la interfaz.

## Empaquetado, actualizaciones y copias

### El runtime de Python y `pip`

Instalada en `C:\Program Files`, la carpeta de la aplicación es de solo lectura
para el estudiante: `pip install` fallaría sin permisos de administrador. La
aplicación lo resuelve **copiando el runtime a `<userData>/python/runtime` en el
primer arranque** y usando esa copia (`electron/runtime.js` es el único sitio que
decide qué intérprete se usa).

Por qué copiar y no `PIP_TARGET` + `PYTHONPATH`: con `--target`, pip instala pero
**no sabe desinstalar**, y el gestor de librerías tiene botón de desinstalar. La
copia cuesta unos cientos de MB una sola vez, con pantalla de progreso, y a cambio
pip funciona entero y cada usuario del equipo tiene su propio entorno —lo que hace
falta en un computador compartido del colegio. Si la carpeta de instalación sí se
puede escribir (modo desarrollo, o instalación por usuario), no se copia nada.

### Actualizaciones

Hoy: *Configuración → Copias y actualizaciones → Comprobar*. La aplicación consulta
la última publicación del repositorio de GitHub configurado, compara la versión y,
si hay una nueva, ofrece abrir la página de descarga. **No descarga ni instala nada
por su cuenta.**

Para que sean automáticas faltan exactamente cuatro cosas (están también en la
cabecera de `electron/updates.js`):

1. Añadir la dependencia `electron-updater`.
2. Publicar los instaladores como *assets* de la release, junto con el `latest.yml`
   que genera electron-builder (el bloque `publish` ya está en `package.json`).
3. Sustituir `check()` por `autoUpdater.checkForUpdates()` y enganchar los eventos
   `update-available` / `download-progress` / `update-downloaded`.
4. Firmar el instalador si se quiere evitar el aviso de SmartScreen (el pliego
   excluye expresamente la firma de pago).

Una actualización **no puede** borrar la base de datos, las preferencias, los
proyectos ni el runtime: todo eso vive en `<userData>`, fuera de la instalación. Y
antes de cualquier migración de esquema se hace una copia automática.

### Copias de seguridad

En `<userData>/backups/`, con nombre `python-classroom-<fecha>-<motivo>.db`:

- automática **antes de cada migración de esquema**;
- automática **antes de importar** una copia de seguridad;
- manual desde *Configuración → Copias y actualizaciones → Gestionar*;
- restauración con confirmación, que guarda antes una copia de lo que hay ahora;
- se conservan **como máximo las cinco más recientes**.

### Medidas reales de esta compilación

Medido en el equipo de desarrollo (Windows 11, x64) con `npm run dist:win`:

| Qué | Medida |
|---|---|
| Instalador `PythonClassroom-Setup-0.3.0.exe` | **113 MiB** (118 688 703 bytes) |
| Carpeta instalada (`win-unpacked`) | **401 MB** (Electron + Python 3.11.9 + librerías) |
| Runtime de Python dentro de `resources` | 42 MB |
| Código de la aplicación (`app.asar`) | 1,5 MB — sin `node_modules` |
| Arranque en frío, empaquetada | **719 ms** hasta que la ventana está lista |
| Arranque en frío, en desarrollo | 652–820 ms |
| Copia del runtime a `<userData>` | 2 878 archivos |

Comprobado en la carpeta empaquetada: no viaja `python/cache`, ni `__pycache__`, ni
`.pyc`, ni `node_modules`; la aplicación empaquetada arranca, crea su SQLite con el
esquema 3 en `<userData>` y registra el tiempo de arranque.

### Lo que NO se ha podido verificar aquí

Para no instalar software en el equipo donde se trabajó, **no se ejecutó el ciclo de
instalación real** que pide la fase 6 (instalar en carpeta limpia → abrir → crear la
cuenta del profesor → programar → `pip install` → cerrar y reabrir → desinstalar →
comprobar que los datos siguen → reinstalar). El instalador se generó y se validó su
contenido, y la aplicación empaquetada se arrancó desde `win-unpacked`, pero esos ocho
pasos siguen pendientes de hacerse a mano en un equipo de pruebas.

Tampoco se han generado los paquetes de **Linux** (AppImage, `.deb`) ni de **macOS**
(`.dmg`): electron-builder necesita ejecutarse en cada sistema (o con contenedores) y
aquí solo había Windows. La configuración está puesta y el código no tiene nada
específico de Windows salvo las rutas, que salen todas de `app.getPath('userData')`.

Y la rama de copia del runtime se probó **forzándola** desde las pruebas: en un equipo
con la aplicación instalada en `C:\Program Files` se activará sola, pero ese escenario
concreto —carpeta de instalación realmente de solo lectura— no se ha reproducido aquí.

### Generar los instaladores

```
npm run setup        # bundles + icono + runtime de Python
npm run dist:win     # NSIS  -> installer/dist/PythonClassroom-Setup-<versión>.exe
npm run dist:linux   # AppImage y .deb
npm run dist:mac     # .dmg
```

## Siguiente paso

Las seis fases del pliego están construidas. Lo que queda es trabajo de puesta en
marcha en el colegio: publicar las reglas de Firebase actualizadas, generar los
instaladores en cada sistema y probar el ciclo completo de instalación en un equipo
limpio (los resultados de esa prueba se anotan en la sección de empaquetado).
