/*
 * Panel de configuracion. Escribe en <userData>/settings.json a traves del
 * proceso principal, de modo que las preferencias sobreviven a las
 * actualizaciones de la aplicacion.
 */

import { $, el, clear, toast, confirmDialog, modal } from './ui.js';
import { ajustesFotos } from './photo.js';

let bodyEl = null;
let settings = {};
let onChange = null;

export function init(initial, changeHandler) {
  bodyEl = $('#settings-body');
  settings = initial;
  onChange = changeHandler;
  $('#cfg-reset').addEventListener('click', async () => {
    const ok = await confirmDialog('¿Restablecer toda la configuración a los valores de fábrica?', {
      title: 'Restablecer', okLabel: 'Restablecer', danger: true
    });
    if (!ok) return;
    settings = await window.pc.config.reset();
    render();
    if (onChange) onChange(settings, { rebuild: true });
    toast('Configuración restablecida', { type: 'ok' });
  });
  render();
}

export function update(next) { settings = next; render(); }

async function set(key, value) {
  settings = await window.pc.config.set({ [key]: value });
  if (onChange) onChange(settings, { key });
}

/* ------------------------------------------------------------- widgets */

function group(title, ...children) {
  return el('div', { class: 'settings-group' },
    el('div', { class: 'side-section-title' }, title),
    ...children
  );
}

function toggle(key, label, help) {
  const sw = el('div', {
    class: 'switch' + (settings[key] ? ' on' : ''),
    role: 'switch',
    onclick: async () => {
      const next = !settings[key];
      sw.classList.toggle('on', next);
      await set(key, next);
    }
  });
  return el('div', { class: 'field' },
    el('div', { class: 'f-label' }, el('b', null, label), help ? el('small', null, help) : null),
    el('div', { class: 'f-control', style: { width: 'auto' } }, sw)
  );
}

function select(key, label, options, help, parse) {
  const sel = el('select', {
    class: 'select',
    onchange: async () => set(key, parse ? parse(sel.value) : sel.value)
  });
  for (const [value, text] of options) {
    sel.append(el('option', { value, selected: String(settings[key]) === String(value) }, text));
  }
  return el('div', { class: 'field' },
    el('div', { class: 'f-label' }, el('b', null, label), help ? el('small', null, help) : null),
    el('div', { class: 'f-control' }, sel)
  );
}

function number(key, label, min, max, help) {
  const input = el('input', {
    class: 'input', type: 'number', min, max, value: settings[key],
    onchange: async () => {
      let v = parseInt(input.value, 10);
      if (isNaN(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      input.value = v;
      await set(key, v);
    }
  });
  return el('div', { class: 'field' },
    el('div', { class: 'f-label' }, el('b', null, label), help ? el('small', null, help) : null),
    el('div', { class: 'f-control' }, input)
  );
}


/* ------------------------------------- copias de seguridad y actualizaciones */

function fechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('es', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function tamano(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/**
 * Copias de seguridad de la base de datos (fase 6).
 *
 * Se guardan como maximo las cinco ultimas, y ademas de las manuales el sistema
 * hace una automatica antes de cada migracion de esquema y antes de importar.
 */
async function dialogoCopias() {
  const cuerpo = el('div');

  const pintar = async () => {
    const { carpeta, copias } = await window.pc.backups.list();
    clear(cuerpo);
    cuerpo.append(el('p', null,
      'Se conservan las cinco copias más recientes. Además de las que hagas aquí, ' +
      'Python Classroom copia la base de datos automáticamente antes de cambiar el esquema ' +
      'y antes de importar datos.'));
    cuerpo.append(el('div', { class: 'form-note' }, carpeta));

    if (!copias.length) {
      cuerpo.append(el('div', { class: 'empty-note' }, 'Todavía no hay ninguna copia.'));
    } else {
      const card = el('div', { class: 'card' });
      for (const c of copias) {
        card.append(el('div', { class: 'list-row' },
          el('div', { class: 'lr-main' },
            el('b', null, fechaCorta(c.createdAt)),
            el('span', null, c.name + '  ·  ' + tamano(c.sizeBytes))),
          el('button', {
            class: 'btn sm outline',
            onclick: async () => {
              const ok = await confirmDialog(
                'La base de datos actual se sustituirá por esta copia (' + fechaCorta(c.createdAt) + '). ' +
                'Antes se guarda una copia de lo que hay ahora, así que esto también se puede deshacer. ' +
                '¿Restaurar?',
                { title: 'Restaurar copia', okLabel: 'Restaurar', danger: true });
              if (!ok) return;
              const res = await window.pc.backups.restore(c.path);
              if (!res.ok) { toast(res.error || 'No se pudo restaurar', { type: 'err' }); return; }
              toast('Copia restaurada: ' + res.restaurada + '. Reinicia la aplicación.',
                { type: 'ok', timeout: 8000 });
              await pintar();
            }
          }, 'Restaurar')));
      }
      cuerpo.append(card);
    }
  };

  await pintar();

  const acciones = el('div', { class: 'ex-actions' },
    el('button', {
      class: 'btn sm primary',
      onclick: async () => {
        const res = await window.pc.backups.create();
        if (!res.ok) { toast(res.error || 'No se pudo copiar', { type: 'err' }); return; }
        toast('Copia creada (' + tamano(res.sizeBytes) + ')', { type: 'ok' });
        await pintar();
      }
    }, 'Hacer una copia ahora'),
    el('button', { class: 'btn sm outline', onclick: () => window.pc.backups.reveal() }, 'Abrir la carpeta'));

  await modal({
    title: 'Copias de seguridad',
    wide: true,
    body: el('div', null, cuerpo, acciones),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

/** Comprobacion manual de actualizaciones (fase 6). */
async function dialogoActualizaciones() {
  const cfg = await window.pc.updates.config();
  const estado = el('div', { class: 'form-note' }, 'Comprobando…');

  const repo = el('input', { class: 'input', value: cfg.repo, spellcheck: 'false' });
  const alIniciar = el('input', { type: 'checkbox', checked: cfg.comprobarAlIniciar });

  const cuerpo = el('div', null,
    estado,
    el('div', { class: 'form-field' },
      el('label', null, 'Repositorio de publicaciones (GitHub)'), repo),
    el('label', { class: 'checkline' }, alIniciar, 'Comprobar al iniciar la aplicación'),
    el('div', { class: 'form-note' },
      'Python Classroom nunca instala nada por su cuenta: si hay una versión nueva te lo dice y ' +
      'abre la página de descarga. Actualizar no borra la base de datos, las preferencias, ' +
      'los proyectos ni el runtime de Python, porque viven fuera de la carpeta de instalación.'));

  const p = modal({
    title: 'Actualizaciones',
    body: cuerpo,
    buttons: [
      { label: 'Cerrar', value: null },
      { label: 'Comprobar ahora', value: 'check', primary: true }
    ]
  });

  window.pc.updates.check().then((res) => {
    clear(estado);
    estado.textContent = 'Versión instalada ' + res.actual + '. ' + res.mensaje;
    estado.className = 'form-note' + (res.hayNueva ? ' warn' : '');
    if (res.hayNueva && res.url) {
      estado.append(document.createTextNode(' '));
      estado.append(el('button', {
        class: 'btn sm outline',
        onclick: () => window.pc.app.openExternal(res.url)
      }, 'Abrir la página de descarga'));
    }
  }).catch(() => { estado.textContent = 'No se pudo comprobar.'; });

  const res = await p;
  await window.pc.updates.setConfig({ repo: repo.value, comprobarAlIniciar: alIniciar.checked });
  if (res === 'check') {
    const out = await window.pc.updates.check();
    toast(out.mensaje, { type: out.hayNueva ? 'warn' : 'ok', timeout: 7000 });
    if (out.hayNueva && out.url) {
      const abrir = await confirmDialog('¿Abrir la página de descarga de la versión ' + out.disponible + '?',
        { title: 'Actualización disponible', okLabel: 'Abrir' });
      if (abrir) await window.pc.app.openExternal(out.url);
    }
  }
}

/* -------------------------------------------------------------- pintado */

function render() {
  if (!bodyEl) return;
  clear(bodyEl);

  bodyEl.append(
    group('Apariencia',
      select('theme', 'Tema', [['dark', 'Oscuro'], ['light', 'Claro']]),
      number('fontSize', 'Tamaño del editor', 9, 34, 'Píxeles'),
      number('consoleFontSize', 'Tamaño de consola', 9, 26, 'Píxeles')
    ),

    group('Editor',
      select('tabSize', 'Tabulación', [['2', '2 espacios'], ['4', '4 espacios'], ['8', '8 espacios']],
        'Python recomienda 4', (v) => parseInt(v, 10)),
      toggle('wordWrap', 'Ajuste de línea', 'Parte las líneas largas'),
      toggle('lineNumbers', 'Números de línea'),
      toggle('highlightActiveLine', 'Resaltar la línea actual'),
      toggle('bracketPairs', 'Cerrar paréntesis y comillas', 'Inserta el carácter de cierre automáticamente')
    ),

    group('Autocompletado',
      toggle('autocomplete', 'Activar autocompletado'),
      toggle('autocompleteOnType', 'Sugerir mientras escribo', 'Si lo desactivas, usa Ctrl+Espacio')
    ),

    group('Guardado',
      toggle('autoSave', 'Autoguardado', 'Guarda solo los archivos que ya tienen ruta'),
      select('autoSaveDelay', 'Retardo del autoguardado',
        [['600', '0,6 s'], ['1200', '1,2 s'], ['3000', '3 s']], null, (v) => parseInt(v, 10))
    ),

    group('Ejecución',
      select('runTimeoutMs', 'Tiempo máximo',
        [['5000', '5 segundos'], ['15000', '15 segundos'], ['30000', '30 segundos'],
         ['60000', '1 minuto'], ['300000', '5 minutos'], ['0', 'Sin límite']],
        'Protege contra bucles infinitos', (v) => parseInt(v, 10)),
      toggle('clearConsoleOnRun', 'Limpiar la consola al ejecutar')
    ),

    group('Seguridad del proyecto',
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Autorización de la cuenta'),
          el('small', { id: 'security-status' }, 'Comprobando autorización…')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', {
            class: 'btn sm outline',
            onclick: async () => {
              const user = await window.pc.session.me();
              if (!user) return;
              await window.pc.app.copy(user.uid);
              toast('UID copiado', { type: 'ok' });
            }
          }, 'Copiar UID'))
      ),
      el('div', { class: 'form-note' },
        'El rol de profesor se autoriza fuera de la aplicación. Borrar los datos de este equipo no crea profesores.'),
      el('div', { class: 'form-note warn' },
        'Para autorizar a un profesor, hazlo desde otra cuenta de profesor en «Estudiantes y cuentas», o en la consola de administración del servicio.')
    ),

    group('Datos',
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Exportar mis datos'),
          el('small', null, 'Configuración y sesión en un archivo JSON')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', {
            class: 'btn sm outline',
            onclick: async () => {
              const res = await window.pc.app.exportData();
              if (res.ok) toast('Datos exportados en ' + res.path, { type: 'ok' });
            }
          }, 'Exportar'))
      ),
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Carpeta de datos'),
          el('small', { id: 'cfg-userdata' }, 'cargando…')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', {
            class: 'btn sm outline',
            onclick: async () => {
              const paths = await window.pc.config.paths();
              window.pc.files.reveal(paths.userData).catch(() => {});
            }
          }, 'Abrir'))
      ),
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Reiniciar datos locales'),
          el('small', null, 'Borra cuentas guardadas en este PC, proyectos, sesiones y la base local')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', {
            class: 'btn sm danger',
            onclick: async () => {
              const ok = await confirmDialog(
                'Se borrarán los datos guardados en este equipo y la aplicación se reiniciará. Las cuentas de acceso no se borran.',
                { title: 'Reiniciar datos locales', okLabel: 'Borrar y reiniciar', danger: true });
              if (!ok) return;
              await window.pc.app.resetLocalData();
            }
          }, 'Borrar datos locales'))
      )
    ),

    group('Fotos de perfil',
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Fotos de los estudiantes'),
          el('small', { id: 'cfg-fotos' }, 'comprobando…')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', { class: 'btn sm outline', onclick: () => ajustesFotos() }, 'Configurar'))
      )
    ),

    group('Copias y actualizaciones',
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Copias de seguridad'),
          el('small', null, 'Copiar y restaurar la base de datos. Se guardan las cinco últimas')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', { class: 'btn sm outline', onclick: () => dialogoCopias() }, 'Gestionar'))
      ),
      el('div', { class: 'field' },
        el('div', { class: 'f-label' },
          el('b', null, 'Actualizaciones'),
          el('small', null, 'Comprobar si hay una versión nueva publicada')),
        el('div', { class: 'f-control', style: { width: 'auto' } },
          el('button', { class: 'btn sm outline', onclick: () => dialogoActualizaciones() }, 'Comprobar'))
      )
    ),

    group('Acerca de', el('dl', { class: 'info-grid', id: 'about-grid' }))
  );

  window.pc.photo.config().then((c) => {
    const node = $('#cfg-fotos');
    if (!node) return;
    node.textContent = c.listo
      ? 'Activadas · máximo ' + c.maxKb + ' KB por foto'
      : 'Sin configurar: los estudiantes verán sus iniciales';
  }).catch(() => {});

  window.pc.config.paths().then((p) => {
    const node = $('#cfg-userdata');
    if (node) node.textContent = p.userData;
  }).catch(() => {});

  window.pc.session.me().then((user) => {
    const node = $('#security-status');
    if (!node) return;
    node.textContent = user
      ? (user.rol === 'profesor' ? 'Profesor autorizado' : 'Estudiante')
      : 'Sin sesión iniciada';
  }).catch(() => {});

  window.pc.app.info().then((info) => {
    const grid = $('#about-grid');
    if (!grid) return;
    const add = (k, v) => { grid.append(el('dt', null, k)); grid.append(el('dd', null, String(v))); };
    add('Versión', info.version);
    add('Electron', info.electron);
    add('Chromium', info.chrome);
    add('Node', info.node);
    add('Sistema', info.platform + ' ' + info.arch);
    add('Memoria', info.memoryGb + ' GB');
    add('Instalación', info.packaged ? 'empaquetada' : 'desarrollo');
  }).catch(() => {});

  // Arranque en frio y estado del runtime: sirven para el informe de la fase 6.
  Promise.all([window.pc.app.startup(), window.pc.runtime.prepareState()]).then(([arranque, rt]) => {
    const grid = $('#about-grid');
    if (!grid) return;
    const add = (k, v) => { grid.append(el('dt', null, k)); grid.append(el('dd', null, String(v))); };
    if (arranque && arranque.listoEnMs != null) add('Arranque en frío', arranque.listoEnMs + ' ms');
    if (rt) {
      add('Runtime escribible', rt.instalacionEscribible ? 'sí (carpeta de instalación)'
        : rt.hayCopiaUsuario ? 'sí (copia del usuario)' : 'pendiente de copiar');
    }
  }).catch(() => {});
}
