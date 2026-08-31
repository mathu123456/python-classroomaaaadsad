# Python Classroom: Acerca del Proyecto

## ¿Qué es Python Classroom?

**Python Classroom** es un IDE educativo de Python diseñado específicamente para entornos académicos. Se trata de una aplicación de escritorio moderna, construida con **Electron**, que integra un **editor de código profesional** (CodeMirror 6) con un **intérprete de Python real embebido** (CPython 3.11.9), todo funcionando completamente **offline-first**.

La aplicación está diseñada para facilitar la enseñanza y el aprendizaje de Python, permitiendo que profesores y estudiantes trabajen de forma colaborativa con un sistema robusto de gestión académica, evaluación, gamificación y seguimiento de progreso.

---

## Características Principales

### 1. **Editor CodeMirror 6**
- Números de línea y plegado de código
- Resaltado de sintaxis para Python
- Selección múltiple y operaciones avanzadas
- Buscar y reemplazar (`Ctrl+F`, `Ctrl+H`)
- Autocompletado inteligente:
  - Palabras reservadas y funciones integradas
  - Funciones del intérprete real con firma
  - Plantillas y símbolos del documento
  - Miembros tras el operador `.`
  - Módulos reales del runtime

### 2. **Python Embebido**
- CPython 3.11.9 integrado en la aplicación
- **El usuario no necesita instalar nada** — Python viene incluido
- Ejecución en proceso hijo aislado (nunca dentro de Electron)
- Tiempo máximo configurable (5 segundos a sin límite)
- Consola interactiva con:
  - Salida stdout y stderr
  - Colores ANSI nativos
  - Código de salida y duración de ejecución
  - Soporte para `input()` interactivo

### 3. **Terminal Integrada**
- Acceso a comandos como `python`, `pip`, `cd`
- El runtime interno tiene prioridad en el PATH
- Gestor visual de librerías:
  - Buscar, instalar, actualizar y desinstalar paquetes
  - Interfaz estilo Arduino IDE

### 4. **Persistencia Local con SQLite**
- Base de datos **SQLite real** (`node:sqlite`) en `<userData>/python-classroom.db`
- Sin módulos nativos que compilar
- Almacenamiento completo offline de:
  - Temarios y ejercicios
  - Clases y retos
  - Entregas y revisiones
  - Progreso de estudiantes
  - Calificaciones e historial

### 5. **Sistema Académico Completo**

#### Identidad y Autenticación
- **Firebase Authentication** (correo y contraseña)
- Roles: profesor y estudiante
- Los profesores se autorizan en Firebase o son asignados por otros profesores
- La aplicación **nunca** concede roles automáticamente

#### Gestión de Contenido
- **Temarios**: 17 temas base, editables, ordenables
- **Ejercicios**: 
  - Tipos: normal, cronometrado, de clase, reto, proyecto
  - Dificultad, XP, nota máxima, tiempo, intentos permitidos
  - Fechas de inicio/cierre, entrega tardía permitida
  - Criterios de evaluación
- **Clases**: Agrupan ejercicios, control de apertura/cierre
- **Retos**: Entidad propia con dificultad, XP, premio, requisitos y fechas

#### Ciclo de Vida de Ejercicios
- Estados: `draft → published → active → closed → archived`
- Hasta publicar, nadie ve el ejercicio
- Control granular de visibilidad y disponibilidad

#### Entregas y Evaluación
- Un registro por intento — **nunca se sobrescribe código anterior**
- Sesión de trabajo con cronómetro local
- Autoguardado cada 7 segundos en SQLite
- **Revisión en tres paneles**:
  1. Código del estudiante
  2. Código en CodeMirror (solo lectura)
  3. Panel de evaluación
- **Comentarios por línea**:
  - Tipos: error, warning, suggestion, positive, question
  - Marcados visualmente en el margen del código
- **Calificación**:
  - Nota numérica
  - XP otorgado
  - Comentario general
  - Rúbrica de evaluación que calcula automáticamente la nota
  - **Historial completo de cambios de nota**

### 6. **Gamificación**
- **Puntos de Experiencia (XP)**:
  - Se otorgan al calificar
  - Se acumulan en el progreso del estudiante
  - **Solo el profesor puede escribir XP** — las reglas de Firebase lo imponen
  - Los estudiantes ven "XP pendiente" hasta recibir calificación

- **Insignias**: Sistema de logros personalizados
- **Premios**: Sistema de recompensas
- **Rankings**:
  - Ranking global por XP
  - Rankings por tema
  - Rankings por grado
  - Cálculo automático y publicación en tiempo real

### 7. **Sincronización y Trabajo Sin Conexión**

#### Arquitectura de Sincronización
```
editor  →  SQLite  →  cola de sincronización  →  Firebase
                ↑                                    │
                └──────────  arrastre  ←─────────────┘
```

#### Funcionamiento Offline
- El usuario sigue programando, ejecutando y entregando sin conexión
- La cola de sincronización guarda todos los cambios localmente
- Al recuperar conexión, la cola se vacía automáticamente
- **Nada local se borra hasta confirmar el envío a Firebase**

#### Qué sube a Firebase
- Solo los hechos importantes: publicar, entregar, calificar, comentar, cambiar estado
- El autoguardado **nunca** llega a Firebase

### 8. **Estadísticas y Progreso**
- Seguimiento de completados y aprobados
- Promedio de calificación
- XP acumulado por tema
- Tiempo dedicado por ejercicio y tema
- Datos para rankings automáticos

### 9. **Aplicación Móvil (PWA)**
- Progressive Web App para estudiantes en [`mobile/`](mobile/)
- Acceso desde dispositivos móviles
- Sincronización con la base de datos central

---

## Arquitectura Técnica

### Stack Tecnológico
- **Desktop**: Electron 43.4.1
- **Frontend**: HTML5, CSS3 nativo, JavaScript puro (sin frameworks)
- **Editor**: CodeMirror 6
- **Base de datos local**: SQLite con `node:sqlite`
- **Autenticación**: Firebase Authentication
- **Base de datos remota**: Firebase Realtime Database
- **Runtime**: CPython 3.11.9 embebido
- **Compilación**: esbuild para bundles optimizados

### Seguridad
- Las **reglas de Firebase** imponen que:
  - Solo profesores pueden escribir calificaciones y XP
  - Solo profesores pueden otorgar insignias y premios
  - Estudiantes solo ven sus propias entregas
  - Profesores descarga máximo 400 entregas recientes
- Estudiantes no pueden modificar directamente: XP, notas, insignias, rankings
- Todos los hechos importantes quedan registrados en el historial

### No Usa
- ❌ Frameworks frontend (React, Vue, Angular)
- ❌ Django, Express, servidores backend propios
- ❌ MongoDB, MySQL, PostgreSQL
- ❌ Google Sheets o Google Drive para datos
- ❌ Firebase Storage (solo Realtime Database)
- ❌ Cloud Functions de Firebase
- ❌ Librerías externas de gráficas o componentes UI

---

## ¿Qué se Espera de Python Classroom?

### Objetivo Educativo
Python Classroom debe ser una **herramienta integral y accesible** que permita:

1. **A los estudiantes:**
   - Aprender Python de forma interactiva y práctica
   - Resolver ejercicios con feedback inmediato
   - Ver su progreso en tiempo real
   - Recibir retroalimentación detallada de profesores
   - Participar en retos y ganar insignias/premios
   - Trabajar incluso sin conexión a internet

2. **A los profesores:**
   - Crear y gestionar cursos y ejercicios fácilmente
   - Evaluar entregas de código con comentarios precisos
   - Calificar con rúbricas consistentes
   - Ver estadísticas y rankings de estudiantes
   - Identificar áreas de dificultad
   - Motivar a través de gamificación

### Características Esperadas del Proyecto

#### ✅ Completadas (Fase 1-3)
- IDE funcional con editor profesional
- Python embebido y ejecutable
- Sistema académico robusto
- Persistencia offline con SQLite
- Sincronización bidireccional con Firebase
- Entregas y evaluación por intento
- Calificación con historial

#### ✅ Completadas (Fase 4-6)
- Gamificación: insignias, premios, rankings
- Estadísticas y reportes
- Empaquetado y instaladores para Windows, macOS, Linux
- Actualizaciones automáticas

#### 📊 Estado Actual
- **Versión 2.0.0** completa y probada (incluye Cursos: aislamiento por profesor,
  código de acceso, elección de rol al registrarse; ver `README.md` para el detalle)
- **259 pruebas de extremo a extremo en verde**
- Sincronización con cola y prioridades
- Tiempo real con Firebase
- Trabajo sin conexión confirmado
- Fotos de perfil en perfiles de usuario
- **Entregas de varios archivos que el profesor ejecuta desde la revisión**

### Lo que está fuera del alcance
- Tienda de premios con monedas o niveles específicos
- Predicciones o recomendaciones automáticas avanzadas
- Actualizaciones automáticas sin intervención del usuario

---

## Estructura del Proyecto

```
python-classroom/
├── src/                    # Código frontend
│   ├── index.html         # Interfaz principal
│   ├── css/               # Estilos (reset, componentes, editor, dashboard, etc.)
│   └── js/                # Lógica frontend
│       ├── app.js         # Aplicación principal
│       ├── auth.js        # Autenticación Firebase
│       ├── firebase.js    # Integración con Firebase
│       ├── sync.js        # Cola de sincronización
│       ├── editor.js      # Editor CodeMirror
│       ├── exercises.js   # Gestión de ejercicios
│       ├── dashboard.js   # Dashboard de estudiantes
│       ├── review.js      # Panel de revisión para profesores
│       ├── rankings.js    # Vista de rankings
│       ├── stats.js       # Estadísticas
│       └── ... (más módulos)
├── electron/              # Código Electron (main, preload, IPC)
│   ├── main.js           # Punto de entrada principal
│   ├── preload.js        # Script de precarga seguro
│   ├── sqlite.js         # Módulo SQLite
│   ├── firebase-config.js # Configuración Firebase
│   ├── ipc/              # Canales IPC (data, exchange, files, packages, python, system, terminal)
│   └── repos/            # Capas de datos (academic, gamification, stats, users, work)
├── python/               # Runtime de Python embebido
│   ├── runtime/          # Python 3.11.9 compilado para Windows x64
│   ├── tools/            # Herramientas Python (pcheck.py, etc.)
│   └── cache/            # Caché de instalación (get-pip.py)
├── mobile/               # Aplicación móvil (PWA)
├── firebase/             # Configuración de Firebase
│   ├── database.rules.json  # Reglas de seguridad
│   └── CONFIGURACION.md     # Guía de setup
├── scripts/              # Scripts de desarrollo y construcción
├── installer/            # Ejecutables construidos
├── build/                # Bundles generados (esbuild)
├── assets/               # Recursos (iconos, etc.)
├── package.json          # Metadatos del proyecto
├── README.md             # Documentación técnica
├── PROXIMAS-FASES.md     # Especificaciones de fases
└── ACERCA_DEL_PROYECTO.md # Este archivo
```

---

## Cómo Empezar

### Instalación de Dependencias
```bash
npm install
npm run setup
```

### Desarrollo
```bash
npm run dev        # Ejecutar en modo desarrollo
npm run doctor     # Diagnóstico del entorno
```

### Pruebas
```bash
npm run test:e2e   # Ejecutar todas las pruebas end-to-end
```

### Construcción
```bash
npm run dist:win   # Construir instalador para Windows
npm run dist:mac   # Construir para macOS
npm run dist:linux # Construir para Linux
```

### Configuración de Firebase
Antes de usar la app, es necesario:
1. Crear un proyecto en Firebase Console
2. Activar **Authentication → Email/Password**
3. Publicar `firebase/database.rules.json` en **Realtime Database → Rules**

Ver [`firebase/CONFIGURACION.md`](firebase/CONFIGURACION.md) para detalles completos.

---

## Conclusión

Python Classroom es un **proyecto integral y maduro** que busca revolucionar la enseñanza de Python en contextos educativos. Combina tecnología profesional (Electron, Firebase, SQLite) con una experiencia de usuario intuitiva para crear un entorno donde estudiantes y profesores puedan colaborar de forma efectiva, incluso sin conexión a internet.

Con 259 pruebas pasadas, gamificación, estadísticas en tiempo real, evaluación detallada y aislamiento total entre los cursos de cada profesor, Python Classroom está listo para ser una herramienta confiable en el aula del siglo XXI.

---

**Versión**: 2.0.0  
**Estado**: Producción  
**Última actualización**: Agosto 2026
