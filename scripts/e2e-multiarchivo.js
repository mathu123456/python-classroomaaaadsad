'use strict';
/*
 * Entregas de varios archivos y ejecución desde la revisión.
 *
 * Lo que se comprueba, de punta a punta:
 *
 *   - el estudiante trabaja con módulos (main.py + utilidades.py) y se entrega
 *     la carpeta entera, no solo el archivo abierto
 *   - puede entregar una carpeta que ya venía haciendo por su cuenta
 *   - la entrega viaja con sus archivos hasta la base compartida
 *   - el profesor ve un archivo por pestaña y comenta en el que toca
 *   - el profesor EJECUTA la entrega en la propia pantalla de revisión, sin
 *     copiar nada, y los `import` del estudiante funcionan
 */

const fs = require('fs');
const path = require('path');

const fase3 = require('./e2e-fase3.js');

const PROFE = fase3.PROFE;
const ALUMNO = fase3.ALUMNO;

module.exports = function multiarchivo(h) {
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

  /*
   * Pulsa «Ejecutar la entrega». La pantalla se repinta sola cuando llegan
   * novedades, asi que el boton puede desaparecer entre que se busca y se pulsa.
   */
  async function pulsarEjecutar() {
    for (let i = 0; i < 10; i++) {
      const ok = await js('const b = document.getElementById("rev-run-btn");' +
        'if (!b) return false; b.click(); return true;');
      if (ok) return true;
      await sleep(600);
    }
    throw new Error('no apareció el botón de ejecutar');
  }

  async function sincronizar() {
    await js('await window.__pc.sync.sincronizarAhora(); return true;');
    await sleep(400);
  }

  return (async () => {

    /* ================================================================ */
    group('39. 1.0.0 · entregas de varios archivos');

    await step('el profesor publica un ejercicio que pide módulos', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const curso = await js('return await window.pc.courses.active();');
      if (!curso) throw new Error('sin curso activo');
      estado.cursoId = curso.id;

      const temas = await js('return await window.pc.topics.list();');
      const res = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Programa con módulos',
        description: 'Reparte tu programa en varios archivos.',
        instructions: 'Escribe main.py y un módulo utilidades.py con una función saludar().',
        topicId: temas[0].id, type: 'normal', difficulty: 'medium',
        xp: 40, maxScore: 5, maxAttempts: 3, status: 'published'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      estado.ejercicio = res.ejercicio.id;
      await sincronizar();
      return 'ejercicio «Programa con módulos» publicado';
    });

    await step('el estudiante trabaja con dos archivos y se entregan los dos', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();

      await js('await window.__pc.sesionEjercicio.abrir(' + JSON.stringify(estado.ejercicio) + '); return true;');
      await waitFor('!!window.__pc.sesionEjercicio.sesionActiva()', 15000, 'sesión del ejercicio');
      const sesion = await js('const a = window.__pc.sesionEjercicio.sesionActiva();' +
        'return { carpeta: a.carpeta, archivo: a.archivo, id: a.submissionId };');
      estado.entrega = sesion.id;
      estado.carpeta = sesion.carpeta;

      // Un módulo de verdad, escrito al lado del archivo principal.
      const sep = sesion.carpeta.indexOf('\\') !== -1 ? '\\' : '/';
      const modulo = sesion.carpeta + sep + 'utilidades.py';
      await js('return await window.pc.files.write(' + JSON.stringify(modulo) + ', ' +
        JSON.stringify('def saludar(nombre):\n    return "Hola " + nombre + " desde utilidades"\n') + ');');

      // Y el principal, que lo importa.
      await js('const v = window.__pc.editor.getView();' +
        'v.dispatch({changes:{from:0,to:v.state.doc.length,insert:' +
        JSON.stringify('from utilidades import saludar\n\nprint(saludar("clase"))\n') + '}});' +
        'window.__pc.documents.syncActive(); await window.__pc.documents.save(); return true;');

      await js('await window.__pc.sesionEjercicio.autoguardar(true); return true;');
      const borrador = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entrega) + ');');
      const nombres = (borrador.files || []).map((f) => f.name).sort();
      if (nombres.indexOf('utilidades.py') === -1) {
        throw new Error('el borrador no guardó el módulo: ' + JSON.stringify(nombres));
      }
      if (nombres.indexOf('enunciado.txt') !== -1) throw new Error('se está entregando el enunciado');
      if (!/main\.py|solucion\.py/.test(borrador.entryFile || '')) {
        throw new Error('no anotó cuál es el archivo principal: ' + borrador.entryFile);
      }
      return 'guardados ' + nombres.join(', ') + ' · principal ' + borrador.entryFile;
    });

    await step('el estudiante ejecuta su programa y sus propios módulos se importan', async () => {
      /*
       * Esto no funcionaba: el Python embebido llega con la lista de rutas de
       * importación fijada y no añadía la carpeta del archivo que se ejecuta, así
       * que un trabajo repartido en módulos fallaba con «No module named».
       */
      await js('window.__pc.irIDE(); window.__pc.runCurrent(); return true;');
      await waitFor('document.getElementById("console-out").innerText' +
        '.indexOf("Hola clase desde utilidades") !== -1', 40000, 'la salida del programa');
      const consola = await js('return document.getElementById("console-out").innerText;');
      if (consola.indexOf('No module named') !== -1) {
        throw new Error('no encontró su propio módulo');
      }
      return 'main.py importó utilidades.py y se ejecutó';
    });

    await step('la barra dice cuántos archivos van a entregarse', async () => {
      const texto = await js('return document.getElementById("exercise-bar").innerText;');
      if (texto.indexOf('archivos') === -1) throw new Error('la barra no habla de archivos: ' + texto);
      const botones = await js('return Array.from(document.querySelectorAll("#exercise-bar button"))' +
        '.map(b => b.textContent.trim());');
      if (!botones.some((b) => b.indexOf('Añadir carpeta') !== -1)) {
        throw new Error('no ofrece añadir una carpeta: ' + botones.join(' | '));
      }
      return texto.split('\n').filter((l) => l.indexOf('archivos') !== -1)[0];
    });

    await step('entregar envía la carpeta completa', async () => {
      const p = js('await window.__pc.sesionEjercicio.entregar(); return true;');
      await waitFor('!!document.querySelector(".modal-backdrop .btn.primary")', 8000, 'confirmación');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await waitFor('!!document.querySelector(".entrega-ok")', 15000, 'acuse de entrega');
      const acuse = await js('return document.querySelector(".entrega-ok").innerText;');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await p.catch(() => {});
      await sleep(400);

      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entrega) + ');');
      if (['submitted', 'late'].indexOf(s.status) === -1) throw new Error('estado: ' + s.status);
      if ((s.files || []).length < 2) throw new Error('solo viajó ' + (s.files || []).length + ' archivo(s)');
      if (acuse.indexOf('carpeta completa') === -1) {
        throw new Error('el acuse no dice que se envió la carpeta: ' + acuse.slice(0, 120));
      }
      return (s.files || []).length + ' archivos entregados · ' + s.status;
    });

    await step('la entrega llega a la base compartida con sus archivos', async () => {
      await sincronizar();
      const remoto = await js('return ((window.__pcFakeFirebase._volcado().courses || {})[' +
        JSON.stringify(estado.cursoId) + '] || {}).submissions?.[' +
        JSON.stringify(estado.entrega) + '];');
      if (!remoto) throw new Error('la entrega no llegó');
      const nombres = (remoto.files || []).map((f) => f.name);
      if (nombres.indexOf('utilidades.py') === -1) {
        throw new Error('el módulo no viajó: ' + JSON.stringify(nombres));
      }
      if (!remoto.entryFile) throw new Error('no viajó cuál es el archivo principal');
      return nombres.join(', ') + ' · se ejecuta ' + remoto.entryFile;
    });

    /* ================================================================ */
    group('40. 1.0.0 · el profesor revisa y ejecuta sin copiar');

    await step('la revisión muestra un archivo por pestaña', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();

      await js('await window.__pc.review.abrirRevision(' + JSON.stringify(estado.entrega) + '); return true;');
      await waitFor('!!document.querySelector("#page-host .rev-files")', 15000, 'pestañas de archivos');

      const leerPestanas = () => js('return Array.from(document.querySelectorAll("#page-host .rev-file"))' +
        '.map(b => b.textContent.replace(/\\s+/g, " ").trim());');
      let pestanas = await leerPestanas();
      for (let i = 0; i < 8 && pestanas.length < 2; i++) {
        await sleep(700);
        pestanas = await leerPestanas();
      }
      if (pestanas.length < 2) {
        const diag = await js('const s = await window.pc.submissions.get(' +
          JSON.stringify(estado.entrega) + ');' +
          'return { archivos: (s.files || []).map(f => f.name), entrada: s.entryFile,' +
          '  abierta: !!window.__pc.review.entregaAbierta(),' +
          '  html: document.getElementById("page-host").innerHTML.slice(0, 400) };');
        throw new Error('solo hay ' + pestanas.length + ' pestaña(s) · ' + JSON.stringify(diag));
      }
      if (!pestanas.some((t) => t.indexOf('principal') !== -1)) {
        throw new Error('no señala cuál es el archivo principal: ' + pestanas.join(' | '));
      }

      /*
       * Al cambiar de pestaña se ve el otro archivo. La pantalla se puede
       * repintar sola entre que se busca el botón y se pulsa (una señal en
       * camino, por ejemplo), así que se reintenta en vez de un solo intento.
       */
      let cambiado = false;
      for (let i = 0; i < 8 && !cambiado; i++) {
        cambiado = await js('const b = Array.from(document.querySelectorAll("#page-host .rev-file"))' +
          '.find(x => x.textContent.indexOf("utilidades.py") !== -1);' +
          'if (!b) return false; b.click(); return true;');
        if (!cambiado) await sleep(500);
      }
      if (!cambiado) throw new Error('no se encontró la pestaña de utilidades.py para pulsarla');
      await waitFor('document.querySelector("#page-host .rev-code-body").innerText.indexOf("def saludar") !== -1',
        10000, 'el código del módulo');
      return pestanas.join(' | ');
    });

    await step('un comentario se queda en el archivo que se está viendo', async () => {
      const p = js('const d = await import("./js/review.js");' +
        'document.querySelector("#page-host .cm-lineNumbers .cm-gutterElement:nth-child(2)").click();' +
        'return true;');
      await p.catch(() => {});
      await waitFor('!!document.querySelector(".modal-backdrop textarea")', 10000, 'diálogo de comentario');
      const titulo = await js('return document.querySelector(".modal-backdrop .modal-title, ' +
        '.modal-backdrop h3, .modal-backdrop header").textContent;');
      if (titulo.indexOf('utilidades.py') === -1) {
        throw new Error('el comentario no sabe en qué archivo está: ' + titulo);
      }
      await js('const t = document.querySelector(".modal-backdrop textarea");' +
        't.value = "Esta función está muy bien."; t.dispatchEvent(new Event("input"));' +
        'const b = Array.from(document.querySelectorAll(".modal-backdrop .btn"))' +
        '.find(x => x.textContent.trim() === "Añadir" || x.textContent.trim() === "Guardar");' +
        'b.click(); return true;');
      await sleep(900);

      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entrega) + ');');
      const fb = (s.feedback || []).find((f) => f.message.indexOf('muy bien') !== -1);
      if (!fb) throw new Error('no se guardó el comentario');
      if (fb.file !== 'utilidades.py') throw new Error('quedó apuntado a «' + fb.file + '»');
      return 'comentario en ' + fb.file + ', línea ' + fb.line;
    });

    await step('el profesor ejecuta la entrega ahí mismo y los import funcionan', async () => {
      // Se vuelve al archivo principal y se ejecuta desde la propia revisión.
      await js('const b = Array.from(document.querySelectorAll("#page-host .rev-file"))' +
        '.find(x => x.textContent.indexOf("main.py") !== -1 || x.textContent.indexOf("solucion.py") !== -1);' +
        'if (b) b.click(); return true;');
      await sleep(600);
      const diagEjecucion = async () => js('return {' +
        ' zona: document.querySelector("#page-host #rev-run") ?' +
        '   document.querySelector("#page-host #rev-run").innerText.slice(0, 300) : "NO EXISTE",' +
        ' oculto: document.querySelector("#page-host #rev-run") ?' +
        '   document.querySelector("#page-host #rev-run").hidden : null,' +
        ' boton: document.getElementById("rev-run-btn") ?' +
        '   document.getElementById("rev-run-btn").textContent : "NO ESTA",' +
        ' activos: await window.pc.python.active(),' +
        ' avisos: Array.from(document.querySelectorAll(".toast")).map(t => t.innerText.slice(0, 120)),' +
        ' consola: document.getElementById("console-out").innerText.slice(-200) };');
      await pulsarEjecutar();

      try {
      await waitFor('document.querySelector("#page-host #rev-run") &&' +
        ' document.querySelector("#page-host #rev-run").innerText' +
        '.indexOf("Hola clase desde utilidades") !== -1', 40000, 'la salida del programa');
      } catch (err) {
        throw new Error(err.message + ' | ' + JSON.stringify(await diagEjecucion()));
      }

      // Y sin salir de la revisión ni abrir el editor.
      const sigueEnRevision = await js('return !!document.querySelector("#page-host .rev-code");');
      if (!sigueEnRevision) throw new Error('se salió de la pantalla de revisión');

      const salida = await js('return document.querySelector("#page-host #rev-run").innerText;');
      if (salida.indexOf('ModuleNotFoundError') !== -1 || salida.indexOf('No module named') !== -1) {
        throw new Error('no encontró el módulo del estudiante');
      }
      return salida.split('\n').filter((l) => l.trim()).slice(-3).join(' · ').slice(0, 110);
    });

    await step('lo que se ejecuta es una copia: la entrega no se toca', async () => {
      const listo = await js('return await window.pc.submissions.prepare(' +
        JSON.stringify(estado.entrega) + ');');
      if (!listo.ok) throw new Error(listo.error);
      if (!fs.existsSync(listo.entrada)) throw new Error('no dejó el archivo en el disco');
      if (listo.carpeta.indexOf(estado.carpeta) === 0) {
        throw new Error('está ejecutando dentro de la carpeta del estudiante');
      }
      const nombres = listo.archivos.map((f) => f.name).sort();
      if (nombres.indexOf('utilidades.py') === -1) throw new Error('la copia no trae el módulo');

      // Tocar la copia no cambia la entrega.
      fs.writeFileSync(listo.entrada, '# tocado por la prueba\n', 'utf8');
      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entrega) + ');');
      if ((s.code || '').indexOf('tocado por la prueba') !== -1) {
        throw new Error('la entrega del estudiante cambió');
      }
      return nombres.length + ' archivos en una carpeta aparte · ' + path.basename(listo.entrada);
    });

    /* ================================================================ */
    group('41. 1.0.0 · entregar una carpeta que ya se estaba haciendo');

    await step('el estudiante entrega su propio proyecto con sus módulos', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();

      // Un proyecto suyo, hecho por su cuenta, con dos archivos.
      const base = await js('return await window.pc.files.defaultWorkspacesDir();');
      const sep = base.indexOf('\\') !== -1 ? '\\' : '/';
      const carpeta = base + sep + 'MiProyectoPropio';
      await js('return await window.pc.files.write(' + JSON.stringify(carpeta + sep + 'programa.py') +
        ', ' + JSON.stringify('from datos import NOMBRES\n\nfor n in NOMBRES:\n    print("Hola", n)\n') + ');');
      await js('return await window.pc.files.write(' + JSON.stringify(carpeta + sep + 'datos.py') +
        ', ' + JSON.stringify('NOMBRES = ["Ana", "Luis"]\n') + ');');

      const antes = await js('return (await window.pc.submissions.mine()).length;');

      const p = js('const m = await import("./js/entregar-carpeta.js");' +
        'window.__pcEntrega = await m.entregarCarpeta(' + JSON.stringify(carpeta) + ', null, null);' +
        'return true;');
      await waitFor('!!document.querySelector(".modal-backdrop select")', 12000, 'diálogo de entrega');

      // Elegir el ejercicio de módulos y programa.py como archivo principal.
      const elegido = await js(
        'const filas = Array.from(document.querySelectorAll(".modal-backdrop .check-fila"));' +
        'const fila = filas.find(f => f.textContent.indexOf("Programa con módulos") !== -1) || filas[0];' +
        'const radio = fila.querySelector("input"); radio.click();' +
        'const sel = document.querySelector(".modal-backdrop select");' +
        'sel.value = "programa.py"; sel.dispatchEvent(new Event("change"));' +
        'return { ejercicio: fila.textContent.split("\\n")[0], archivo: sel.value };');

      await js('const b = Array.from(document.querySelectorAll(".modal-backdrop .btn"))' +
        '.find(x => x.textContent.trim() === "Entregar"); b.click(); return true;');
      await waitFor('!!document.querySelector(".entrega-ok")', 20000, 'acuse de entrega');
      const acuse = await js('return document.querySelector(".entrega-ok").innerText;');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await p.catch(() => {});
      await sleep(500);

      const mias = await js('return await window.pc.submissions.mine();');
      if (mias.length <= antes) throw new Error('no se creó ninguna entrega nueva');

      const nueva = mias.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      const nombres = (nueva.files || []).map((f) => f.name).sort();
      if (nombres.join(',') !== 'datos.py,programa.py') {
        throw new Error('viajaron: ' + JSON.stringify(nombres));
      }
      if (nueva.entryFile !== 'programa.py') {
        throw new Error('el archivo principal quedó como «' + nueva.entryFile + '»');
      }
      if (acuse.indexOf('programa.py') === -1) throw new Error('el acuse no dice por dónde empieza');
      estado.entregaPropia = nueva.id;
      return elegido.ejercicio.trim() + ' · ' + nombres.join(', ') + ' · empieza en ' + nueva.entryFile;
    });

    await step('el profesor la ejecuta y arranca por el archivo que dijo el estudiante', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();

      const listo = await js('return await window.pc.submissions.prepare(' +
        JSON.stringify(estado.entregaPropia) + ');');
      if (!listo.ok) throw new Error(listo.error);
      if (listo.entradaNombre !== 'programa.py') {
        throw new Error('iba a ejecutar ' + listo.entradaNombre);
      }

      await js('await window.__pc.review.abrirRevision(' + JSON.stringify(estado.entregaPropia) + '); return true;');
      await waitFor('!!document.getElementById("rev-run-btn")', 15000, 'la pantalla de revisión');
      await pulsarEjecutar();
      try {
        await waitFor('document.querySelector("#page-host #rev-run") &&' +
          ' document.querySelector("#page-host #rev-run").innerText.indexOf("Hola Ana") !== -1',
          40000, 'la salida del programa');
      } catch (err) {
        const d = await js('return { zona: document.querySelector("#page-host #rev-run") ?' +
          '   document.querySelector("#page-host #rev-run").innerText.slice(0, 300) : "NO EXISTE",' +
          ' activos: await window.pc.python.active(),' +
          ' consola: document.getElementById("console-out").innerText.slice(-200) };');
        throw new Error(err.message + ' | ' + JSON.stringify(d));
      }
      const salida = await js('return document.querySelector("#page-host #rev-run").innerText;');
      if (salida.indexOf('Hola Luis') === -1) throw new Error('no recorrió los datos del módulo');
      return 'ejecutado desde programa.py, importando datos.py, sin copiar nada';
    });

  })();
};
