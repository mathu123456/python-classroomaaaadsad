/*
 * Pantallas de la app móvil.
 *
 * Cada función devuelve un nodo listo para colgar. Todas leen de la capa de
 * datos (js/data.js), que habla directamente con la Realtime Database, y todas
 * dicen la verdad cuando el dato viene de la copia guardada en el teléfono en
 * lugar de la red.
 */

import { el, icon, clear, toast } from '../../src/js/ui.js';
import * as editorMovil from './editor.js';
import * as py from './python.js';

/* ------------------------------------------------------------- formatos */

function fecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const hoy = new Date();
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoy.toDateString()) return 'hoy ' + hora;
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + hora;
}

function haceCuanto(iso) {
  if (!iso) return 'sin fecha';
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seg < 90) return 'hace ' + seg + ' s';
  const min = Math.round(seg / 60);
  if (min < 90) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 36) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' día(s)';
}

const ESTADOS = {
  draft: ['Borrador', ''],
  in_progress: ['En progreso', 'warn'],
  submitted: ['Entregado', 'accent'],
  under_review: ['En revisión', 'accent'],
  late: ['Entregado tarde', 'warn'],
  graded: ['Calificado', 'ok'],
  returned: ['Devuelto', 'warn'],
  abandoned: ['Abandonado', 'err']
};

function chipEstado(estado) {
  const [texto, tono] = ESTADOS[estado] || [estado || 'pendiente', ''];
  return el('span', { class: 'chip ' + tono }, texto);
}

function avisoCache(deCache, cuando) {
  if (!deCache) return null;
  return el('div', { class: 'm-aviso' },
    icon('alert', 14),
    el('div', null, 'Sin conexión: esto es la copia guardada en el teléfono' +
      (cuando ? ' (' + haceCuanto(cuando) + ')' : '') + '.'));
}

function vacio(texto) {
  return el('div', { class: 'm-vacio' }, texto);
}

/* =========================================================== ejercicios */

export async function ejercicios(ctx) {
  const [lista, mias, retos] = await Promise.all([
    ctx.data.ejercicios(),
    ctx.data.misEntregas(ctx.usuario.uid).catch(() => ({ items: [] })),
    ctx.data.retos().catch(() => ({ items: [] }))
  ]);

  const porEjercicio = new Map();
  for (const s of mias.items) {
    const previo = porEjercicio.get(s.exerciseId);
    if (!previo || Number(s.attemptNumber) > Number(previo.attemptNumber)) porEjercicio.set(s.exerciseId, s);
  }

  const cont = el('div', { class: 'm-seccion' });
  const aviso = avisoCache(lista.deCache, lista.en);
  if (aviso) cont.append(aviso);

  if (ctx.usuario.rol === 'profesor') {
    cont.append(el('div', { class: 'm-aviso info' },
      icon('info', 14),
      el('div', null, 'Entraste como profesor. Desde el teléfono puedes revisar el curso, ' +
        'pero calificar, crear ejercicios y conceder insignias se hace en la aplicación de escritorio.')));
  }

  const abiertos = lista.items.filter((e) => e.status !== 'closed');
  cont.append(el('div', { class: 'm-titulo' }, 'PARA RESOLVER',
    el('span', { class: 'count' }, String(abiertos.length))));

  if (!abiertos.length) {
    cont.append(vacio('Todavía no hay ejercicios publicados.'));
  } else {
    for (const ej of abiertos) {
      const s = porEjercicio.get(ej.id);
      const calificado = s && ['graded', 'returned'].indexOf(s.status) !== -1;
      cont.append(el('button', {
        class: 'm-card pulsable',
        onclick: () => (calificado ? ctx.abrirEntrega(Object.assign({ exerciseTitle: ej.title }, s)) : ctx.abrirEjercicio(ej))
      },
        el('h3', null, ej.title || 'Sin título'),
        el('div', { class: 'm-meta' },
          el('span', { class: 'chip' }, (Number(ej.xp) || 0) + ' XP'),
          el('span', { class: 'chip' }, 'nota máx. ' + (Number(ej.maxScore) || 5)),
          s ? chipEstado(s.status) : el('span', { class: 'chip' }, 'Pendiente'),
          ej.dueDate ? el('span', { class: 'chip warn' }, 'cierra ' + fecha(ej.dueDate)) : null),
        ej.description ? el('p', null, String(ej.description).slice(0, 140)) : null,
        calificado
          ? el('div', { class: 'm-nota' },
            el('b', null, (s.grade == null ? '—' : s.grade) + ' / ' + (s.maxScore || ej.maxScore || 5)),
            el('span', null, '+' + (s.xpEarned || 0) + ' XP'))
          : null));
    }
  }

  const retosVivos = retos.items.filter((r) => {
    const desde = !r.startDate || new Date(r.startDate).getTime() <= Date.now();
    const hasta = !r.endDate || new Date(r.endDate).getTime() >= Date.now();
    return desde && hasta;
  });
  if (retosVivos.length) {
    cont.append(el('div', { class: 'm-titulo' }, '🔥 RETOS',
      el('span', { class: 'count' }, String(retosVivos.length))));
    for (const r of retosVivos) {
      const ej = r.exerciseId ? lista.items.find((e) => e.id === r.exerciseId) : null;
      cont.append(el('button', {
        class: 'm-card pulsable',
        onclick: () => (ej ? ctx.abrirEjercicio(ej) : toast('Este reto todavía no tiene ejercicio asociado.', { type: 'warn' }))
      },
        el('h3', null, '🔥 ' + (r.title || 'Reto')),
        el('div', { class: 'm-meta' },
          el('span', { class: 'chip accent' }, '+' + (Number(r.xp) || 0) + ' XP'),
          r.reward ? el('span', { class: 'chip warn' }, String(r.reward)) : null,
          r.endDate ? el('span', { class: 'chip' }, 'hasta ' + fecha(r.endDate)) : null),
        r.description ? el('p', null, String(r.description).slice(0, 140)) : null));
    }
  }

  return cont;
}

/* ============================================================= resolver */

export async function resolver(ctx, ejercicio) {
  const cont = el('div', { class: 'm-seccion' });
  const mias = await ctx.data.misEntregas(ctx.usuario.uid).catch(() => ({ items: [] }));
  const previas = mias.items.filter((s) => s.exerciseId === ejercicio.id);
  const abierta = previas.find((s) => ['submitted', 'under_review', 'late'].indexOf(s.status) !== -1);

  /* --- enunciado --- */
  cont.append(el('div', { class: 'm-card' },
    el('h3', null, ejercicio.title || 'Ejercicio'),
    el('div', { class: 'm-meta' },
      el('span', { class: 'chip' }, (Number(ejercicio.xp) || 0) + ' XP'),
      el('span', { class: 'chip' }, 'nota máx. ' + (Number(ejercicio.maxScore) || 5)),
      ejercicio.difficulty ? el('span', { class: 'chip' }, ejercicio.difficulty) : null,
      previas.length ? el('span', { class: 'chip' }, previas.length + ' intento(s)') : null),
    ejercicio.description ? el('p', null, ejercicio.description) : null,
    ejercicio.instructions
      ? el('div', { class: 'enunciado', style: { marginTop: '6px' } }, ejercicio.instructions)
      : null));

  if (abierta) {
    cont.append(el('div', { class: 'm-aviso info' },
      icon('info', 14),
      el('div', null, 'Ya entregaste este ejercicio (' + fecha(abierta.submittedAt) +
        '). Puedes practicar aquí; si vuelves a entregar, será otro intento.')));
  }

  /* --- editor --- */
  const guardado = ctx.data.borrador(ejercicio.id);
  const inicial = guardado ? guardado.codigo
    : (previas.length ? String(previas[0].code || '') : String(ejercicio.starterCode || ''));

  const host = el('div', { class: 'm-editor-host' });
  cont.append(el('div', { class: 'm-titulo' }, 'TU CÓDIGO',
    guardado ? el('span', { class: 'count' }, 'borrador ' + haceCuanto(guardado.en)) : null));
  cont.append(host);

  const salida = el('div', { class: 'm-salida', hidden: true });
  const estadoPy = el('div', { style: { fontSize: '11px', color: 'var(--text-faint)' } },
    py.estaListo() ? 'Python listo' : 'Python se descarga la primera vez que ejecutes (unos 10 MB).');

  const editor = await editorMovil.crear(host, {
    valor: inicial,
    onCambio: (texto) => ctx.data.guardarBorrador(ejercicio.id, texto)
  });
  if (editor.esRespaldo) {
    cont.append(el('div', { class: 'm-aviso' }, icon('alert', 14),
      el('div', null, 'El editor con colores no cargó; se usa un editor simple.')));
  }

  const btnEjecutar = el('button', { class: 'btn primary' }, icon('play', 14), ' Ejecutar');
  const btnEntregar = el('button', { class: 'btn success' }, 'Entregar');

  btnEjecutar.addEventListener('click', async () => {
    btnEjecutar.disabled = true;
    const original = btnEjecutar.textContent;
    btnEjecutar.textContent = 'Ejecutando…';
    salida.hidden = false;
    salida.className = 'm-salida';
    salida.textContent = '';
    try {
      const res = await py.ejecutar(editor.valor(), {
        onProgreso: (t) => { estadoPy.textContent = t; salida.textContent = t; },
        onSalida: (t) => { salida.textContent = t; }
      });
      estadoPy.textContent = 'Python listo · última ejecución ' + res.ms + ' ms';
      if (!res.ok) {
        salida.className = 'm-salida error';
        salida.textContent = (res.salida || '') + '\n' + res.error;
      } else if (!res.salida) {
        salida.textContent = '(el programa no imprimió nada)';
      }
    } catch (err) {
      salida.className = 'm-salida error';
      salida.textContent = err && err.message ? err.message : String(err);
    } finally {
      btnEjecutar.disabled = false;
      btnEjecutar.textContent = original;
    }
  });

  btnEntregar.addEventListener('click', async () => {
    const codigo = editor.valor();
    if (!String(codigo).trim()) { toast('Escribe algo antes de entregar.', { type: 'warn' }); return; }
    const ok = await ctx.confirmar(
      'Vas a entregar «' + (ejercicio.title || 'este ejercicio') + '». Tu profesor lo revisará y pondrá la nota.',
      { title: 'Entregar', okLabel: 'Entregar' });
    if (!ok) return;

    btnEntregar.disabled = true;
    btnEntregar.textContent = 'Enviando…';
    try {
      await ctx.data.entregar(ctx.usuario.uid, ejercicio, codigo, mias.items);
      ctx.data.olvidarBorrador(ejercicio.id);
      toast('Entregado. La nota y el XP los pone tu profesor.', { type: 'ok', timeout: 6000 });
      ctx.irA('entregas');
    } catch (err) {
      btnEntregar.disabled = false;
      btnEntregar.textContent = 'Entregar';
      const mensaje = ctx.fb.traducirError(err);
      toast('No se pudo entregar: ' + mensaje, { type: 'err', timeout: 8000 });
    }
  });

  cont.append(estadoPy);
  cont.append(salida);
  cont.append(el('div', { class: 'm-acciones' }, btnEjecutar, btnEntregar));
  return cont;
}

/* ============================================================= entregas */

export async function entregas(ctx) {
  const cont = el('div', { class: 'm-seccion' });
  const [mias, lista] = await Promise.all([
    ctx.data.misEntregas(ctx.usuario.uid),
    ctx.data.ejercicios().catch(() => ({ items: [] }))
  ]);
  const titulo = new Map(lista.items.map((e) => [e.id, e.title]));

  const aviso = avisoCache(mias.deCache, mias.en);
  if (aviso) cont.append(aviso);

  if (!mias.items.length) {
    cont.append(vacio('Todavía no has entregado nada. Abre un ejercicio y pulsa Entregar.'));
    return cont;
  }

  const calificadas = mias.items.filter((s) => s.grade != null);
  if (calificadas.length) {
    const suma = calificadas.reduce((a, s) => a + Number(s.grade), 0);
    cont.append(el('div', { class: 'm-card' },
      el('div', { class: 'm-meta' },
        el('span', { class: 'chip ok' }, calificadas.length + ' calificada(s)'),
        el('span', { class: 'chip' }, 'promedio ' + (suma / calificadas.length).toFixed(1)),
        el('span', { class: 'chip accent' }, calificadas.reduce((a, s) => a + (Number(s.xpEarned) || 0), 0) + ' XP'))));
  }

  for (const s of mias.items) {
    const calificado = s.grade != null;
    cont.append(el('button', {
      class: 'm-card pulsable',
      onclick: () => ctx.abrirEntrega(Object.assign({ exerciseTitle: titulo.get(s.exerciseId) }, s))
    },
      el('h3', null, titulo.get(s.exerciseId) || 'Ejercicio'),
      el('div', { class: 'm-meta' },
        chipEstado(s.status),
        el('span', { class: 'chip' }, 'intento ' + (s.attemptNumber || 1)),
        el('span', { class: 'chip' }, fecha(s.submittedAt || s.updatedAt)),
        s.origen === 'movil' ? el('span', { class: 'chip' }, 'desde el móvil') : null),
      calificado
        ? el('div', { class: 'm-nota' },
          el('b', null, s.grade + ' / ' + (s.maxScore || 5)),
          el('span', null, '+' + (s.xpEarned || 0) + ' XP'))
        : el('p', null, 'Pendiente de revisión.')));
  }

  return cont;
}

/* ============================================================ resultado */

export async function resultado(ctx, entrega) {
  const cont = el('div', { class: 'm-seccion' });
  const calificado = entrega.grade != null;

  cont.append(el('div', { class: 'm-card' },
    el('h3', null, entrega.exerciseTitle || 'Entrega'),
    el('div', { class: 'm-meta' },
      chipEstado(entrega.status),
      el('span', { class: 'chip' }, 'intento ' + (entrega.attemptNumber || 1)),
      el('span', { class: 'chip' }, fecha(entrega.submittedAt || entrega.updatedAt))),
    calificado
      ? el('div', { class: 'm-nota' },
        el('b', null, entrega.grade + ' / ' + (entrega.maxScore || 5)),
        el('span', null, '+' + (entrega.xpEarned || 0) + ' XP · ' + fecha(entrega.gradedAt)))
      : el('p', null, 'Tu profesor todavía no la ha calificado.')));

  if (entrega.teacherComment) {
    cont.append(el('div', { class: 'm-titulo' }, 'COMENTARIO DEL PROFESOR'));
    cont.append(el('div', { class: 'm-card' }, el('p', null, entrega.teacherComment)));
  }

  const linea = await ctx.data.comentarios(entrega.id);
  if (linea.length) {
    cont.append(el('div', { class: 'm-titulo' }, 'COMENTARIOS POR LÍNEA',
      el('span', { class: 'count' }, String(linea.length))));
    const card = el('div', { class: 'm-card' });
    for (const c of linea.sort((a, b) => (a.line || 0) - (b.line || 0))) {
      card.append(el('div', { style: { borderTop: '1px solid var(--border-soft)', paddingTop: '7px', marginTop: '7px' } },
        el('b', { style: { fontSize: '11.5px', color: 'var(--accent)' } }, 'Línea ' + (c.line || 1) + ' · ' + (c.type || '')),
        el('p', null, c.message || '')));
    }
    cont.append(card);
  }

  if (entrega.code) {
    cont.append(el('div', { class: 'm-titulo' }, 'TU CÓDIGO'));
    cont.append(el('pre', { class: 'm-salida' }, entrega.code));
  }

  cont.append(el('div', { class: 'm-acciones' },
    el('button', { class: 'btn outline', onclick: () => ctx.volver() }, 'Volver')));
  return cont;
}

/* ============================================================== ranking */

export async function ranking(ctx) {
  const cont = el('div', { class: 'm-seccion' });
  const [datos, limite] = await Promise.all([ctx.data.ranking(), ctx.data.limitePuestos()]);

  if (!datos.global.length) {
    cont.append(vacio('Todavía no hay ranking publicado. Tu profesor lo publica al calificar.'));
    return cont;
  }

  cont.append(el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } },
    datos.deCache
      ? 'Copia guardada en el teléfono · ' + haceCuanto(datos.descargadoEn)
      : 'Actualizado ' + haceCuanto(datos.actualizadoEn || datos.descargadoEn)));

  const visibles = limite > 0 && ctx.usuario.rol !== 'profesor'
    ? datos.global.slice(0, limite)
    : datos.global;
  const mia = datos.global.find((e) => e.uid === ctx.usuario.uid);

  const card = el('div', { class: 'm-card', style: { padding: '2px 0' } });
  const fila = (e, resaltada) => el('div', { class: 'm-rk' + (resaltada ? ' mia' : '') },
    el('div', { class: 'pos' }, e.position <= 3 ? ['🥇', '🥈', '🥉'][e.position - 1] : String(e.position)),
    el('div', { class: 'nom' },
      el('b', null, e.name || 'Sin nombre'),
      el('span', null, [e.grade ? 'grado ' + e.grade : null,
        (e.completed || 0) + ' ejercicio(s)',
        e.badges ? e.badges + ' insignia(s)' : null].filter(Boolean).join(' · '))),
    el('div', { class: 'xp' }, (e.xp || 0) + ' XP'));

  for (const e of visibles) card.append(fila(e, e.uid === ctx.usuario.uid));
  cont.append(card);

  if (mia && visibles.indexOf(mia) === -1) {
    cont.append(el('div', { class: 'm-titulo' }, 'TU POSICIÓN'));
    cont.append(el('div', { class: 'm-card', style: { padding: '2px 0' } }, fila(mia, true)));
  }
  if (!mia) {
    cont.append(el('div', { class: 'm-aviso info' }, icon('info', 14),
      el('div', null, 'Aún no apareces: el ranking se publica cuando tu profesor califica.')));
  }

  return cont;
}

/* ============================================================ insignias */

export async function insignias(ctx) {
  const cont = el('div', { class: 'm-seccion' });
  const datos = await ctx.data.insignias(ctx.usuario.uid);

  if (!datos.items.length) {
    cont.append(vacio('Tu profesor todavía no ha creado insignias.'));
    return cont;
  }

  cont.append(el('div', { class: 'm-titulo' }, 'MIS INSIGNIAS',
    el('span', { class: 'count' }, datos.conseguidas + ' / ' + datos.items.length)));

  const grid = el('div', { class: 'm-badges' });
  for (const b of datos.items) {
    grid.append(el('button', {
      class: 'm-badge' + (b.conseguida ? '' : ' bloqueada'),
      onclick: () => ctx.modal({
        title: b.name || 'Insignia',
        body: el('div', null,
          el('p', null, b.description || 'Sin descripción.'),
          b.conseguida
            ? el('div', { class: 'm-aviso info', style: { marginTop: '10px' } },
              el('div', null, 'Conseguida el ' + fecha(b.grantedAt) + (b.reason ? ' · ' + b.reason : '')))
            : el('div', { class: 'm-aviso', style: { marginTop: '10px' } },
              el('div', null, b.type === 'manual'
                ? 'La concede tu profesor.'
                : 'Se concede automáticamente cuando cumples la condición y tu profesor califica.')),
          b.xpBonus ? el('p', null, 'Da ' + b.xpBonus + ' XP extra.') : null),
        buttons: [{ label: 'Cerrar', value: null, primary: true }]
      })
    },
      el('span', {
        class: 'ico',
        style: b.conseguida ? { background: b.color || 'var(--py-yellow)', color: '#10131a' } : null
      }, icon(b.conseguida ? (b.icon || 'star') : 'lock', 17)),
      el('b', null, b.name || ''),
      el('span', null, b.conseguida ? fecha(b.grantedAt) : 'bloqueada')));
  }
  cont.append(grid);
  return cont;
}

/* =================================================================== yo */

export async function yo(ctx) {
  const cont = el('div', { class: 'm-seccion' });
  const u = ctx.usuario;
  const iniciales = String(u.nombre || u.correo || '?').split(' ')
    .map((s) => s.charAt(0)).slice(0, 2).join('').toUpperCase();

  cont.append(el('div', { class: 'm-perfil' },
    el('div', { class: 'av', style: { background: u.color || 'var(--accent)' } }, iniciales),
    el('div', null,
      el('b', null, u.nombre || u.correo),
      el('span', null, u.correo),
      el('div', { class: 'm-meta', style: { marginTop: '5px' } },
        el('span', { class: 'chip ' + (u.rol === 'profesor' ? 'accent' : '') }, u.rol),
        u.grado ? el('span', { class: 'chip' }, 'grado ' + u.grado) : null,
        u.grupo ? el('span', { class: 'chip' }, 'grupo ' + u.grupo) : null))));

  const progreso = await ctx.data.miProgreso(u.uid);
  if (progreso) {
    cont.append(el('div', { class: 'm-titulo' }, 'MI PROGRESO'));
    cont.append(el('div', { class: 'm-lista-datos' },
      el('div', null, el('span', null, 'Ejercicios completados'),
        el('span', null, (progreso.completados != null ? progreso.completados : 0) + ' / ' +
          (progreso.totalEjercicios != null ? progreso.totalEjercicios : 0))),
      el('div', null, el('span', null, 'Promedio'),
        el('span', null, progreso.promedio == null ? '—' : String(progreso.promedio))),
      el('div', null, el('span', null, 'XP'),
        el('span', null, String(progreso.xpTotal != null ? progreso.xpTotal : 0))),
      el('div', null, el('span', null, 'Retos completados'),
        el('span', null, String(progreso.retosCompletados || 0)))));
  }

  cont.append(el('div', { class: 'm-titulo' }, 'ESTA APLICACIÓN'));
  cont.append(el('div', { class: 'm-lista-datos' },
    el('div', null, el('span', null, 'Python'),
      el('span', null, py.estaListo() ? 'listo (en el navegador)' : 'se descarga al ejecutar')),
    el('div', null, el('span', null, 'Proyecto de Firebase'), el('span', null, ctx.fb.estado().proyecto)),
    el('div', null, el('span', null, 'Conexión'), el('span', null, navigator.onLine ? 'en línea' : 'sin conexión'))));

  cont.append(el('div', { class: 'm-aviso info' }, icon('info', 14),
    el('div', null, 'En el teléfono se ejecuta Python dentro del navegador: sirve para resolver ejercicios, ' +
      'pero no hay pip ni terminal. Para eso está la aplicación del computador.')));

  cont.append(el('div', { class: 'm-acciones' },
    el('button', { class: 'btn outline', onclick: () => import('./app.js').then((m) => m.salir()) },
      icon('logout', 14), ' Cerrar sesión')));

  return cont;
}
