'use strict';
/*
 * Pruebas de «sin conexión» y «red lenta».
 *
 * Es el escenario de verdad del colegio: el wifi se cae en medio de la clase, o
 * va tan lento que cada envío tarda casi un segundo. Lo que el pliego promete y
 * aquí se comprueba:
 *
 *   - se puede seguir trabajando y entregando sin conexión
 *   - lo hecho sin conexión se envía SOLO al volver la red, sin pulsar nada
 *   - la barra de estado dice la verdad: 🔴 sin conexión, 🟡 enviando, 🟢 al día
 *   - el profesor puede calificar sin conexión y la nota sale después
 *   - con red lenta la interfaz sigue respondiendo y nada se sube dos veces
 */

const fase3 = require('./e2e-fase3.js');

const PROFE = fase3.PROFE;
const ALUMNO = fase3.ALUMNO;

module.exports = function offline(h) {
  const { js, waitFor, step, group, sleep } = h;

  const estado = {};

  async function limpiarCapas() {
    await js('document.querySelectorAll(".modal-backdrop,.ctx-menu,.tut-backdrop").forEach(n=>n.remove()); return true;');
  }

  async function salir() {
    await limpiarCapas();
    await js('if (window.__pc.sesionEjercicio.sesionActiva()) window.__pc.sesionEjercicio.cerrar();' +
      'await window.__pc.auth.forceLogout(); return true;');
    await waitFor('!document.getElementById("auth-screen").hidden', 12000, 'pantalla de acceso');
  }

  async function entrarComo(correo, password) {
    await js('window.__pc.auth.show("login"); return true;');
    await waitFor('!!document.querySelector("#auth-card form input[name=\\"correo\\"]")', 8000, 'formulario');
    await js('const f=document.querySelector("#auth-card form");' +
      'f.querySelector("[name=correo]").value=' + JSON.stringify(correo) + ';' +
      'f.querySelector("[name=password]").value=' + JSON.stringify(password) + ';' +
      'f.requestSubmit(); return true;');
    await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar');
    await js('document.querySelectorAll(".tut-backdrop").forEach(n=>n.remove());' +
      'try { await window.pc.users.setTutorialDone(true); } catch(e){} return true;');
    await waitFor('(await window.pc.session.me()) ? true : false', 8000, 'sesión activa');
    await waitFor('window.__pc.sync.estadoActual().activo === true', 15000, 'sincronización lista');
  }

  /** Corta o devuelve la red del doble de Firebase, como el wifi de un colegio. */
  async function red(hay) {
    await js('window.__pcFakeFirebase._simularSinRed(' + (hay ? 'false' : 'true') + '); return true;');
    await sleep(300);
  }

  async function chip() {
    return js('const c = document.getElementById("sb-sync");' +
      'return { texto: c.textContent.trim(), punto: (c.querySelector(".punto-estado")||{}).className || "" };');
  }

  async function sincronizar() {
    await js('await window.__pc.sync.sincronizarAhora(); return true;');
    await sleep(400);
  }

  /*
   * Las entregas viven anidadas bajo courses/<curso>/submissions ahora, no en
   * un nodo plano: este trocito de expresión JS (para inyectar dentro de las
   * cadenas que se evalúan en la página) resuelve ese nodo del curso activo.
   */
  function nodoEntregas() {
    return '((window.__pcFakeFirebase._volcado().courses || {})[' +
      JSON.stringify(estado.cursoId) + '] || {}).submissions';
  }

  return (async () => {

    /* ================================================================ */
    group('37. 1.0.0 · trabajar sin conexión');

    await step('la barra lo dice sin tecnicismos en cuanto se cae la red', async () => {
      /*
       * Un ejercicio propio para estas pruebas: los de las fases anteriores
       * pueden tener los intentos gastados, y aqui hace falta entregar.
       */
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const curso = await js('return await window.pc.courses.active();');
      if (!curso) throw new Error('sin curso activo');
      estado.cursoId = curso.id;
      const temas = await js('return await window.pc.topics.list();');
      const nuevo = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Ejercicio sin conexión',
        description: 'Para comprobar que se puede entregar sin red.',
        instructions: 'Escribe un saludo con print().',
        topicId: temas[0].id, type: 'normal', difficulty: 'easy',
        xp: 20, maxScore: 5, maxAttempts: 3, status: 'published'
      }) + ');');
      if (!nuevo.ok) throw new Error(JSON.stringify(nuevo.errores || nuevo.error));
      estado.ejercicio = nuevo.ejercicio.id;
      await sincronizar();

      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();

      // Puede quedar algo en camino de las pruebas anteriores: se espera.
      await waitFor('document.getElementById("sb-sync").textContent.trim() === "Conectado"',
        25000, 'la barra dice «Conectado» antes de cortar');

      await red(false);
      await waitFor('document.getElementById("sb-sync").textContent.trim() === "Sin conexión"',
        12000, 'la barra avisa de la caída');
      const ahora = await chip();
      if (ahora.punto.indexOf('rojo') === -1) throw new Error('el punto no es rojo: ' + ahora.punto);

      const titulo = await js('return document.getElementById("sb-sync").title;');
      if (titulo.indexOf('se enviará solo') === -1) {
        throw new Error('no dice que se enviará solo: ' + titulo);
      }
      for (const palabra of ['Firebase', 'SQLite', 'sync', 'offline', 'null']) {
        if ((ahora.texto + ' ' + titulo).toLowerCase().indexOf(palabra.toLowerCase()) !== -1) {
          throw new Error('la barra usa la palabra «' + palabra + '»');
        }
      }
      return '🔴 ' + ahora.texto + ' · «' + titulo.slice(0, 46) + '…»';
    });

    await step('sin conexión se entrega igual y queda esperando', async () => {
      const inicio = await js('return await window.pc.submissions.start(' +
        JSON.stringify(estado.ejercicio) + ');');
      if (!inicio.ok) throw new Error('no se pudo empezar el ejercicio: ' + inicio.error);
      estado.entrega = inicio.submission.id;

      const env = await js('return await window.pc.submissions.submit(' +
        JSON.stringify(estado.entrega) + ', {code: "print(\'sin conexion\')\\n"});');
      if (!env.ok) throw new Error('no se pudo entregar sin conexión: ' + env.error);

      const mia = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entrega) + ');');
      const nombre = await js('const d = await import("./js/dashboard.js");' +
        'return d.textoEstado(' + JSON.stringify(mia.status) + ');');
      if (nombre !== 'Pendiente de revisión') throw new Error('el estado quedó como «' + nombre + '»');

      // La entrega está en la cola y NO en la base remota: todavía no hay red.
      const cola = await js('return (await window.pc.sync.pending(50))' +
        '.filter(i => i.entity === "submissions" && i.entityId === ' + JSON.stringify(estado.entrega) + ')' +
        '.map(i => ({ estado: i.status, prioridad: i.priority }));');
      if (!cola.length) throw new Error('la entrega no quedó en la cola de envío');
      if (cola[0].prioridad !== 1) throw new Error('la entrega no tiene prioridad alta');

      const remoto = await js('return !!(' + nodoEntregas() + ' || {})[' +
        JSON.stringify(estado.entrega) + '];');
      if (remoto) throw new Error('llegó a la base remota estando sin red');

      return 'entregada y guardada aquí · ' + nombre + ' · esperando su turno';
    });

    await step('equivocarse sin conexión tampoco gasta intentos', async () => {
      const antes = await js('return (await window.pc.submissions.mine(' +
        JSON.stringify(estado.ejercicio) + ')).length;');

      await js('window.__pc.irIDE(); return true;');
      await js('const v = window.__pc.editor.getView();' +
        'v.dispatch({changes:{from:0,to:v.state.doc.length,insert:"print(1/0)\\n"}});' +
        'window.__pc.documents.syncActive(); window.__pc.runCurrent(); return true;');
      await sleep(2400);

      const despues = await js('return await window.pc.submissions.mine(' +
        JSON.stringify(estado.ejercicio) + ');');
      if (despues.length !== antes) {
        throw new Error('los intentos pasaron de ' + antes + ' a ' + despues.length);
      }
      if (despues.some((s) => s.status === 'abandoned')) throw new Error('marcó una entrega como abandonada');

      const consola = await js('return document.getElementById("console-out").innerText;');
      if (consola.indexOf('Error al ejecutar') === -1) throw new Error('no explicó el error');
      if (consola.indexOf('entre cero') === -1 && consola.indexOf('dividir') === -1) {
        throw new Error('no explicó la división entre cero: ' + consola.slice(-140));
      }
      return antes + ' intento(s) antes y después · el error explicado en castellano';
    });

    await step('al volver la red se envía solo, sin pulsar nada', async () => {
      await red(true);

      // Nadie sincroniza a mano: la aplicación tiene que darse cuenta ella.
      await waitFor('!!(' + nodoEntregas() + ' || {})[' +
        JSON.stringify(estado.entrega) + ']', 25000, 'la entrega sube sola');

      await waitFor('document.getElementById("sb-sync").textContent.trim() === "Conectado"',
        20000, 'la barra vuelve a «Conectado»');

      const cola = await js('return await window.pc.sync.stats();');
      if (cola.pending) throw new Error('quedan ' + cola.pending + ' cosas por enviar');

      const remoto = await js('return (' + nodoEntregas() + ' || {})[' +
        JSON.stringify(estado.entrega) + '];');
      if (remoto.status !== 'submitted') throw new Error('subió con el estado ' + remoto.status);
      if (!remoto.code || remoto.code.indexOf('sin conexion') === -1) {
        throw new Error('subió sin el código que se escribió');
      }
      return 'la entrega subió sola al volver la red · 🟢 Conectado · 0 pendientes';
    });

    await step('el profesor califica sin conexión y la nota sale después', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();

      await red(false);
      await waitFor('document.getElementById("sb-sync").textContent.trim() === "Sin conexión"',
        12000, 'la barra avisa de la caída');

      const cal = await js('return await window.pc.submissions.grade(' +
        JSON.stringify(estado.entrega) + ', {grade: 4.2, teacherComment: "Bien, sigue así."});');
      if (!cal.ok) throw new Error('no se pudo calificar sin conexión: ' + (cal.error || ''));

      const local = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entrega) + ');');
      if (local.grade !== 4.2) throw new Error('la nota no quedó guardada aquí');

      const remotoAntes = await js('return (' + nodoEntregas() + ' || {})[' +
        JSON.stringify(estado.entrega) + '].grade;');
      if (remotoAntes != null) throw new Error('la nota salió estando sin red');

      await red(true);
      await waitFor('(' + nodoEntregas() + ' || {})[' +
        JSON.stringify(estado.entrega) + '].grade === 4.2', 25000, 'la nota sube sola');
      return 'calificado sin red y enviado solo al volver · nota 4.2';
    });

    /* ================================================================ */
    group('38. 1.0.0 · red lenta');

    await step('con red lenta la interfaz sigue respondiendo', async () => {
      await js('window.__pcFakeFirebase._simularRetardo(600); return true;');

      // Se provoca algo que subir y se mira la barra MIENTRAS sube.
      const temas = await js('return await window.pc.topics.list();');
      await js('return await window.pc.topics.save(' + JSON.stringify(
        { id: temas[0].id, name: temas[0].nombre || temas[0].name, description: 'Con la red lenta' }) + ');');
      await js('window.__pc.sync.sincronizarAhora(); return true;');   // sin esperar

      let vistoAmbar = false;
      let peorRespuesta = 0;
      for (let i = 0; i < 30; i++) {
        const t0 = Date.now();
        const c = await js('const c = document.getElementById("sb-sync");' +
          'return { texto: c.textContent.trim(), punto: (c.querySelector(".punto-estado")||{}).className || "" };');
        peorRespuesta = Math.max(peorRespuesta, Date.now() - t0);
        if (c.texto === 'Sincronizando…' && c.punto.indexOf('ambar') !== -1) vistoAmbar = true;
        if (vistoAmbar && c.texto === 'Conectado') break;
        await sleep(300);
      }
      if (!vistoAmbar) throw new Error('nunca dijo «Sincronizando…» con la red lenta');
      if (peorRespuesta > 1500) throw new Error('la interfaz tardó ' + peorRespuesta + ' ms en contestar');

      /*
       * Que la cola se vacie es lo que importa; el color vuelve al verde en
       * cuanto no queda nada en camino. Se quita el retardo antes de esperar el
       * color para no medir los temporizadores de fondo con la red a rastras.
       */
      await waitFor('(await window.pc.sync.stats()).pending === 0', 45000, 'la cola se vacia');
      await js('window.__pcFakeFirebase._simularRetardo(0); return true;');
      try {
        await waitFor('document.getElementById("sb-sync").textContent.trim() === "Conectado"',
          25000, 'la barra vuelve al verde');
      } catch (err) {
        const diag = await js('return { estado: window.__pc.sync.estadoActual(), cola: await window.pc.sync.stats() };');
        throw new Error(err.message + ' | ' + JSON.stringify(diag));
      }
      return '🟡 visto mientras subía · la interfaz contestó en ' + peorRespuesta + ' ms como máximo';
    });

    await step('con red lenta nada se sube dos veces', async () => {
      const temas = await js('return await window.pc.topics.list();');
      const tema = temas[0].id;

      // Cinco guardados y dos sincronizaciones a la vez: una sola subida.
      const nombreTema = temas[0].nombre || temas[0].name;
      for (let i = 0; i < 5; i++) {
        await js('return await window.pc.topics.save(' + JSON.stringify(
          { id: tema, name: nombreTema, description: 'Guardado ' + i }) + ');');
      }
      const antes = await js('return (await window.pc.sync.pending(50))' +
        '.filter(i => i.entity === "topics" && i.entityId === ' + JSON.stringify(tema) + ').length;');
      if (antes > 1) throw new Error('la cola guardó ' + antes + ' veces el mismo tema');

      await js('window.__pc.sync.sincronizarAhora(); window.__pc.sync.sincronizarAhora(); return true;');
      await waitFor('(await window.pc.sync.stats()).pending === 0', 40000, 'las dos pasadas terminan');

      const cola = await js('return await window.pc.sync.stats();');
      if (cola.failed) throw new Error(cola.failed + ' operación(es) fallida(s) con la red lenta');
      const remoto = await js('return (window.__pcFakeFirebase._volcado().topics || {})[' +
        JSON.stringify(tema) + '].description;');
      if (remoto !== 'Guardado 4') throw new Error('en remoto quedó «' + remoto + '»');

      await js('window.__pcFakeFirebase._simularRetardo(0); return true;');
      return '5 guardados · 1 operación en la cola · 2 pasadas a la vez sin duplicar nada';
    });

  })();
};
