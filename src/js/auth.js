/*
 * Pantalla de acceso y sesion, sobre Firebase Authentication.
 *
 * Modos:
 *   login      entrar con correo y contrasena (pantalla de arranque)
 *   registro   alta, con un selector de "quiero ser estudiante / profesor"
 *   recuperar  envio de correo para restablecer la contrasena
 *   problema   diagnostico cuando Firebase no esta disponible
 *
 * El formulario de alta deja elegir el rol, pero elegir "profesor" NUNCA lo
 * concede sin más: solo la PRIMERA persona que lo pide en una instalacion de
 * Firebase (sin ningun profesor todavia) lo consigue sola -un nodo que solo
 * se puede reclamar una vez, primero en llegar se lo lleva-. Cualquier
 * "profesor" despues de ese primero queda como estudiante con una SOLICITUD
 * pendiente, visible solo para el dueño del curso cuyo codigo escribio, que
 * la aprueba o la rechaza desde "Estudiantes y cuentas". Nadie se auto-asciende
 * despues del primero: las Security Rules lo imponen y, ademas, el proceso
 * principal comprueba el rol por su cuenta (electron/role-verify.js).
 *
 * Tras iniciar sesion, el perfil se espeja en SQLite para que la aplicacion
 * funcione sin conexion.
 */

import { $, el, icon, clear, toast, modal, confirmDialog } from './ui.js';
import * as fb from './firebase.js';
import { unirseACurso, traerCursoSiHaceFalta } from './join-course.js';

let usuario = null;
let hooks = {};
let modo = 'login';
let correoSugerido = '';
let conexion = { disponible: false, habilitado: true, online: true, error: null };

/* ------------------------------------------------------------- widgets */

function campo(nombre, etiqueta, opciones = {}) {
  const input = el('input', {
    class: 'input',
    id: 'f-' + nombre,
    name: nombre,
    type: opciones.type || 'text',
    value: opciones.value || '',
    placeholder: opciones.placeholder || '',
    autocomplete: opciones.autocomplete || 'off',
    spellcheck: 'false',
    maxlength: opciones.maxlength || 120
  });

  let control = input;
  if (opciones.icon) {
    control = el('div', { class: 'input-with-icon' }, el('span', { class: 'lead' }, icon(opciones.icon, 14)), input);
    if (opciones.type === 'password') {
      const ojo = el('button', {
        class: 'icon-btn trail', type: 'button', title: 'Mostrar u ocultar',
        onclick: () => {
          const visible = input.type === 'text';
          input.type = visible ? 'password' : 'text';
          clear(ojo).append(icon(visible ? 'eye' : 'eye-off', 14));
          input.focus();
        }
      }, icon('eye', 14));
      control.append(ojo);
    }
  }

  return el('div', { class: 'form-field', dataset: { field: nombre } },
    el('label', { for: 'f-' + nombre }, etiqueta),
    control,
    opciones.meter ? el('div', { class: 'pass-meter' }, el('i'), el('i'), el('i'), el('i')) : null,
    el('div', { class: 'err' })
  );
}

function valores(form) {
  const out = {};
  for (const input of form.querySelectorAll('input')) {
    out[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return out;
}

function limpiarErrores(form) {
  for (const f of form.querySelectorAll('.form-field')) {
    f.classList.remove('error');
    const err = f.querySelector('.err');
    if (err) err.textContent = '';
  }
  const aviso = form.querySelector('.form-note.err');
  if (aviso) aviso.remove();
}

function pintarErrores(form, errores, general) {
  limpiarErrores(form);
  for (const [nombre, mensaje] of Object.entries(errores || {})) {
    const f = form.querySelector('[data-field="' + nombre + '"]');
    if (f) { f.classList.add('error'); f.querySelector('.err').textContent = mensaje; }
    else general = general || mensaje;
  }
  if (general) form.prepend(el('div', { class: 'form-note err' }, general));
  const primero = form.querySelector('.form-field.error input');
  if (primero) primero.focus();
}

function fuerza(pass) {
  let n = 0;
  if (pass.length >= 6) n++;
  if (pass.length >= 10) n++;
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) n++;
  if (/\d/.test(pass) || /[^A-Za-z0-9]/.test(pass)) n++;
  return Math.min(4, n);
}

function conectarMedidor(form) {
  const input = form.querySelector('input[name="password"]');
  const meter = form.querySelector('.pass-meter');
  if (!input || !meter) return;
  input.addEventListener('input', () => { meter.className = 'pass-meter l' + fuerza(input.value); });
}

function ocupado(boton, activo, texto) {
  boton.disabled = activo;
  if (activo) {
    boton.dataset.label = boton.textContent;
    clear(boton).append(el('span', { class: 'spinner' }), document.createTextNode(' ' + (texto || 'Un momento…')));
  } else if (boton.dataset.label) {
    boton.textContent = boton.dataset.label;
  }
}

function validarBasico(datos, opciones) {
  const errores = {};
  const correo = String(datos.correo || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) errores.correo = 'El correo no tiene un formato válido.';
  if (opciones.nombre) {
    if (String(datos.nombre || '').trim().length < 2) errores.nombre = 'Escribe el nombre.';
    if (String(datos.apellido || '').trim().length < 2) errores.apellido = 'Escribe el apellido.';
  }
  if (opciones.password) {
    const p = String(datos.password || '');
    if (p.length < 6) errores.password = 'La contraseña debe tener al menos 6 caracteres.';
    else if (datos.password2 !== undefined && datos.password2 !== p) {
      errores.password2 = 'Las contraseñas no coinciden.';
    }
  }
  return errores;
}

/*
 * Ultima sesion sin poder comprobar el rol contra Firebase. La interfaz lo usa
 * para avisar de que se esta trabajando con permisos de estudiante hasta que
 * haya conexion.
 */
let verificacionPendiente = false;

export function rolSinVerificar() { return verificacionPendiente; }

/* ------------------------------------------- alta de perfil en Firebase */

/**
 * Tras autenticar, deja el perfil y el rol en la Realtime Database y espeja
 * todo en SQLite. Si la red falla, el espejo local igual queda hecho.
 */
async function establecerSesion(user, datos, opciones) {
  const opts = opciones || {};

  if (fb.snapshot().disponible) {
    /*
     * Lo unico que escribe la aplicacion en roles/ es el 'student' de un alta
     * nueva. El rol de profesor lo autoriza una persona en la consola de
     * Firebase: aqui no hay ningun camino que lo conceda, ni siquiera en un
     * proyecto recien creado.
     */
    if (opts.nuevoEstudiante) {
      try {
        await fb.escribir('roles/' + user.uid, 'student');
      } catch (err) {
        console.warn('[auth] no se pudo guardar el rol de estudiante:', err);
      }
    }

    if (datos) {
      try {
        await fb.escribir('users/' + user.uid, {
          email: user.email,
          firstName: datos.nombre || '',
          lastName: datos.apellido || '',
          grade: datos.grado || '',
          groupName: datos.grupo || '',
          active: true,
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        console.warn('[auth] no se pudo guardar el perfil remoto:', err);
      }
    } else {
      try {
        const remoto = await fb.leer('users/' + user.uid);
        if (remoto) {
          datos = {
            nombre: remoto.firstName || '',
            apellido: remoto.lastName || '',
            grado: remoto.grade || '',
            grupo: remoto.groupName || ''
          };
        }
      } catch (err) { /* sin conexion: se usa lo que haya en local */ }
    }
  }

  /*
   * Alta como "quiero ser profesor": primero se intenta el BOOTSTRAP (ser el
   * primer profesor de esta instalación) con una escritura directa que solo
   * puede tener éxito una vez -si ya existía, no eres el primero-. Si el
   * bootstrap no fue posible, hace falta el código de un curso para saber a
   * quién avisar: se resuelve (sin matricular a nadie) y se deja la propia
   * entrada en el roster de ESE curso para que su profesor revise la
   * solicitud. Sin bootstrap y sin código, no hay a quién pedirle nada: la
   * cuenta queda como estudiante, sin ninguna solicitud registrada.
   */
  let cursoSolicitadoId = null;
  if (opts.nuevoProfesor && fb.snapshot().disponible) {
    let soyElPrimero = false;
    try {
      await fb.escribir('config/bootstrap', user.uid);
      soyElPrimero = true;
    } catch (err) { /* ya había alguien: no eres el primero */ }

    if (soyElPrimero) {
      try {
        await fb.escribir('roles/' + user.uid, 'teacher');
      } catch (err) {
        console.warn('[auth] bootstrap: no se pudo fijar el rol de profesor:', err);
      }
    } else if (datos && datos.codigoCurso) {
      const codigo = String(datos.codigoCurso).trim().toUpperCase();
      await traerCursoSiHaceFalta(codigo);
      const encontrado = await window.pc.courses.findByCode(codigo);
      if (encontrado.ok) {
        cursoSolicitadoId = encontrado.curso.id;
        try {
          /*
           * teacherRequestedAt/teacherRequestedCourseId van AQUÍ, en esta
           * escritura directa -no solo en el perfil local que sube después
           * por la cola normal-, porque quien pide ser profesor todavía NO
           * es miembro de este curso: el abanico normal a courseRoster
           * (enqueueRosterFanout, en electron/repos/users.js) solo cubre los
           * cursos de los que YA se es miembro, así que nunca tocaría el
           * roster de ESTE curso. Sin esto, el profesor vería un roster
           * nuevo pero SIN la solicitud marcada.
           */
          await fb.escribir('courses/' + cursoSolicitadoId + '/roster/' + user.uid, {
            email: user.email, firstName: datos.nombre || '', lastName: datos.apellido || '',
            grade: datos.grado || '', groupName: datos.grupo || '',
            teacherRequestedAt: new Date().toISOString(),
            teacherRequestedCourseId: cursoSolicitadoId,
            updatedAt: new Date().toISOString()
          });
          toast('Se envió tu solicitud para ser profesor de «' + encontrado.curso.nombre + '». ' +
            'Su profesor debe aprobarla.', { type: 'ok', timeout: 7000 });
        } catch (err) {
          console.warn('[auth] no se pudo avisar al profesor de la solicitud:', err);
        }
      } else {
        toast(encontrado.error || 'Ese código no corresponde a ningún curso activo: tu cuenta ' +
          'quedó creada, pero sin ninguna solicitud de profesor.', { type: 'warn', timeout: 8000 });
      }
    } else {
      toast('No diste el código de ningún curso: tu cuenta quedó creada como estudiante, sin ' +
        'ninguna solicitud de profesor.', { type: 'warn', timeout: 8000 });
    }
  }

  /*
   * El rol NO se manda desde aqui. Se entrega el ID token de Firebase y el
   * proceso principal comprueba por su cuenta quien es y que rol tiene
   * (electron/role-verify.js). Asi, aunque alguien abra las herramientas de
   * desarrollo y llame a este canal a mano, no puede declararse profesor.
   */
  let idToken = null;
  try {
    idToken = await user.getIdToken();
  } catch (err) {
    console.warn('[auth] no se pudo obtener el token de sesión:', err);
  }
  if (!idToken) throw new Error('No se pudo comprobar tu sesión. Vuelve a intentarlo.');

  const res = await window.pc.session.set({
    uid: user.uid,
    email: user.email,
    idToken: idToken,
    firstName: datos ? datos.nombre : undefined,
    lastName: datos ? datos.apellido : undefined,
    grade: datos ? datos.grado : undefined,
    groupName: datos ? datos.grupo : undefined,
    teacherRequestedCourseId: cursoSolicitadoId
  });

  usuario = res.usuario;
  verificacionPendiente = !!res.verificacionPendiente;
  if (verificacionPendiente) {
    console.warn('[auth] rol sin verificar (' + (res.motivo || 'sin conexión') + '): sesión con permisos de estudiante');
  }
  hide();
  if (hooks.onLogin) await hooks.onLogin(usuario, opts);

  /*
   * Una cuenta de estudiante nueva necesita un curso: es lo que separa su
   * progreso, sus ejercicios y su ritmo de los de cualquier otro grupo. Se
   * intenta con el código del propio formulario de alta; si falla (código
   * mal escrito, o la conexión no llegó a tiempo para comprobarlo), se
   * reintenta con el mismo diálogo que usaría cualquiera después. No es
   * bloqueante: cancelar aquí no rompe la cuenta, solo la deja sin curso
   * hasta la próxima vez.
   */
  if (opts.nuevoEstudiante) {
    let unido = false;
    if (datos && datos.codigoCurso) {
      const codigo = String(datos.codigoCurso).trim().toUpperCase();
      await traerCursoSiHaceFalta(codigo);
      const directo = await window.pc.courses.joinByCode(codigo);
      if (directo.ok) { toast('Te uniste a «' + directo.curso.nombre + '»', { type: 'ok' }); unido = true; }
      else toast(directo.error || 'El código no funcionó.', { type: 'warn', timeout: 6000 });
    }
    if (!unido) unido = !!(await unirseACurso({ motivo: 'Escribe el código de tu clase para empezar.' }));
    if (unido && hooks.onUserUpdated) hooks.onUserUpdated(usuario);
  }

  return usuario;
}

/* ------------------------------------------------------------ pantallas */

function pantallaLogin() {
  const form = el('form', { class: 'form-grid', autocomplete: 'on', novalidate: true });
  form.append(
    campo('correo', 'Correo electrónico', {
      type: 'email', icon: 'mail', value: correoSugerido,
      placeholder: 'tucorreo@colegio.edu.co', autocomplete: 'username'
    }),
    campo('password', 'Contraseña', { type: 'password', icon: 'lock', autocomplete: 'current-password' }),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn primary', type: 'submit' }, 'Entrar')),
    el('div', { style: { textAlign: 'center' } },
      el('button', {
        class: 'auth-link', type: 'button',
        style: { color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'underline' },
        onclick: () => render('recuperar')
      }, '¿Olvidaste tu contraseña?'))
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');
    const datos = valores(form);
    const errores = validarBasico(datos, { password: false });
    if (!datos.password) errores.password = 'Escribe tu contraseña.';
    if (Object.keys(errores).length) { pintarErrores(form, errores); return; }

    ocupado(boton, true, 'Comprobando…');
    try {
      const user = await fb.entrar(datos.correo, datos.password);
      await establecerSesion(user, null, {});
    } catch (err) {
      ocupado(boton, false);
      pintarErrores(form, {}, fb.traducirError(err));
      const pass = form.querySelector('input[name="password"]');
      if (pass) { pass.value = ''; pass.focus(); }
    }
  });

  return {
    titulo: 'Iniciar sesión',
    sub: 'Entra con el correo con el que te registraste.',
    form,
    extra: el('div', { class: 'auth-switch' },
      '¿Aún no tienes cuenta? ',
      el('button', { type: 'button', onclick: () => render('registro') }, 'Crear una cuenta')),
    pie: 'Después del primer inicio de sesión, la aplicación funciona sin conexión.'
  };
}

/* Etiqueta del campo "código de curso" según el rol elegido en el alta. */
const ETIQUETAS_CODIGO_CURSO = {
  estudiante: 'Código de tu clase',
  profesor: 'Código del curso al que quieres enseñar (déjalo vacío si eres el primer profesor de esta instalación)'
};

function pantallaRegistro() {
  const form = el('form', { class: 'form-grid', autocomplete: 'off', novalidate: true });

  const radioEstudiante = el('input', { type: 'radio', name: '_rolAlta', value: 'estudiante', checked: true });
  const radioProfesor = el('input', { type: 'radio', name: '_rolAlta', value: 'profesor' });
  const campoCodigo = campo('codigoCurso', ETIQUETAS_CODIGO_CURSO.estudiante, { placeholder: 'Te lo da tu profesor', maxlength: 10 });

  function actualizarEtiquetaCodigo() {
    const label = campoCodigo.querySelector('label');
    if (label) label.textContent = ETIQUETAS_CODIGO_CURSO[radioProfesor.checked ? 'profesor' : 'estudiante'];
  }
  radioEstudiante.addEventListener('change', actualizarEtiquetaCodigo);
  radioProfesor.addEventListener('change', actualizarEtiquetaCodigo);

  form.append(
    el('div', { class: 'form-field' },
      el('label', null, '¿Qué quieres hacer?'),
      el('div', { style: { display: 'flex', gap: '16px', marginBottom: '6px' } },
        el('label', { class: 'checkline' }, radioEstudiante, 'Quiero ser estudiante'),
        el('label', { class: 'checkline' }, radioProfesor, 'Quiero ser profesor'))),
    el('div', { class: 'form-row' },
      campo('nombre', 'Nombre', { placeholder: 'Juan' }),
      campo('apellido', 'Apellido', { placeholder: 'Pérez' })),
    campo('correo', 'Correo electrónico', { type: 'email', icon: 'mail', placeholder: 'juan.perez@colegio.edu.co', autocomplete: 'username' }),
    el('div', { class: 'form-row' },
      campo('grado', 'Grado', { placeholder: '10', maxlength: 20 }),
      campo('grupo', 'Grupo', { placeholder: 'A', maxlength: 20 })),
    campoCodigo,
    el('div', { class: 'form-row' },
      campo('password', 'Contraseña', { type: 'password', icon: 'lock', meter: true, autocomplete: 'new-password' }),
      campo('password2', 'Repetir contraseña', { type: 'password', icon: 'lock', autocomplete: 'new-password' })),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn primary', type: 'submit' }, 'Crear mi cuenta'))
  );
  conectarMedidor(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');
    const datos = valores(form);
    const rol = radioProfesor.checked ? 'profesor' : 'estudiante';
    const errores = validarBasico(datos, { nombre: true, password: true });
    // Para "profesor" también se pide el código, pero solo hace falta de
    // verdad si más adelante el bootstrap falla -eso no se sabe hasta el
    // submit-: no se bloquea aquí, lo decide establecerSesion con un mensaje
    // claro si hiciera falta y no estuviera.
    if (!datos.codigoCurso && rol === 'estudiante') errores.codigoCurso = 'Pídele a tu profesor el código de tu clase.';
    if (Object.keys(errores).length) { pintarErrores(form, errores); return; }

    ocupado(boton, true, 'Creando cuenta…');
    try {
      const user = await fb.registrar(datos.correo, datos.password, datos.nombre + ' ' + datos.apellido);
      await establecerSesion(user, datos, { nuevoEstudiante: rol === 'estudiante', nuevoProfesor: rol === 'profesor', primeraVez: true });
    } catch (err) {
      ocupado(boton, false);
      pintarErrores(form, {}, fb.traducirError(err));
    }
  });

  return {
    titulo: 'Crear una cuenta',
    sub: 'Elige qué vas a hacer en la aplicación; podrás cambiarlo más adelante si hace falta.',
    form,
    extra: el('div', { class: 'auth-switch' },
      '¿Ya tienes cuenta? ',
      el('button', { type: 'button', onclick: () => render('login') }, 'Iniciar sesión')),
    pie: 'Solo el primer profesor de una instalación se autoriza solo; los demás necesitan que ' +
      'el dueño de un curso apruebe su solicitud.'
  };
}

function pantallaRecuperar() {
  const form = el('form', { class: 'form-grid', novalidate: true });
  form.append(
    campo('correo', 'Correo electrónico', { type: 'email', icon: 'mail', value: correoSugerido }),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn primary', type: 'submit' }, 'Enviarme el enlace'))
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');
    const datos = valores(form);
    const errores = validarBasico(datos, {});
    if (Object.keys(errores).length) { pintarErrores(form, errores); return; }
    ocupado(boton, true, 'Enviando…');
    try {
      await fb.recuperarPassword(datos.correo);
      ocupado(boton, false);
      limpiarErrores(form);
      form.prepend(el('div', { class: 'form-note' },
        'Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.'));
    } catch (err) {
      ocupado(boton, false);
      pintarErrores(form, {}, fb.traducirError(err));
    }
  });

  return {
    titulo: 'Recuperar contraseña',
    sub: 'Te enviaremos un enlace a tu correo.',
    form,
    extra: el('div', { class: 'auth-switch' },
      el('button', { type: 'button', onclick: () => render('login') }, 'Volver al inicio de sesión')),
    pie: 'Necesitas conexión a Internet para este paso.'
  };
}

/*
 * No se puede entrar. Lo primero que se lee es lo que le sirve a quien esta
 * delante -«no hay conexion», «hay que configurar el servicio»- y los detalles
 * tecnicos quedan plegados, para el profesor: un estudiante no tiene por que
 * leer nombres de servicios ni rutas de consola.
 */
function pantallaProblema() {
  const c = fb.snapshot();
  const sinRed = !navigator.onLine;

  const detalles = el('details', { class: 'detalles-tecnicos' },
    el('summary', null, 'Detalles para el profesor'),
    el('div', { class: 'welcome-steps' },
      [
        ['Crea la base de datos', 'Firebase Console → Build → Realtime Database → Create Database.'],
        ['Activa el acceso por correo', 'Authentication → Sign-in method → Email/Password → Enable.'],
        ['Publica las reglas', 'Copia firebase/database.rules.json en Realtime Database → Rules → Publish.'],
        ['Autoriza al profesor', 'roles/<UID> = teacher en Realtime Database.']
      ].map(([t, d], i) => el('div', { class: 'wstep' },
        el('div', { class: 'num' }, String(i + 1)),
        el('div', null, el('b', null, t), el('span', null, d))))),
    el('div', { class: 'form-note' },
      'Proyecto: ' + (c.proyecto || 'sin configurar') +
      (c.error ? '  ·  ' + c.error : '')));

  const cuerpo = el('div', { class: 'form-grid' },
    el('div', { class: 'form-note ' + (sinRed ? 'warn' : 'err') }, sinRed
      ? 'No hay conexión a Internet. Para entrar la primera vez en este equipo hace falta conexión; ' +
        'después podrás trabajar sin ella.'
      : 'El servicio de cuentas no está disponible todavía. Avisa a tu profesor.'),
    el('div', { class: 'form-actions' },
      el('button', {
        class: 'btn primary', type: 'button',
        onclick: () => { location.reload(); }
      }, 'Reintentar')),
    detalles
  );

  return {
    titulo: 'No se puede entrar todavía',
    sub: sinRed ? 'Comprueba la conexión y vuelve a intentarlo.' : 'Falta un paso de configuración.',
    form: cuerpo,
    pie: 'Tu trabajo anterior sigue guardado en este equipo.'
  };
}

/* ---------------------------------------------------------------- render */

function bannerConexion() {
  const c = fb.snapshot();
  if (!c.disponible) return null;
  if (!navigator.onLine) {
    return el('div', { class: 'form-note warn' },
      'Sin conexión a Internet. Para entrar por primera vez en este equipo hace falta Internet; ' +
      'si ya entraste antes, la aplicación se abrirá sola.');
  }
  return null;
}

function render(nuevoModo) {
  modo = nuevoModo || modo;
  const card = $('#auth-card');
  const pie = $('#auth-foot');
  clear(card);

  const pantalla = modo === 'registro' ? pantallaRegistro()
    : modo === 'recuperar' ? pantallaRecuperar()
      : modo === 'problema' ? pantallaProblema()
        : pantallaLogin();

  const aviso = bannerConexion();
  card.append(
    el('h2', null, pantalla.titulo),
    el('p', { class: 'sub' }, pantalla.sub),
    ...[aviso, pantalla.form, pantalla.extra].filter(Boolean)
  );
  pie.textContent = pantalla.pie || '';
  $('#auth-tagline').textContent = 'Aprende Python sin conexión';

  const primero = card.querySelector('input');
  if (primero) setTimeout(() => primero.focus(), 60);
}

export function show(nuevoModo) {
  $('#auth-screen').hidden = false;
  document.body.classList.add('sin-sesion');
  render(nuevoModo);
}

export function hide() {
  $('#auth-screen').hidden = true;
  document.body.classList.remove('sin-sesion');
}

/* --------------------------------------------------------------- sesion */

export function current() { return usuario; }
export function esProfesor() { return !!usuario && usuario.rol === 'profesor'; }

export async function logout() {
  const ok = await confirmDialog('¿Cerrar la sesión de ' + usuario.nombreCompleto + '?', {
    title: 'Cerrar sesión', okLabel: 'Cerrar sesión'
  });
  if (!ok) return false;
  await forceLogout();
  return true;
}

export async function forceLogout() {
  if (usuario) correoSugerido = usuario.correo;
  try { await fb.salir(); } catch (err) { /* aunque falle, se cierra en local */ }
  await window.pc.session.clear();
  usuario = null;
  if (hooks.onLogout) await hooks.onLogout();
  show('login');
}

/* -------------------------------------------------------- menu y perfil */

export async function perfilModal() {
  const form = el('form', { class: 'form-grid', novalidate: true });
  form.append(
    el('div', { class: 'form-row' },
      campo('nombre', 'Nombre', { value: usuario.nombre }),
      campo('apellido', 'Apellido', { value: usuario.apellido })),
    el('div', { class: 'form-field' },
      el('label', null, 'Correo electrónico'),
      el('input', { class: 'input', value: usuario.correo, disabled: true }),
      el('small', { style: { fontSize: '10.5px', color: 'var(--text-faint)' } },
        'El correo identifica tu cuenta y no se cambia desde aquí.')),
    usuario.rol === 'estudiante'
      ? el('div', { class: 'form-row' },
        campo('grado', 'Grado', { value: usuario.grado }),
        campo('grupo', 'Grupo', { value: usuario.grupo }))
      : el('div', { class: 'form-note' }, 'Tu cuenta es de profesor: administras el curso.')
  );

  const res = await modal({
    title: 'Mi perfil', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const datos = valores(form);
  const out = await window.pc.users.updateMe({
    firstName: datos.nombre, lastName: datos.apellido,
    grade: datos.grado, groupName: datos.grupo
  });
  if (!out.ok) { toast(out.error || 'No se pudo guardar', { type: 'err' }); return; }
  usuario = out.usuario;
  try { await fb.actualizarNombre((datos.nombre + ' ' + datos.apellido).trim()); } catch (err) { /* opcional */ }
  if (hooks.onUserUpdated) hooks.onUserUpdated(usuario);
  toast('Perfil actualizado', { type: 'ok' });
}

export async function passwordModal() {
  const form = el('form', { class: 'form-grid', novalidate: true });
  form.append(
    campo('actual', 'Contraseña actual', { type: 'password', icon: 'lock' }),
    campo('password', 'Contraseña nueva', { type: 'password', icon: 'lock', meter: true }),
    campo('password2', 'Repetir contraseña nueva', { type: 'password', icon: 'lock' }),
    el('div', { class: 'form-note' }, 'Cambiar la contraseña requiere conexión a Internet.')
  );
  conectarMedidor(form);

  const res = await modal({
    title: 'Cambiar contraseña', body: form,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Cambiar', value: 'ok', primary: true }]
  });
  if (res !== 'ok') return;

  const datos = valores(form);
  if (datos.password !== datos.password2) { toast('Las contraseñas no coinciden.', { type: 'err' }); return; }
  if (String(datos.password).length < 6) { toast('Mínimo 6 caracteres.', { type: 'err' }); return; }
  try {
    await fb.cambiarPassword(datos.actual, datos.password);
    toast('Contraseña actualizada', { type: 'ok' });
  } catch (err) {
    toast(fb.traducirError(err), { title: 'Contraseña', type: 'err', timeout: 8000 });
  }
}

/* ----------------------------------------------------------------- init */

/** Decide que mostrar al arrancar. Nunca deja la app en blanco. */
export async function init(appHooks) {
  hooks = appHooks || {};

  $('#auth-min').addEventListener('click', () => window.pc.win.minimize());
  $('#auth-max').addEventListener('click', () => window.pc.win.maximize());
  $('#auth-close').addEventListener('click', () => window.pc.win.close());

  conexion = await fb.init();
  fb.onEstado((s) => { conexion = s; });

  if (!conexion.disponible) {
    // Sin Firebase no hay identidad nueva, pero si ya habia sesion local la
    // aplicacion puede seguir trabajando sin conexion.
    const local = await window.pc.session.me();
    if (local) {
      usuario = local;
      hide();
      if (hooks.onLogin) await hooks.onLogin(usuario, { sinConexion: true });
      return { modo: 'sesion', usuario };
    }
    show('problema');
    return { modo: 'problema', usuario: null };
  }

  // ¿Hay sesion guardada de una vez anterior?
  const user = await fb.esperarPrimerEstado(7000);
  if (user) {
    try {
      await establecerSesion(user, null, { restaurada: true });
      return { modo: 'sesion', usuario };
    } catch (err) {
      console.warn('[auth] no se pudo restaurar la sesión:', err);
    }
  }

  /*
   * Siempre se muestra el acceso. La aplicacion no comprueba ni decide si el
   * proyecto "ya tiene profesor": el rol de profesor se crea en la consola de
   * Firebase (roles/<uid> = teacher) o lo asigna otro profesor desde la pantalla
   * de Estudiantes y cuentas. Aqui solo se inicia sesion.
   */
  show('login');
  return { modo: 'login', usuario: null };
}

export function estadoConexion() { return fb.snapshot(); }
