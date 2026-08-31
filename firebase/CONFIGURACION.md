# Puesta en marcha de Firebase

Estos pasos hay que hacerlos **una sola vez** en la consola de Firebase. No se
pueden automatizar desde la aplicación: requieren tu cuenta de Google.

Proyecto: **classroom-python-94ff5**

---

## 1. Realtime Database

Ya existe y responde en:

```
https://classroom-python-94ff5-default-rtdb.firebaseio.com
```

> Este `databaseURL` **no venía** en el fragmento de configuración que copiaste
> de la consola (Firebase solo lo incluye si creas la base de datos después).
> Está añadido en `electron/firebase-config.js`.

Si algún día cambias de región, actualiza ese valor o crea el archivo
`<userData>/firebase.json` con tu propia configuración.

## 2. Activar el acceso con correo y contraseña

`Firebase Console → Build → Authentication → Get started → Sign-in method →
Email/Password → Enable → Save`

Sin este paso la aplicación mostrará:

> «El acceso con correo y contraseña no está activado en Firebase.»

## 3. Publicar las reglas de seguridad

`Firebase Console → Build → Realtime Database → Rules`

Pega el contenido de **`firebase/database.rules.json`** y pulsa **Publish**.

Mientras la base esté en modo bloqueado (el que trae por defecto), la app
mostrará «Firebase rechazó la operación por las reglas de seguridad».

### Qué garantizan esas reglas

| Un estudiante… | ¿puede? |
|---|---|
| leer temario, ejercicios, clases y retos | sí |
| crear y editar **sus** borradores y entregas | sí |
| leer **sus** notas y comentarios | sí |
| leer el ranking | sí |
| ver el catálogo de insignias y premios | sí |
| leer **sus** insignias concedidas | sí |
| cambiar **su** foto de perfil | sí |
| cambiar la foto de otra persona | **no** |
| escribirse una nota o XP | **no** |
| concederse una insignia | **no** |
| crear o editar insignias y premios | **no** |
| escribir en `rankings/` | **no** |
| tocar la entrega de otro | **no** |
| ser el primer profesor de una instalación de Firebase completamente vacía | **sí, una sola vez** |
| ascenderse a profesor de cualquier otra forma (sin ser el primero, sin que otro profesor lo apruebe) | **no** |
| crear, editar o borrar ejercicios | **no** |
| leer la lista completa de cuentas | **no** |

La aplicación **sí** deja que la primera cuenta se convierta en profesor —eso es lo que
significa `config/bootstrap`, un nodo que las reglas solo dejan escribir una vez
(`!data.exists()`), y solo con el propio uid de quien escribe—. Lo que no permiten las
reglas es que una segunda, tercera o enésima cuenta repita el truco: una vez que
`config/bootstrap` tiene un valor, nadie más puede tocarlo, ni siquiera para ponerlo con
su propio uid, así que borrar la base de datos LOCAL de un equipo no cambia nada -el
bootstrap vive en Firebase, no en SQLite-.

## 4. Autorizar al profesor

Hay dos caminos. El primero no necesita tocar la consola en absoluto:

**A) Registrarse como el primer profesor (instalación nueva).** Si `config/bootstrap`
todavía no existe en tu proyecto -el caso normal la primera vez que configuras el
colegio-, la primera persona que abre **Crear una cuenta**, elige «Quiero ser profesor» y
la envía sin ningún código de curso queda como profesor de una, con su propio «Curso
general» creado en el momento. No hace falta ninguna herramienta administrativa para
esto: es exactamente el flujo que sigue cualquiera al instalar la aplicación por primera
vez.

**B) Desde la consola (para añadir un profesor sin pasar por una solicitud).**

1. `Authentication → Users`: crea la cuenta del profesor (o localiza la que ya
   existe) y **copia su UID**.
2. `Realtime Database → Data`: crea `roles/<UID>` con el valor de texto
   `teacher`.

Hecho eso, el profesor entra con su correo y su contraseña como cualquiera.

**Un tercer camino, ya dentro de la aplicación y sin consola:** cualquier persona que
elija «profesor» en el alta DESPUÉS de que el bootstrap ya esté reclamado por otra cuenta
necesita el código de acceso de un curso existente. Su cuenta queda de **estudiante**, con
una solicitud pendiente que solo ve el dueño de ese curso, en *Estudiantes y cuentas →
Solicitudes para ser profesor* — desde ahí la aprueba (queda como coprofesor de ese curso)
o la rechaza. Ver la sección «Quién es profesor: la barrera de seguridad» del `README.md`
para el detalle completo de las tres rutas.

Los estudiantes no necesitan nada de esto: al crear su cuenta (sin elegir «profesor»), la
aplicación escribe `roles/<uid> = student`, que es lo único que las reglas admiten sin
ninguna condición desde un cliente.

## 5. Primer arranque

1. Abre la aplicación con Internet.
2. Verás directamente la pantalla de **acceso**. Si es la primera vez que se usa este
   proyecto de Firebase, pulsa **Crear una cuenta**, elige «Quiero ser profesor» y
   déjalo sin código: quedas de profesor de una (paso 4A). Si el proyecto ya tenía
   profesor, entra con la cuenta que autorizaste en el paso 4B, o pide el código de un
   curso existente y espera a que su dueño apruebe tu solicitud.
3. Después, cada estudiante abre la app, pulsa **Crear una cuenta**, deja marcado
   «Quiero ser estudiante» y escribe el código de su clase; su rol queda como `student`.

A partir del primer inicio de sesión, la aplicación funciona **sin conexión**:
la sesión queda guardada y todo el trabajo se guarda en SQLite. Lo pendiente se
sube solo cuando vuelve Internet.

---

## Estructura de datos en la Realtime Database

Lo que es de **un curso concreto** vive anidado bajo `courses/<id>/…`: el curso lo
decide la ruta, no una condición que se pueda olvidar. Lo que es de **todo el
colegio** (identidad, temario, catálogo de insignias y premios) se queda global.

```
config/
  lastChange          señal ligera: "hay novedades en el catálogo compartido"
  bootstrap           uid del PRIMER profesor de la instalación (se reclama una sola vez)
roles/<uid>           "teacher" | "student"
users/<uid>           perfil (sin rol, sin XP) — cada quien lee y escribe SOLO el suyo
userSignals/<uid>/lastChange        aviso "te calificaron o te concedieron algo"
topics/<id>            temario: catálogo compartido
badges/<id>            catálogo de insignias: compartido (quién la ganó sí es del curso)
rewards/<id>           catálogo de premios: compartido

courseCodes/<código>   código de acceso -> id del curso (para unirse)

courses/<id>/
  teacherId, name, accessCode, status, rankingLimit, createdAt, updatedAt
  members/<uid>                        "student" | "co_teacher" (matrícula)
  roster/<uid>                         copia del perfil, la escribe cada quien de sí mismo
                                        (si pidió ser profesor de este curso, incluye
                                        teacherRequestedAt/teacherRequestedCourseId)
  groups/<id>                          grupos con nombre y sus miembros
  exercises/<id>                       incluye `targets` (a quién va dirigido)
  classes/<id>
  challenges/<id>
  submissions/<id>                     incluye el código como texto
  feedback/<submissionId>/<id>         comentarios por línea
  gradeHistory/<submissionId>/<id>     cambios de nota
  sessionEvents/<uid>/<id>             actividad del ejercicio
  studentProgress/<uid>                progreso calculado
  rankings/                            global, por tema y por grado
  userBadges/<uid>/<badgeId>           insignias concedidas EN ESTE curso
  submissionSignals/lastChange         aviso "hay entregas nuevas" (solo lo lee el profesor)
```

La retroalimentación, el historial y los eventos van **anidados** bajo la
entrega o el estudiante al que pertenecen, dentro del propio curso. Así una
sola regla decide quién puede leerlos, y ni un estudiante ni un profesor de
otro curso necesitan (ni pueden) leer una colección entera ajena.

## Cambios de la fase 4 (gamificación)

Las reglas publicadas incluyen tres nodos nuevos y una clave más en `config/`.
Si ya tenías las reglas de la fase 3 publicadas, **vuelve a pegar el archivo
`firebase/database.rules.json` completo**: sin esto, la aplicación no podrá
subir las insignias y verás «Firebase rechazó la operación por las reglas».

| Nodo | Lee | Escribe |
|---|---|---|
| `badges/<id>` | cualquier usuario autenticado | solo el profesor |
| `userBadges/<uid>/<badgeId>` | el propio estudiante y el profesor | **solo el profesor** |
| `rewards/<id>` | cualquier usuario autenticado | solo el profesor |
| `config/rankingLimit` | cualquier usuario autenticado | solo el profesor |

El motivo es el mismo que con las notas: **el cliente siempre es manipulable**.
El cliente del estudiante *calcula* qué insignias le corresponden para poder
mostrarle su vitrina y lo que le falta, pero la concesión real la escribe el
cliente del profesor en el mismo momento en que califica. Las reglas rechazan
cualquier escritura de un estudiante en `badges/`, `userBadges/`, `rewards/` y
`rankings/`, y además validan que la insignia concedida exista en el catálogo y
que el `studentId` coincida con la rama donde se escribe.

`config/rankingLimit` es cuántos puestos del ranking ve un estudiante; su
propia posición se le muestra siempre, aunque quede fuera de esa lista.

## Cambios de Cursos (aislamiento por profesor)

Las reglas se reescribieron por completo: lo académico se movió de la raíz a
`courses/<id>/…`, y `courses.rankingLimit` sustituye a `config/rankingLimit`. Si
ya tenías publicadas las reglas de una versión anterior, **vuelve a pegar el
archivo `firebase/database.rules.json` completo** — sin esto, ningún ejercicio,
entrega ni calificación podrá subir, y verás «Firebase rechazó la operación».

No hace falta mover nada a mano: la aplicación migra sola la primera vez que
abre con estas reglas ya publicadas. Crea un «Curso general» con el profesor
más antiguo de dueño, matricula a todo el que ya existiera (los demás
profesores, si los había, entran como co-profesores del mismo curso) y
completa el `courseId` de todo lo que ya había. Los nodos planos de antes
(`exercises/`, `submissions/`, …) quedan huérfanos pero intactos en la consola;
borrarlos es opcional y manual, cuando quieras liberar ese espacio.

| Nodo | Lee | Escribe |
|---|---|---|
| `users/<uid>` | solo el propio dueño | solo el propio dueño |
| `courses/<id>` | el dueño del curso o cualquier miembro | el dueño del curso (por campo) |
| `courses/<id>` **(el nodo entero)** | — | el dueño del curso, incluido borrarlo entero |
| `courses/<id>/members/<uid>` | (hereda del curso) | el propio estudiante una vez, o el dueño |
| `courses/<id>/roster/<uid>` | el propio, el dueño o un co-profesor | el propio o el dueño |
| `courses/<id>/exercises` `/classes` `/challenges` | el dueño o cualquier miembro | solo el dueño |
| `courses/<id>/submissions` | el dueño, o el propio estudiante por consulta | el dueño, o el propio estudiante (sin tocar nota) |
| `courseCodes/<código>` | cualquier usuario autenticado | el dueño del curso al que apunta, una sola vez |
| `config/bootstrap` | cualquier usuario autenticado | quien escriba primero, con su propio uid — una sola vez para siempre |
| `roles/<uid>` | cualquier usuario autenticado | el propio, una vez (`student`, o `teacher` solo si ganó el bootstrap) — o cualquier profesor existente, cualquier uid |

Antes, un profesor podía leer `users/` entero y ver a cualquier estudiante del
colegio. Ahora un profesor nunca lee el perfil global de nadie: ve a sus
estudiantes por `roster`, una copia que cada quien escribe de sí mismo al
sincronizar, dentro del curso del que es miembro.

La fila «`courses/<id>` (el nodo entero)» es aparte de la fila `courses/<id>`
de arriba porque no describe un campo (nombre, código, estado...), sino el
`.write` que cuelga del propio `$courseId`, al mismo nivel que su `.read`:
`data.child('teacherId').val() === auth.uid`. Hace falta porque borrar el
curso completo -members, roster, exercises, submissions y todo lo demás de un
plumazo- no es escribir un campo suelto, es reemplazar el nodo entero por
nada; sin este `.write` a ese nivel, Firebase seguiría dejando tocar cada
campo por separado pero rechazaría el `remove()` del nodo completo que la
herramienta de borrado de curso (fase 7) necesita. Sigue exigiendo ser el
dueño: un coprofesor no puede borrar el curso al que se unió.

## Por qué `roles/` tiene que poder leerse con la sesión iniciada

La aplicación de escritorio **comprueba el rol en su proceso principal**, no en la
interfaz: con el ID token de la sesión llama a `accounts:lookup` (para saber de quién es
el token) y después lee `roles/<uid>` por la API REST de la Realtime Database.

Por eso la regla de `roles` mantiene `".read": "auth != null"`. Si la cierras, la
aplicación no podrá demostrar que alguien es profesor y **todas las sesiones entrarán con
permisos de estudiante** en equipos donde no se hubiera verificado antes. Lo que sí está
cerrado es la escritura: un estudiante no puede cambiar su rol ni el de nadie.

El motivo de hacerlo así está explicado en el README («Quién es profesor: la barrera de
seguridad»): antes el rol lo decidía el cliente, y con las herramientas de desarrollo —o
borrando la base de datos local— alguien podía quedarse con permisos de profesor en su
equipo.

## Fotografías de perfil (Cloudinary)

Las fotos **no** se guardan en Realtime Database: allí solo va la dirección. Las
imágenes viven en Cloudinary, y la aplicación las sube **sin ninguna clave
secreta**. Esto hay que hacerlo una vez:

1. En Cloudinary: `Settings → Upload → Upload presets → Add upload preset`.
2. **Signing Mode: Unsigned.** Es el punto importante.
3. Nombre: `python_classroom_perfiles` (o el que quieras; luego se escribe en la
   aplicación).
4. Recomendado en el mismo preset: carpeta `python-classroom/perfiles`,
   `Max file size` 300 KB y formatos permitidos `jpg, png, webp`.
5. En Python Classroom: *Configuración → Fotos de perfil → Configurar* y escribe
   el nombre de la cuenta (`cloud name`) y el del preset.

### Por qué sin firmar, y por qué no hay `api_secret` en el código

El `api_secret` de Cloudinary permite **borrar y modificar todo** el contenido de
la cuenta. Una aplicación de escritorio es un archivo que está en el computador
de cada estudiante: cualquier clave que se meta dentro se puede extraer de ahí.
Por eso la subida se hace con un preset sin firmar, que es el mecanismo previsto
justo para clientes: los límites (carpeta, tamaño, formatos) los pone el preset
en el servidor de Cloudinary, y la aplicación no guarda ningún secreto.

Si algún día hace falta subir con firma, el sitio correcto para el `api_secret`
sería un servidor propio que firme cada subida — y este proyecto, por diseño, no
tiene servidor propio.

### Qué se guarda de una foto

- En Cloudinary: la imagen, recortada a 256×256 y comprimida **antes** de salir
  del equipo (unas decenas de KB).
- En Realtime Database: `users/<uid>/photoURL`, y solo si empieza por
  `https://res.cloudinary.com/` (lo validan las reglas).
- Si alguien no tiene foto, se muestran sus iniciales. Nunca una URL, ni un hueco
  roto, ni «null».

## Notas honestas

- La `apiKey` que aparece en el código **no es un secreto**: en una app web de
  Firebase es un identificador público. Lo que protege los datos son las reglas
  de arriba. Aun así, no publiques el proyecto sin haberlas aplicado.
- El primer inicio de sesión en cada equipo **necesita Internet**. Firebase
  Authentication no puede verificar una contraseña sin conexión.
- Las reglas de la Realtime Database no pueden validar todo lo que validaría un
  servidor propio. La aplicación además comprueba los permisos en local, pero la
  frontera de confianza real son las reglas.
- El control de salida de pestaña deja constancia de la actividad; **no** impide
  usar otro programa ni otro dispositivo. Es un mecanismo académico, no un
  sistema anti-trampas.
