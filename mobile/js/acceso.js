/*
 * Pantalla de acceso de la app móvil.
 *
 * Tres modos: entrar, crear cuenta de ESTUDIANTE y recuperar la contraseña.
 *
 * Aquí no hay -ni puede haber- forma de crear un profesor. El rol de profesor se
 * autoriza en la consola de Firebase (roles/<uid> = teacher) o lo asigna otro
 * profesor desde la aplicación de escritorio. Las Security Rules lo imponen: un
 * alta solo puede escribir 'student' en su propio nodo.
 */

import { el, clear, toast } from '../../src/js/ui.js';

function campo(nombre, etiqueta, opciones) {
  const o = opciones || {};
  const input = el('input', {
    class: 'input',
    name: nombre,
    type: o.type || 'text',
    placeholder: o.placeholder || '',
    autocomplete: o.autocomplete || 'off',
    autocapitalize: o.autocapitalize || 'off',
    spellcheck: 'false',
    inputmode: o.inputmode || undefined
  });
  return {
    input: input,
    nodo: el('div', { class: 'form-field', dataset: { field: nombre } },
      el('label', null, etiqueta), input, el('div', { class: 'err' }))
  };
}

function pintarErrores(form, errores) {
  for (const f of form.querySelectorAll('.form-field')) {
    f.classList.remove('error');
    const e = f.querySelector('.err');
    if (e) e.textContent = '';
  }
  for (const [clave, texto] of Object.entries(errores || {})) {
    const f = form.querySelector('[data-field="' + clave + '"]');
    if (f) { f.classList.add('error'); f.querySelector('.err').textContent = texto; }
    else toast(texto, { type: 'err' });
  }
}

function validarCorreo(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(correo || '').trim());
}

function ocupado(boton, si, texto) {
  boton.disabled = si;
  boton.textContent = si ? (texto || 'Un momento…') : boton.dataset.original;
}

/** Monta la pantalla de acceso en `host`. */
export function pantallaAcceso(host, hooks) {
  let modo = 'login';

  function render() {
    clear(host);

    const titulo = modo === 'registro' ? 'Crear cuenta de estudiante'
      : modo === 'recuperar' ? 'Recuperar la contraseña'
        : 'Entrar';
    const sub = modo === 'registro'
      ? 'Con tu correo del colegio. Tu profesor te verá en la lista al entrar.'
      : modo === 'recuperar'
        ? 'Te llega un correo con el enlace para cambiarla.'
        : 'Con la misma cuenta que usas en el computador del colegio.';

    host.append(el('h2', null, titulo), el('p', { class: 'sub' }, sub));

    if (hooks.mensaje) {
      host.append(el('div', { class: 'm-aviso info' }, el('div', null, hooks.mensaje)));
      hooks.mensaje = null;
    }
    if (!navigator.onLine) {
      host.append(el('div', { class: 'm-aviso' },
        el('div', null, 'Sin conexión. Para entrar por primera vez en este teléfono hace falta internet: ' +
          'Firebase no puede comprobar una contraseña sin red.')));
    }

    const form = el('form', { class: 'form-grid', novalidate: true });
    const correo = campo('correo', 'Correo', {
      type: 'email', autocomplete: 'username', inputmode: 'email',
      placeholder: 'tucorreo@colegio.edu.co'
    });
    form.append(correo.nodo);

    let nombre = null;
    let apellido = null;
    let grado = null;
    let grupo = null;
    let password = null;
    let password2 = null;

    if (modo === 'registro') {
      nombre = campo('nombre', 'Nombre', { autocapitalize: 'words' });
      apellido = campo('apellido', 'Apellido', { autocapitalize: 'words' });
      grado = campo('grado', 'Grado', { placeholder: '10', inputmode: 'numeric' });
      grupo = campo('grupo', 'Grupo', { placeholder: 'B', autocapitalize: 'characters' });
      form.append(nombre.nodo, apellido.nodo, grado.nodo, grupo.nodo);
    }

    if (modo !== 'recuperar') {
      password = campo('password', 'Contraseña', {
        type: 'password',
        autocomplete: modo === 'registro' ? 'new-password' : 'current-password'
      });
      form.append(password.nodo);
    }
    if (modo === 'registro') {
      password2 = campo('password2', 'Repite la contraseña', { type: 'password', autocomplete: 'new-password' });
      form.append(password2.nodo);
    }

    const boton = el('button', { class: 'btn primary', type: 'submit' },
      modo === 'registro' ? 'Crear mi cuenta' : modo === 'recuperar' ? 'Enviar el correo' : 'Entrar');
    boton.dataset.original = boton.textContent;
    form.append(el('div', { class: 'form-actions' }, boton));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errores = {};
      if (!validarCorreo(correo.input.value)) errores.correo = 'El correo no tiene un formato válido.';
      if (modo === 'registro') {
        if (String(nombre.input.value).trim().length < 2) errores.nombre = 'Escribe tu nombre.';
        if (String(apellido.input.value).trim().length < 2) errores.apellido = 'Escribe tu apellido.';
      }
      if (modo !== 'recuperar' && String(password.input.value).length < 6) {
        errores.password = 'La contraseña debe tener al menos 6 caracteres.';
      }
      if (modo === 'registro' && password2.input.value !== password.input.value) {
        errores.password2 = 'Las contraseñas no coinciden.';
      }
      if (Object.keys(errores).length) { pintarErrores(form, errores); return; }
      pintarErrores(form, {});

      ocupado(boton, true, modo === 'registro' ? 'Creando…' : 'Comprobando…');
      try {
        if (modo === 'recuperar') {
          await hooks.fb.recuperar(correo.input.value);
          toast('Te enviamos un correo para cambiar la contraseña.', { type: 'ok', timeout: 6000 });
          modo = 'login';
          render();
          return;
        }

        if (modo === 'registro') {
          const user = await hooks.fb.registrar(correo.input.value, password.input.value,
            (nombre.input.value + ' ' + apellido.input.value).trim());
          await hooks.data.crearPerfilEstudiante(user.uid, {
            correo: String(correo.input.value).trim().toLowerCase(),
            nombre: String(nombre.input.value).trim(),
            apellido: String(apellido.input.value).trim(),
            grado: String(grado.input.value).trim(),
            grupo: String(grupo.input.value).trim()
          });
          await hooks.onEntrar(user);
          return;
        }

        const user = await hooks.fb.entrar(correo.input.value, password.input.value);
        await hooks.onEntrar(user);
      } catch (err) {
        ocupado(boton, false);
        const mensaje = hooks.fb.traducirError(err);
        pintarErrores(form, /contraseñ|Correo o/i.test(mensaje) ? { password: mensaje } : { correo: mensaje });
      }
    });

    host.append(form);

    const enlaces = el('div', { class: 'm-links' });
    if (modo === 'login') {
      enlaces.append(
        el('button', { type: 'button', onclick: () => { modo = 'registro'; render(); } }, 'Crear una cuenta de estudiante'),
        el('button', { type: 'button', onclick: () => { modo = 'recuperar'; render(); } }, '¿Olvidaste tu contraseña?'));
    } else {
      enlaces.append(el('button', { type: 'button', onclick: () => { modo = 'login'; render(); } }, 'Volver a entrar'));
    }
    host.append(enlaces);

    host.append(el('p', {
      style: { fontSize: '10.5px', color: 'var(--text-faint)', marginTop: '12px', textAlign: 'center', lineHeight: '1.5' }
    }, 'El rol de profesor se autoriza en Firebase; esta aplicación no lo asigna.'));
  }

  render();
}
