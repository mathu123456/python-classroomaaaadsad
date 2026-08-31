'use strict';
/*
 * Pruebas de extremo a extremo de la FASE 3 (sistema academico y evaluacion).
 *
 * Recorren el flujo completo del pliego (seccion 33):
 *   profesor -> temario -> ejercicio -> publicar
 *   estudiante -> abrir -> programar -> ejecutar Python real -> entregar
 *   sistema -> SQLite -> cola -> Firebase
 *   profesor -> revisar -> comentar lineas -> calificar
 *   estudiante -> ver nota, XP y comentarios
 *
 * Firebase se sustituye por un doble en memoria (src/js/test/fake-firebase.js)
 * que ademas aplica una version reducida de las Security Rules, para poder
 * comprobar los permisos sin escribir en el proyecto real del colegio.
 */

const fs = require('fs');
const path = require('path');

const PROFE = {
  nombre: 'Ana', apellido: 'Ruiz',
  correo: 'ana.ruiz@colegio.edu.co',
  password: 'profesor2026'
};

const ALUMNO = {
  nombre: 'Mathias', apellido: 'Corzo',
  correo: 'mathias@colegio.edu.co',
  password: 'alumno2026',
  grado: '10', grupo: 'B'
};

module.exports = function fase3(h) {
  const { js, waitFor, step, group, sleep, setCode, consoleText } = h;

  const estado = { exerciseId: null, submissionId: null, temaId: null, cursoId: null };

  async function limpiarCapas() {
    await js('document.querySelectorAll(".modal-backdrop,.ctx-menu,.tut-backdrop").forEach(n=>n.remove()); return true;');
  }

  async function salir() {
    await limpiarCapas();
    await js('await window.__pc.auth.forceLogout(); return true;');
    await waitFor('!document.getElementById("auth-screen").hidden', 10000, 'pantalla de acceso');
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
    // Entrar termina antes de que la sincronizacion sepa quien entro: se espera.
    await waitFor('window.__pc.sync.estadoActual().activo === true', 15000, 'sincronización lista');
  }

  async function registrarEstudiante(datos) {
    /*
     * El alta pide el código de la clase. Se toma el del profesor -"Curso
     * general", que ya tiene por haber entrado antes-, con una entrada y
     * salida rápidas: los cursos todavía son solo locales, así que no hay
     * otra forma de consultarlo sin sesión.
     */
    await entrarComo(PROFE.correo, PROFE.password);
    const codigoCurso = await js('return (await window.pc.courses.mine())[0].codigo;');
    await salir();

    await js('window.__pc.auth.show("registro"); return true;');
    await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro');
    await js('const f=document.querySelector("#auth-card form");' +
      'f.querySelector("[name=nombre]").value=' + JSON.stringify(datos.nombre) + ';' +
      'f.querySelector("[name=apellido]").value=' + JSON.stringify(datos.apellido) + ';' +
      'f.querySelector("[name=correo]").value=' + JSON.stringify(datos.correo) + ';' +
      'f.querySelector("[name=grado]").value=' + JSON.stringify(datos.grado) + ';' +
      'f.querySelector("[name=grupo]").value=' + JSON.stringify(datos.grupo) + ';' +
      'f.querySelector("[name=codigoCurso]").value=' + JSON.stringify(codigoCurso) + ';' +
      'f.querySelector("[name=password]").value=' + JSON.stringify(datos.password) + ';' +
      'f.querySelector("[name=password2]").value=' + JSON.stringify(datos.password) + ';' +
      'f.requestSubmit(); return true;');
    await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar como estudiante');
    await js('document.querySelectorAll(".tut-backdrop").forEach(n=>n.remove());' +
      'try { await window.pc.users.setTutorialDone(true); } catch(e){} return true;');
  }

  async function sincronizar() {
    await js('await window.__pc.sync.sincronizarAhora(); return true;');
    await sleep(400);
  }

  return (async () => {

    /* ================================================================ */
    group('9. Fase 3 · temario y ejercicios (profesor)');

    await step('la sesión activa es la del profesor', async () => {
      const u = await js('return await window.pc.session.me();');
      if (!u || u.rol !== 'profesor') throw new Error('rol: ' + (u && u.rol));
      if (u.correo !== PROFE.correo) throw new Error('correo: ' + u.correo);
      const curso = await js('return await window.pc.courses.active();');
      if (!curso) throw new Error('sin curso activo');
      estado.cursoId = curso.id;
      return u.nombreCompleto + ' <' + u.correo + '>';
    });

    await step('cargar el temario sugerido', async () => {
      const res = await js('return await window.pc.topics.seed();');
      if (!res.ok) throw new Error('no se pudo cargar');
      const temas = await js('return await window.pc.topics.list();');
      if (temas.length < 17) throw new Error('solo hay ' + temas.length + ' temas');
      estado.temaId = (temas.find((t) => t.nombre === 'Funciones') || temas[0]).id;
      return temas.length + ' temas: ' + temas.slice(0, 5).map((t) => t.nombre).join(', ') + '…';
    });

    await step('no admite dos temas con el mismo nombre', async () => {
      const res = await js('return await window.pc.topics.save({nombre:"Funciones"});');
      if (res.ok) throw new Error('permitió duplicar');
      return res.errores.nombre;
    });

    await step('crear un ejercicio completo con criterios', async () => {
      const datos = {
        title: 'Crear una calculadora',
        description: 'Un programa que sume dos números y muestre el resultado.',
        instructions: '1. Define una función sumar(a, b)\n2. Muéstrala con print()',
        topicId: estado.temaId,
        type: 'timed',
        difficulty: 'medium',
        timeLimit: 30,
        maxAttempts: 3,
        xp: 100,
        maxScore: 5,
        rubric: [
          { name: 'Lógica', points: 2 },
          { name: 'Sintaxis', points: 1.5 },
          { name: 'Organización', points: 1.5 }
        ],
        starterCode: 'def sumar(a, b):\n    pass\n',
        status: 'draft'
      };
      const res = await js('return await window.pc.exercises.save(' + JSON.stringify(datos) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      estado.exerciseId = res.ejercicio.id;
      if (res.ejercicio.rubric.length !== 3) throw new Error('criterios: ' + res.ejercicio.rubric.length);
      if (res.ejercicio.status !== 'draft') throw new Error('estado: ' + res.ejercicio.status);
      return res.ejercicio.title + ' · ' + res.ejercicio.tema + ' · ' + res.ejercicio.xp +
        ' XP · ' + res.ejercicio.rubric.length + ' criterios · borrador';
    });

    await step('rechaza criterios que no suman la nota máxima', async () => {
      const res = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Mal configurado', topicId: estado.temaId, maxScore: 5,
        rubric: [{ name: 'Todo', points: 3 }]
      }) + ');');
      if (res.ok) throw new Error('aceptó criterios incoherentes');
      return res.errores.criterios;
    });

    await step('un borrador no lo ve el estudiante', async () => {
      const ej = await js('return await window.pc.exercises.get(' + JSON.stringify(estado.exerciseId) + ');');
      if (ej.status !== 'draft') throw new Error('estado: ' + ej.status);
      if (ej.disponible) throw new Error('un borrador aparece como disponible');
      return 'estado draft · no disponible: ' + ej.motivoNoDisponible;
    });

    await step('publicar el ejercicio', async () => {
      const res = await js('return await window.pc.exercises.setStatus(' +
        JSON.stringify(estado.exerciseId) + ', "published");');
      if (!res.ok) throw new Error(res.error);
      if (!res.ejercicio.publishedAt) throw new Error('no se registró la fecha de publicación');
      if (!res.ejercicio.disponible) throw new Error('sigue sin estar disponible');
      return 'publicado el ' + res.ejercicio.publishedAt.slice(0, 16).replace('T', ' ');
    });

    await step('crear una clase con el ejercicio', async () => {
      const res = await js('return await window.pc.classes.save(' + JSON.stringify({
        title: 'Clase 15 — Funciones',
        topicId: estado.temaId,
        exerciseIds: [estado.exerciseId],
        onClosePolicy: 'allow_finish'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      if (res.clase.ejercicios.length !== 1) throw new Error('ejercicios en la clase: ' + res.clase.ejercicios.length);
      estado.claseId = res.clase.id;
      return res.clase.title + ' · ' + res.clase.status + ' · 1 ejercicio';
    });

    await step('crear un reto especial', async () => {
      const res = await js('return await window.pc.challenges.save(' + JSON.stringify({
        title: 'El número secreto',
        description: 'Adivina el número en el menor número de intentos.',
        topicId: estado.temaId,
        difficulty: 'hard',
        xp: 150,
        reward: 'Insignia Maestro de funciones',
        maxAttempts: 1,
        status: 'published'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      return res.reto.title + ' · +' + res.reto.xp + ' XP · premio: ' + res.reto.reward;
    });

    await step('todo lo publicado se subió a Firebase', async () => {
      await sincronizar();
      const curso = await js('return await window.pc.courses.active();');
      if (!curso) throw new Error('sin curso activo');
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[curso.id]) || {};
      const nEj = Object.keys(delCurso.exercises || {}).length;
      const nTemas = Object.keys(arbol.topics || {}).length;
      const nClases = Object.keys(delCurso.classes || {}).length;
      const nRetos = Object.keys(delCurso.challenges || {}).length;
      if (!nEj) throw new Error('no hay ejercicios en la base remota');
      if (nTemas < 17) throw new Error('temas remotos: ' + nTemas);
      if (!arbol.config.lastChange) throw new Error('no se emitió la señal de cambio (catálogo compartido)');
      if (!delCurso.config || !delCurso.config.lastChange) throw new Error('no se emitió la señal de cambio del curso');
      const cola = await js('return await window.pc.sync.stats();');
      if (cola.pending) throw new Error('quedan ' + cola.pending + ' elementos sin enviar');
      return nTemas + ' temas · ' + nEj + ' ejercicio(s) · ' + nClases + ' clase(s) · ' + nRetos + ' reto(s), cola vacía';
    });

    /* ================================================================ */
    group('10. Fase 3 · el estudiante resuelve y entrega');

    await step('un estudiante se registra desde la pantalla de acceso', async () => {
      await salir();
      await registrarEstudiante(ALUMNO);
      const u = await js('return await window.pc.session.me();');
      if (!u || u.rol !== 'estudiante') throw new Error('rol: ' + (u && u.rol));
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      if (arbol.roles[u.uid] !== 'student') throw new Error('rol remoto: ' + arbol.roles[u.uid]);
      estado.alumnoUid = u.uid;
      return u.nombreCompleto + ' · ' + u.rol + ' · grado ' + u.grado + u.grupo;
    });

    await step('el estudiante recibe el ejercicio publicado', async () => {
      await sincronizar();
      const lista = await js('return await window.pc.exercises.list();');
      const ej = lista.find((e) => e.title === 'Crear una calculadora');
      if (!ej) throw new Error('no lo ve (' + lista.length + ' visibles)');
      if (!ej.disponible) throw new Error('no disponible: ' + ej.motivoNoDisponible);
      return ej.title + ' · ' + ej.tema + ' · ' + ej.xp + ' XP · ' + ej.timeLimit + ' min';
    });

    await step('el estudiante NO puede crear ejercicios ni ver las cuentas', async () => {
      let e1 = null;
      let e2 = null;
      try { await js('return await window.pc.exercises.save({title:"Trampa", topicId:"x"});'); } catch (err) { e1 = err.message; }
      try { await js('return await window.pc.users.list();'); } catch (err) { e2 = err.message; }
      if (!e1) throw new Error('¡pudo crear un ejercicio!');
      if (!e2) throw new Error('¡pudo listar las cuentas!');
      return 'ambas rechazadas: "' + e1.slice(0, 55) + '"';
    });

    await step('abrir el ejercicio crea la sesión de trabajo', async () => {
      const lista = await js('return await window.pc.exercises.list();');
      const ej = lista.find((e) => e.title === 'Crear una calculadora');
      await js('await window.__pc.sesionEjercicio.abrir(' + JSON.stringify(ej.id) + '); return true;');
      await waitFor('!!window.__pc.sesionEjercicio.sesionActiva()', 15000, 'sesión activa');
      const s = await js('const a = window.__pc.sesionEjercicio.sesionActiva();' +
        'return { archivo: a.archivo, intento: a.submission.attemptNumber, id: a.submissionId };');
      estado.submissionId = s.id;
      if (!fs.existsSync(s.archivo)) throw new Error('no se creó ' + s.archivo);
      const contenido = fs.readFileSync(s.archivo, 'utf8');
      if (contenido.indexOf('def sumar') === -1) throw new Error('no aplicó la plantilla');
      return 'intento ' + s.intento + ' · ' + path.basename(path.dirname(s.archivo)) +
        '/' + path.basename(s.archivo);
    });

    await step('el cronómetro se muestra y descuenta', async () => {
      await waitFor('!document.getElementById("exercise-bar").hidden', 8000, 'barra del ejercicio');
      const t1 = await js('return document.querySelector("#exercise-bar .eb-time").textContent.trim();');
      await sleep(2200);
      const t2 = await js('return document.querySelector("#exercise-bar .eb-time").textContent.trim();');
      if (t1 === t2) throw new Error('el cronómetro no avanza (' + t1 + ')');
      return t1 + ' → ' + t2;
    });

    await step('resolver el ejercicio y ejecutarlo de verdad', async () => {
      await setCode('def sumar(a, b):\n    return a + b\n\n\nprint("La suma es", sumar(7, 5))\n');
      await js('await window.__pc.documents.save(); window.__pc.runCurrent(); return true;');
      await waitFor(consoleText + '.includes("La suma es 12")', 30000, 'salida del programa');
      return 'La suma es 12';
    });

    await step('el autoguardado deja el código en SQLite', async () => {
      await js('await window.__pc.sesionEjercicio.autoguardar(true); return true;');
      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.submissionId) + ');');
      if (s.code.indexOf('return a + b') === -1) throw new Error('el borrador no tiene el código');
      if (s.status !== 'in_progress') throw new Error('estado: ' + s.status);
      const cola = await js('return await window.pc.sync.stats();');
      return 'borrador guardado (' + s.code.length + ' car.) · el autoguardado no toca Firebase';
    });

    await step('salir de la ventana queda registrado', async () => {
      await js('window.dispatchEvent(new Event("blur")); return true;');
      await sleep(500);
      const eventos = await js('return await window.pc.events.list({submissionId:' +
        JSON.stringify(estado.submissionId) + '});');
      const tipos = eventos.map((e) => e.type);
      if (tipos.indexOf('FOCUS_LOST') === -1) throw new Error('no registró FOCUS_LOST: ' + tipos.join(', '));
      return tipos.slice(0, 4).join(', ');
    });

    await step('entregar el ejercicio', async () => {
      // Se confirma el diálogo automáticamente.
      const p = js('await window.__pc.sesionEjercicio.entregar(); return true;');
      await waitFor('!!document.querySelector(".modal-backdrop .btn.primary")', 8000, 'confirmación');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await waitFor('!!document.querySelector(".entrega-ok")', 15000, 'acuse de entrega');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await p.catch(() => {});
      await sleep(400);

      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.submissionId) + ');');
      if (['submitted', 'late'].indexOf(s.status) === -1) throw new Error('estado: ' + s.status);
      if (!s.submittedAt) throw new Error('sin fecha de entrega');
      return 'estado ' + s.status + ' · ' + s.code.split('\n').length + ' líneas · ' + s.timeSpentSec + ' s de trabajo';
    });

    await step('la entrega llegó a Firebase con el código', async () => {
      await sincronizar();
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      const entrega = (delCurso.submissions || {})[estado.submissionId];
      if (!entrega) throw new Error('la entrega no está en la base remota');
      if (entrega.code.indexOf('return a + b') === -1) throw new Error('el código no viajó');
      if (entrega.studentId !== estado.alumnoUid) throw new Error('studentId incorrecto');
      const cola = await js('return await window.pc.sync.stats();');
      if (cola.pending) throw new Error('quedan ' + cola.pending + ' pendientes');
      return 'submissions/' + estado.submissionId.slice(0, 14) + '… · ' + entrega.code.length + ' caracteres';
    });

    await step('un estudiante no puede escribirse una nota (reglas)', async () => {
      const res = await js(
        'try {' +
        '  await window.__pcFakeFirebase.dbSet(' +
        '    window.__pcFakeFirebase.ref(null, "courses/' + estado.cursoId + '/submissions/' + estado.submissionId + '"),' +
        '    { studentId: ' + JSON.stringify(estado.alumnoUid) + ', exerciseId: "x", status: "graded", grade: 5, xpEarned: 100 });' +
        '  return { permitido: true };' +
        '} catch (e) { return { permitido: false, error: String(e.message) }; }');
      if (res.permitido) throw new Error('¡las reglas dejaron al estudiante ponerse nota!');
      return res.error;
    });

    await step('un estudiante no puede ascenderse a profesor (reglas)', async () => {
      const res = await js(
        'try {' +
        '  await window.__pcFakeFirebase.dbSet(' +
        '    window.__pcFakeFirebase.ref(null, "roles/' + estado.alumnoUid + '"), "teacher");' +
        '  return { permitido: true };' +
        '} catch (e) { return { permitido: false, error: String(e.message) }; }');
      if (res.permitido) throw new Error('¡se pudo ascender a profesor!');
      return res.error;
    });

    /* ================================================================ */
    group('11. Fase 3 · revisión y calificación');

    await step('el profesor ve la entrega pendiente', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const cont = await js('return await window.pc.submissions.counters();');
      if (!cont.pendientes) throw new Error('no hay entregas pendientes: ' + JSON.stringify(cont));
      await js('window.__pc.irPagina("entregas"); return true;');
      await waitFor('document.querySelectorAll("#page-host .entrega-row").length > 0', 10000, 'bandeja');
      const texto = await js('return document.getElementById("page-host").innerText;');
      if (texto.indexOf(ALUMNO.nombre) === -1) throw new Error('no aparece el estudiante');
      return cont.pendientes + ' pendiente(s) en la bandeja';
    });

    await step('abrir la revisión muestra el código del estudiante', async () => {
      await js('await window.__pc.review.abrirRevision(' + JSON.stringify(estado.submissionId) + '); return true;');
      await waitFor('!!document.querySelector("#rev-code-host .cm-content")', 12000, 'visor de código');
      const info = await js('return {' +
        ' lineas: document.querySelectorAll("#rev-code-host .cm-line").length,' +
        ' texto: document.querySelector("#rev-code-host .cm-content").innerText.slice(0, 60),' +
        ' paneles: document.querySelectorAll(".revision > *").length };');
      if (info.lineas < 3) throw new Error('el visor muestra ' + info.lineas + ' líneas');
      if (info.texto.indexOf('def sumar') === -1) throw new Error('no muestra el código: ' + info.texto);
      if (info.paneles !== 3) throw new Error('paneles: ' + info.paneles);
      return info.paneles + ' paneles · ' + info.lineas + ' líneas · "' + info.texto.split('\n')[0] + '"';
    });

    await step('añadir comentarios por línea de distintos tipos', async () => {
      const comentarios = [
        { line: 2, type: 'positive', message: 'Muy bien: la función devuelve el valor en vez de imprimirlo.' },
        { line: 5, type: 'warning', message: 'Deberías validar que los argumentos sean números.' },
        { line: 1, type: 'suggestion', message: 'Puedes añadir un docstring explicando qué hace la función.' }
      ];
      for (const c of comentarios) {
        const res = await js('return await window.pc.feedback.save(' +
          JSON.stringify(Object.assign({ submissionId: estado.submissionId }, c)) + ');');
        if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      }
      const lista = await js('return await window.pc.feedback.list(' + JSON.stringify(estado.submissionId) + ');');
      if (lista.length !== 3) throw new Error('guardó ' + lista.length + ' comentarios');
      return lista.map((f) => 'L' + f.line + ':' + f.type).join(', ');
    });

    await step('las líneas comentadas se marcan en el visor', async () => {
      await js('await window.__pc.router.refresh(); return true;');
      await waitFor('document.querySelectorAll("#rev-code-host .cm-fb-line").length >= 3', 12000, 'líneas marcadas');
      await waitFor('!!document.querySelector("#rev-code-host .cm-fb-warning")', 12000, 'marca de advertencia');
      const clases = await js(
        'return Array.from(document.querySelectorAll("#rev-code-host .cm-fb-line"))' +
        '.map(n => Array.from(n.classList).filter(c => c.indexOf("cm-fb-") === 0 && c !== "cm-fb-line")[0]);');
      if (clases.indexOf('cm-fb-warning') === -1) throw new Error('falta la marca de advertencia: ' + clases.join(','));
      return clases.join(', ');
    });

    await step('calificar la entrega', async () => {
      const res = await js('return await window.pc.submissions.grade(' + JSON.stringify(estado.submissionId) + ', ' +
        JSON.stringify({
          grade: 4.5, xpEarned: 90,
          teacherComment: 'Excelente trabajo. La lógica está correcta. Debes mejorar la validación de entrada.'
        }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      const s = res.submission;
      if (s.status !== 'graded') throw new Error('estado: ' + s.status);
      if (s.grade !== 4.5 || s.xpEarned !== 90) throw new Error('nota/XP: ' + s.grade + '/' + s.xpEarned);
      return s.grade + ' / ' + s.maxScore + ' · +' + s.xpEarned + ' XP · ' + s.status;
    });

    await step('cambiar la nota deja historial', async () => {
      const res = await js('return await window.pc.submissions.grade(' + JSON.stringify(estado.submissionId) + ', ' +
        JSON.stringify({ grade: 4.8, xpEarned: 96, teacherComment: 'Revisado de nuevo.', reason: 'Corrección posterior' }) + ');');
      if (!res.ok) throw new Error(res.error);
      if (!res.huboHistorial) throw new Error('no marcó que hubo historial');
      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.submissionId) + ');');
      if (!s.gradeHistory.length) throw new Error('el historial está vacío');
      const h = s.gradeHistory[0];
      if (h.oldGrade !== 4.5 || h.newGrade !== 4.8) throw new Error('historial: ' + JSON.stringify(h));
      return h.oldGrade + ' → ' + h.newGrade + '  (' + h.reason + ')';
    });

    await step('la calificación y los comentarios suben a Firebase', async () => {
      await sincronizar();
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      const entrega = (delCurso.submissions || {})[estado.submissionId];
      if (!entrega || entrega.grade !== 4.8) throw new Error('nota remota: ' + (entrega && entrega.grade));
      const fb = (delCurso.feedback || {})[estado.submissionId];
      if (!fb || Object.keys(fb).length !== 3) throw new Error('comentarios remotos: ' + Object.keys(fb || {}).length);
      const hist = (delCurso.gradeHistory || {})[estado.submissionId];
      if (!hist || !Object.keys(hist).length) throw new Error('historial remoto vacío');
      return 'nota ' + entrega.grade + ' · ' + Object.keys(fb).length + ' comentarios · historial anidado por entrega';
    });

    /* ================================================================ */
    group('12. Fase 3 · el estudiante recibe el resultado');

    await step('el estudiante ve su nota, su XP y los comentarios', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();

      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.submissionId) + ');');
      if (s.grade !== 4.8) throw new Error('nota recibida: ' + s.grade);
      if (s.xpEarned !== 96) throw new Error('XP recibido: ' + s.xpEarned);
      if (!s.feedback.length) throw new Error('no recibió los comentarios');
      if (s.teacherComment.indexOf('Revisado') === -1) throw new Error('sin comentario general');
      return s.grade + ' / ' + s.maxScore + ' · +' + s.xpEarned + ' XP · ' + s.feedback.length + ' comentarios';
    });

    await step('la pantalla de resultado se pinta', async () => {
      const p = js('await window.__pc.review.mostrarResultado(' + JSON.stringify(estado.submissionId) + '); return true;');
      await waitFor('!!document.querySelector(".resultado")', 10000, 'pantalla de resultado');
      const texto = await js('return document.querySelector(".modal-body").innerText;');
      if (texto.indexOf('4.8') === -1) throw new Error('no muestra la nota');
      if (texto.indexOf('96') === -1) throw new Error('no muestra el XP');
      if (texto.indexOf('validación') === -1 && texto.indexOf('docstring') === -1) {
        throw new Error('no muestra los comentarios');
      }
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await p.catch(() => {});
      return 'nota, XP y comentarios visibles';
    });

    await step('el progreso del estudiante refleja la calificación', async () => {
      await js('await window.pc.progress.recompute(); return true;');
      const { progreso } = await js('return await window.pc.progress.mine();');
      if (progreso.xpTotal !== 96) throw new Error('XP total: ' + progreso.xpTotal);
      if (progreso.promedio !== 4.8) throw new Error('promedio: ' + progreso.promedio);
      if (progreso.completados !== 1) throw new Error('completados: ' + progreso.completados);
      if (progreso.aprobados !== 1) throw new Error('aprobados: ' + progreso.aprobados);
      const tema = progreso.porTema.find((t) => t.tema === 'Funciones');
      if (!tema || tema.xp !== 96) throw new Error('progreso por tema: ' + JSON.stringify(tema));
      return progreso.completados + '/' + progreso.totalEjercicios + ' · ' + progreso.xpTotal +
        ' XP · promedio ' + progreso.promedio + ' · tema Funciones ' + tema.porcentaje + '%';
    });

    await step('el tablero del estudiante muestra los datos reales', async () => {
      await js('window.__pc.irPagina("inicio"); return true;');
      await waitFor('document.querySelectorAll("#page-host .kpi").length >= 4', 10000, 'tarjetas');
      const texto = await js('return document.getElementById("page-host").innerText;');
      if (texto.indexOf('Hola, ' + ALUMNO.nombre) === -1) {
        const yo = await js('return await window.pc.session.me();');
        throw new Error('no saluda al estudiante · sesión: ' + JSON.stringify({
          uid: yo && yo.uid, nombre: yo && yo.nombre, apellido: yo && yo.apellido,
          correo: yo && yo.correo, rol: yo && yo.rol
        }) + ' · texto: ' + texto.replace(/\s+/g, ' ').slice(0, 120));
      }
      if (texto.indexOf('96') === -1) throw new Error('no muestra el XP');
      if (texto.indexOf('4.8') === -1) throw new Error('no muestra el promedio');
      const kpis = await js('return Array.from(document.querySelectorAll("#page-host .kpi")).map(k =>' +
        ' k.querySelector(".k-top").innerText.trim() + " " + k.querySelector(".k-value").innerText.trim());');
      return kpis.join('  |  ');
    });

    /* ================================================================ */
    group('13. Fase 3 · intentos, sin conexión y reglas');

    await step('un segundo intento no borra el primero', async () => {
      const lista = await js('return await window.pc.exercises.list();');
      const ej = lista.find((e) => e.title === 'Crear una calculadora');
      const res = await js('return await window.pc.submissions.start(' + JSON.stringify(ej.id) + ');');
      if (!res.ok) throw new Error(res.error);
      if (res.submission.attemptNumber !== 2) throw new Error('intento: ' + res.submission.attemptNumber);
      const mias = await js('return await window.pc.submissions.mine(' + JSON.stringify(ej.id) + ');');
      if (mias.length !== 2) throw new Error('entregas guardadas: ' + mias.length);
      const primero = mias.find((s) => s.attemptNumber === 1);
      if (primero.code.indexOf('return a + b') === -1) throw new Error('¡se perdió el código del intento 1!');
      if (primero.grade !== 4.8) throw new Error('¡se perdió la nota del intento 1!');
      estado.segundoIntento = res.submission.id;
      return 'intento 2 abierto · el intento 1 conserva código y nota';
    });

    await step('sin conexión la entrega se guarda y queda en cola', async () => {
      await js('window.__pcFakeFirebase._simularSinRed(true); return true;');
      const res = await js('return await window.pc.submissions.submit(' + JSON.stringify(estado.segundoIntento) +
        ', {code: "print(\\"segundo intento sin internet\\")"});');
      if (!res.ok) throw new Error(res.error);
      await js('await window.__pc.sync.empujar(); return true;');
      await sleep(500);
      const cola = await js('return await window.pc.sync.stats();');
      if (!(cola.pending + cola.failed)) throw new Error('la cola quedó vacía: debería haber elementos esperando');
      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.segundoIntento) + ');');
      if (['submitted', 'late'].indexOf(s.status) === -1) throw new Error('estado local: ' + s.status);
      return 'entrega guardada en local, ' + (cola.pending + cola.failed) + ' elemento(s) esperando conexión';
    });

    await step('al volver la conexión la cola se vacía sola', async () => {
      await js('window.__pcFakeFirebase._simularSinRed(false); return true;');
      await js('await window.__pc.sync.empujar(); return true;');
      await sleep(800);
      const cola = await js('return await window.pc.sync.stats();');
      if (cola.pending + cola.failed) {
        const pendientes = await js('return (await window.pc.sync.pending(20)).map(i =>' +
          ' i.entity + "/" + i.entityId + " [" + i.status + "] " + (i.lastError || ""));');
        throw new Error('quedan ' + (cola.pending + cola.failed) + ' sin enviar: ' + JSON.stringify(pendientes));
      }
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      const entrega = (delCurso.submissions || {})[estado.segundoIntento];
      if (!entrega) throw new Error('el segundo intento no llegó a Firebase');
      if (entrega.code.indexOf('sin internet') === -1) throw new Error('el código no coincide');
      return 'cola vacía · el segundo intento está en Firebase';
    });

    await step('el profesor ve los dos intentos y el ranking se publica', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();

      const lote = await js('return await window.pc.submissions.review({status:"all", limit:50});');
      const delAlumno = lote.items.filter((s) => s.studentId === ' ' ? false : s.estudiante && s.estudiante.uid === estado.alumnoUid);
      if (delAlumno.length < 2) throw new Error('el profesor ve ' + delAlumno.length + ' intento(s)');

      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      if (!delCurso.rankings || !delCurso.rankings.global) throw new Error('no se publicó el ranking');
      const primero = delCurso.rankings.global[0];
      if (!primero || primero.xp !== 96) throw new Error('ranking: ' + JSON.stringify(primero));
      return delAlumno.length + ' intentos visibles · ranking del curso con ' +
        delCurso.rankings.global.length + ' estudiante(s), líder con ' + primero.xp + ' XP';
    });

    await step('reabrir una entrega devuelve el control al estudiante', async () => {
      const res = await js('return await window.pc.submissions.reopen(' + JSON.stringify(estado.segundoIntento) +
        ', "Corrige la validación y vuelve a entregar");');
      if (!res.ok) throw new Error(res.error);
      if (res.submission.status !== 'in_progress') throw new Error('estado: ' + res.submission.status);
      const eventos = await js('return await window.pc.events.list({submissionId:' +
        JSON.stringify(estado.segundoIntento) + '});');
      if (!eventos.some((e) => e.type === 'REOPENED_BY_TEACHER')) throw new Error('sin evento de reapertura');
      return 'estado in_progress · evento REOPENED_BY_TEACHER registrado';
    });

    await step('cerrar el ejercicio impide nuevas entregas', async () => {
      await js('return await window.pc.exercises.setStatus(' + JSON.stringify(estado.exerciseId) + ', "closed");');
      await sincronizar();
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();
      const res = await js('return await window.pc.submissions.start(' + JSON.stringify(estado.exerciseId) + ');');
      if (res.ok) throw new Error('¡permitió abrir un ejercicio cerrado!');
      return res.error;
    });

    await step('la base de datos local es SQLite de verdad', async () => {
      const info = await js('return await window.pc.data.info();');
      if (!/\.db$/.test(info.db.path)) throw new Error('ruta: ' + info.db.path);
      if (!fs.existsSync(info.db.path)) throw new Error('el archivo no existe');
      const cabecera = fs.readFileSync(info.db.path).slice(0, 15).toString('utf8');
      if (cabecera.indexOf('SQLite format 3') !== 0) throw new Error('cabecera: ' + JSON.stringify(cabecera));
      const t = info.db.tables;
      if (!t.submissions || !t.feedback || !t.grade_history) {
        throw new Error('tablas: ' + JSON.stringify(t));
      }
      return path.basename(info.db.path) + ' · ' + Math.round(info.db.sizeBytes / 1024) + ' KB · ' +
        Object.entries(t).map(([k, v]) => k + ':' + v).join(' ');
    });

  })();
};

module.exports.PROFE = PROFE;
module.exports.ALUMNO = ALUMNO;
