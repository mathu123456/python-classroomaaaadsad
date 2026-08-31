/*
 * Tutorial interactivo de bienvenida (seccion 15 del pliego).
 *
 * Se muestra la primera vez que un estudiante entra. Tiene anterior,
 * siguiente, saltar y finalizar; al terminarlo (o saltarlo) se guarda
 * tutorialCompletado en la cuenta y no vuelve a aparecer solo.
 */

import { $, el, icon, clear } from './ui.js';

const PASOS_ESTUDIANTE = [
  {
    icono: 'py',
    titulo: 'Bienvenido a Python Classroom',
    texto: 'Esta aplicación trae su propio Python: puedes programar y ejecutar sin conexión a Internet.',
    puntos: [
      'Todo tu trabajo se guarda en este computador.',
      'No necesitas instalar Python ni ninguna otra cosa.'
    ]
  },
  {
    icono: 'file',
    titulo: '1. El editor',
    texto: 'Aquí escribes tu código Python con ayudas de un editor profesional.',
    puntos: [
      'Autocompletado mientras escribes (o con Ctrl+Espacio).',
      'Los errores de sintaxis se subrayan al momento.',
      'Ctrl+S guarda, Ctrl+Z deshace, Ctrl+F busca.'
    ],
    accion: 'irEditor'
  },
  {
    icono: 'play',
    titulo: '2. Ejecutar tu programa',
    texto: 'Pulsa el botón verde Ejecutar o usa Ctrl+Enter.',
    puntos: [
      'Tu programa corre en un proceso aparte: si se cuelga, la app sigue viva.',
      'Si tarda demasiado se detiene solo (puedes cambiar el límite en Configuración).',
      'El botón Detener corta la ejecución cuando quieras.'
    ]
  },
  {
    icono: 'console',
    titulo: '3. La consola',
    texto: 'Debajo del editor ves lo que imprime tu programa.',
    puntos: [
      'Los errores salen en rojo, con la línea donde ocurrieron.',
      'Cuando tu programa use input(), escribe la respuesta en la caja de abajo y pulsa Enter.'
    ],
    accion: 'irConsola'
  },
  {
    icono: 'terminal',
    titulo: '4. La terminal',
    texto: 'Una terminal de verdad, con el Python y el pip de la aplicación ya listos.',
    puntos: [
      'Escribe "python" para abrir el intérprete interactivo.',
      'Escribe "ayuda" para ver los comandos disponibles.'
    ],
    accion: 'irTerminal'
  },
  {
    icono: 'package',
    titulo: '5. Librerías',
    texto: 'Busca e instala librerías como numpy, pandas o pygame.',
    puntos: [
      'Instalar una librería nueva necesita Internet una sola vez.',
      'Después queda disponible sin conexión.'
    ],
    accion: 'irLibrerias'
  },
  {
    icono: 'tasks',
    titulo: '6. Ejercicios',
    texto: 'En la sección Ejercicios ves lo que ha propuesto tu profesor.',
    puntos: [
      'Al empezar un ejercicio se crea tu carpeta de trabajo con el enunciado.',
      'Cuando lo termines, márcalo como resuelto y sumarás XP.'
    ],
    accion: 'irEjercicios'
  },
  {
    icono: 'home',
    titulo: '7. Tu progreso',
    texto: 'En Inicio ves tu avance: ejercicios completados, XP y tiempo dedicado.',
    puntos: [
      'Todo se guarda aquí aunque no haya Internet.',
      'Ya puedes empezar. ¡Mucha suerte!'
    ],
    accion: 'irInicio'
  }
];

const PASOS_PROFESOR = [
  {
    icono: 'py',
    titulo: 'Bienvenido, profesor',
    texto: 'Esta cuenta administra el curso en este equipo.',
    puntos: [
      'Puedes crear el temario, los ejercicios y las cuentas de tus estudiantes.',
      'Todo funciona sin conexión.'
    ]
  },
  {
    icono: 'book',
    titulo: '1. El temario',
    texto: 'Empieza creando los temas del curso: Variables, Condicionales, Funciones…',
    puntos: ['Hay un temario sugerido de 17 temas que puedes cargar de una vez.'],
    accion: 'irEjercicios'
  },
  {
    icono: 'tasks',
    titulo: '2. Los ejercicios',
    texto: 'Cada ejercicio pertenece a un tema y define dificultad, XP y nota máxima.',
    puntos: [
      'Puedes poner fechas de inicio y cierre, tiempo límite e intentos.',
      'Los criterios de evaluación deben sumar la nota máxima.'
    ]
  },
  {
    icono: 'users',
    titulo: '3. Tus estudiantes',
    texto: 'Crea sus cuentas o deja que se registren ellos desde la pantalla de acceso.',
    puntos: [
      'Nadie más puede crear cuentas de profesor.',
      'Puedes restablecer contraseñas y desactivar cuentas.'
    ],
    accion: 'irCurso'
  },
  {
    icono: 'chart',
    titulo: '4. El seguimiento',
    texto: 'En Inicio ves el avance de todo el curso y de cada estudiante.',
    puntos: ['Calificaciones, rankings y sincronización llegarán en las siguientes fases.'],
    accion: 'irInicio'
  }
];

let indice = 0;
let pasos = PASOS_ESTUDIANTE;
let backdrop = null;
let hooks = {};
let alTerminar = null;

function pintar() {
  if (!backdrop) return;
  const paso = pasos[indice];
  const card = backdrop.querySelector('.tut-card');
  clear(card);

  card.append(
    el('div', { class: 'tut-head' },
      el('div', { class: 't-ico' }, icon(paso.icono, 22)),
      el('div', null,
        el('h3', null, paso.titulo),
        el('div', { class: 'step' }, 'Paso ' + (indice + 1) + ' de ' + pasos.length)
      )
    ),
    el('div', { class: 'tut-body' },
      el('p', null, paso.texto),
      paso.puntos ? el('ul', null, paso.puntos.map((p) => el('li', null, p))) : null
    ),
    el('div', { class: 'tut-dots' },
      pasos.map((_, i) => el('i', { class: i <= indice ? 'on' : '' }))
    ),
    el('div', { class: 'tut-foot' },
      el('button', { class: 'btn', onclick: () => cerrar(false) }, 'Saltar'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn outline',
        disabled: indice === 0,
        onclick: () => { indice = Math.max(0, indice - 1); pintar(); }
      }, 'Anterior'),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          if (indice >= pasos.length - 1) { cerrar(true); return; }
          indice++;
          pintar();
        }
      }, indice >= pasos.length - 1 ? 'Finalizar' : 'Siguiente')
    )
  );

  if (paso.accion && hooks[paso.accion]) {
    try { hooks[paso.accion](); } catch (err) { /* la navegacion es un extra */ }
  }
}

function onKey(event) {
  if (!backdrop) return;
  if (event.key === 'Escape') { event.preventDefault(); cerrar(false); }
  if (event.key === 'ArrowRight') { event.preventDefault(); if (indice < pasos.length - 1) { indice++; pintar(); } }
  if (event.key === 'ArrowLeft') { event.preventDefault(); if (indice > 0) { indice--; pintar(); } }
}

async function cerrar(completado) {
  if (!backdrop) return;
  backdrop.remove();
  backdrop = null;
  document.removeEventListener('keydown', onKey, true);
  try {
    await window.pc.users.setTutorialDone(true);
  } catch (err) { /* si falla, se volvera a ofrecer */ }
  if (alTerminar) alTerminar(completado);
}

/** Abre el tutorial. `rol` decide el guion. */
export function start(rol, appHooks, onDone) {
  if (backdrop) return;
  hooks = appHooks || {};
  alTerminar = onDone || null;
  pasos = rol === 'profesor' ? PASOS_PROFESOR : PASOS_ESTUDIANTE;
  indice = 0;

  backdrop = el('div', { class: 'tut-backdrop' }, el('div', { class: 'tut-card' }));
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  pintar();
}

export function isOpen() { return !!backdrop; }
