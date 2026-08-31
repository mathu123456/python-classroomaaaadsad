'use strict';
/*
 * Pruebas de extremo a extremo de la FASE 5 (estadisticas, informes y .pclass).
 *
 * Comprueban los siete puntos de verificacion del pliego de la fase:
 *   1. las estadisticas coinciden con los datos reales
 *   2. un tema con notas bajas dispara el aviso
 *   3. cada grafica se dibuja con el numero de elementos correcto
 *   4. exportar e importar un ejercicio .pclass lo deja identico
 *   5. un .pclass corrupto se rechaza con un mensaje claro
 *   6. el CSV tiene tantas filas como entregas calificadas
 *   7. importar avisa antes de sobrescribir
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const fase3 = require('./e2e-fase3.js');
const fase4 = require('./e2e-fase4.js');

const PROFE = fase3.PROFE;
const ALUMNO2 = fase4.ALUMNO2;

module.exports = function fase5(h) {
  const { js, waitFor, step, group, sleep } = h;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-fase5-'));
  const estado = {
    ejercicioFlojo: null,
    entregaFloja: null,
    exportado: path.join(tmp, 'ejercicio.pclass'),
    corrupto: path.join(tmp, 'roto.pclass'),
    csv: path.join(tmp, 'notas.csv'),
    informe: path.join(tmp, 'informe.html'),
    curso: path.join(tmp, 'curso.json')
  };

  async function limpiarCapas() {
    await js('document.querySelectorAll(".modal-backdrop,.ctx-menu,.tut-backdrop").forEach(n=>n.remove()); return true;');
  }

  async function salir() {
    await limpiarCapas();
    await js('await window.__pc.auth.forceLogout(); return true;');
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
  }

  async function sincronizar() {
    await js('await window.__pc.sync.sincronizarAhora(); return true;');
    await sleep(400);
  }

  return (async () => {

    /* ================================================================ */
    group('21. Fase 5 · un tema que va mal');

    await step('crear un ejercicio difícil y que lo entreguen', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const temas = await js('return await window.pc.topics.list();');
      const tema = temas.find((t) => t.nombre === 'Excepciones') || temas[temas.length - 1];

      const res = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Capturar errores con try',
        description: 'Un programa que no se caiga cuando el usuario escribe letras.',
        instructions: 'Usa try / except ValueError.',
        topicId: tema.id, type: 'normal', difficulty: 'hard',
        xp: 60, maxScore: 5, status: 'published'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      estado.ejercicioFlojo = res.ejercicio.id;
      estado.temaFlojo = tema.nombre;
      await sincronizar();

      await salir();
      await entrarComo(ALUMNO2.correo, ALUMNO2.password);
      await sincronizar();
      const inicio = await js('return await window.pc.submissions.start(' +
        JSON.stringify(estado.ejercicioFlojo) + ');');
      if (!inicio.ok) throw new Error(inicio.error);
      estado.entregaFloja = inicio.submission.id;
      const env = await js('return await window.pc.submissions.submit(' + JSON.stringify(estado.entregaFloja) +
        ', {code: "int(input())\\n"});');
      if (!env.ok) throw new Error(env.error);
      return 'ejercicio del tema ' + tema.nombre + ' entregado por ' + ALUMNO2.nombre;
    });

    await step('una nota baja hace saltar el aviso del tema', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const res = await js('return await window.pc.submissions.grade(' + JSON.stringify(estado.entregaFloja) +
        ', {grade: 1, teacherComment: "Falta capturar la excepción."});');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));

      const datos = await js('return await window.pc.stats.course();');
      const tema = datos.porTema.find((t) => t.tema === estado.temaFlojo);
      if (!tema) throw new Error('el tema no aparece en las estadísticas');
      if (!tema.enDificultad) throw new Error('no marcó el tema: ' + JSON.stringify(tema.motivos));
      if (!datos.temasEnDificultad.some((t) => t.tema === estado.temaFlojo)) {
        throw new Error('no está en la lista de avisos');
      }
      if (!datos.textoCriterio || datos.textoCriterio.indexOf('%') === -1) {
        throw new Error('no explica el criterio: ' + datos.textoCriterio);
      }
      return tema.tema + ' · promedio ' + tema.promedio + ' · motivos: ' + tema.motivos.join(' / ');
    });

    await step('el criterio de aviso se puede cambiar y se aplica', async () => {
      const relajado = await js('return await window.pc.stats.setCriterio({promedioMinimoPct: 5,' +
        ' reprobadosMinimoPct: 100, intentosAviso: 20});');
      if (!relajado.ok) throw new Error('no se guardó el criterio');
      const sinAvisos = await js('return await window.pc.stats.course();');
      const cuantos = sinAvisos.temasEnDificultad.length;
      const estricto = await js('return await window.pc.stats.setCriterio({promedioMinimoPct: 60,' +
        ' reprobadosMinimoPct: 33, intentosAviso: 2.5});');
      const conAvisos = await js('return await window.pc.stats.course();');
      if (cuantos >= conAvisos.temasEnDificultad.length) {
        throw new Error('el criterio no cambió nada: ' + cuantos + ' vs ' + conAvisos.temasEnDificultad.length);
      }
      return 'criterio relajado: ' + cuantos + ' aviso(s) · criterio normal: ' +
        conAvisos.temasEnDificultad.length + ' · ' + estricto.texto.slice(0, 60) + '…';
    });

    /* ================================================================ */
    group('22. Fase 5 · las cifras cuadran con la base de datos');

    await step('las estadísticas coinciden con las entregas reales', async () => {
      const datos = await js('return await window.pc.stats.course();');
      const bandeja = await js('return await window.pc.submissions.review({status:"all", limit:200});');
      const calificadas = bandeja.items.filter((s) => s.grade != null);
      if (datos.resumen.calificadas !== calificadas.length) {
        throw new Error('calificadas: estadísticas ' + datos.resumen.calificadas + ' vs bandeja ' + calificadas.length);
      }

      const promedio = calificadas.reduce((a, s) => a + s.grade, 0) / calificadas.length;
      if (Math.abs(promedio - datos.resumen.promedioGeneral) > 0.02) {
        throw new Error('promedio: ' + datos.resumen.promedioGeneral + ' vs ' + promedio.toFixed(2));
      }

      const estudiantes = await js('return await window.pc.users.students();');
      if (datos.resumen.estudiantes !== estudiantes.length) {
        throw new Error('estudiantes: ' + datos.resumen.estudiantes + ' vs ' + estudiantes.length);
      }

      const xp = calificadas.reduce((a, s) => a + (s.xpEarned || 0), 0);
      if (datos.resumen.xpRepartido !== xp) throw new Error('XP: ' + datos.resumen.xpRepartido + ' vs ' + xp);

      return calificadas.length + ' calificadas · promedio ' + datos.resumen.promedioGeneral +
        ' · ' + datos.resumen.xpRepartido + ' XP · ' + datos.resumen.estudiantes + ' estudiante(s)';
    });

    await step('cada gráfica se dibuja con el número de elementos correcto', async () => {
      const datos = await js('return await window.pc.stats.course();');
      await js('window.__pc.irPagina("estadisticas"); return true;');
      await waitFor('document.querySelectorAll("#page-host .chart-card").length >= 5', 15000, 'gráficas');

      const conteo = await js('return Array.from(document.querySelectorAll("#page-host .chart-card")).map(c => ({' +
        ' titulo: c.querySelector("h3").textContent,' +
        ' barras: c.querySelectorAll("rect.chart-bar").length,' +
        ' puntos: c.querySelectorAll("circle.chart-dot").length,' +
        ' vacia: !!c.querySelector(".chart-empty") }));');

      const porTitulo = (t) => conteo.find((c) => c.titulo.indexOf(t) !== -1) || {};
      const temasConNota = datos.porTema.filter((t) => t.promedio != null).length;
      const estudiantesConProgreso = datos.porEstudiante.filter((e) => e.total > 0).length;

      const promedio = porTitulo('Promedio por tema');
      if (!promedio.vacia && promedio.barras !== temasConNota) {
        throw new Error('promedio por tema: ' + promedio.barras + ' barras para ' + temasConNota + ' temas');
      }
      const distribucion = porTitulo('Distribución');
      if (!distribucion.vacia && distribucion.barras !== 5) {
        throw new Error('distribución: ' + distribucion.barras + ' tramos');
      }
      const progreso = porTitulo('Progreso por estudiante');
      if (!progreso.vacia && progreso.barras !== estudiantesConProgreso) {
        throw new Error('progreso: ' + progreso.barras + ' barras para ' + estudiantesConProgreso + ' estudiantes');
      }
      const semana = porTitulo('completados por semana');
      if (!semana.vacia && semana.barras !== datos.porSemana.length) {
        throw new Error('por semana: ' + semana.barras + ' vs ' + datos.porSemana.length);
      }
      const evolucion = porTitulo('Evolución');
      if (!evolucion.vacia && evolucion.puntos !== datos.evolucion.length) {
        throw new Error('evolución: ' + evolucion.puntos + ' puntos vs ' + datos.evolucion.length);
      }

      return conteo.map((c) => c.titulo.split(' ').slice(0, 2).join(' ') + ': ' +
        (c.vacia ? 'sin datos (avisado)' : (c.barras || c.puntos) + ' elementos')).join(' | ');
    });

    await step('el aviso del tema con dificultades se ve en pantalla', async () => {
      /*
       * Cuantos temas quedan por debajo del criterio depende de las notas que
       * haya en ese momento, y eso cambia segun lo que hayan hecho las pruebas
       * anteriores. Para comprobar la PANTALLA se aprieta el criterio hasta que
       * haya al menos un aviso, y luego se deja como estaba.
       */
      const antes = await js('return (await window.pc.stats.course()).criterio;');
      let cuantos = await js('return (await window.pc.stats.course()).temasEnDificultad.length;');
      if (!cuantos) {
        await js('return await window.pc.stats.setCriterio({promedioMinimoPct: 99,' +
          ' reprobadosMinimoPct: 1, intentosAviso: 1});');
        cuantos = await js('return (await window.pc.stats.course()).temasEnDificultad.length;');
        if (!cuantos) throw new Error('ni con el criterio más estricto sale un aviso');
      }
      await js('window.__pc.irPagina("estadisticas"); return true;');
      await waitFor('!!document.querySelector("#page-host .aviso-tema")', 15000, 'el aviso en pantalla');

      const texto = await js('return document.getElementById("page-host").innerText;');
      if (texto.indexOf('Tema con dificultades') === -1) throw new Error('no aparece el aviso');
      if (texto.indexOf('Intentos promedio') === -1) throw new Error('el aviso no trae los números');
      const explica = await js('return !!Array.from(document.querySelectorAll("#page-host .aviso-tema .chart-note"))' +
        '.find(n => n.textContent.indexOf("Se avisa") === 0);');
      if (!explica) throw new Error('no explica el criterio en la propia pantalla');
      if (texto.indexOf('El tema con menor promedio es') === -1) {
        throw new Error('no dice cuál es el tema que peor va');
      }
      await js('return await window.pc.stats.setCriterio(' + JSON.stringify(antes) + ');');
      return cuantos + ' aviso(s) visibles con sus cifras y el criterio explicado';
    });

    /* ================================================================ */
    group('23. Fase 5 · formato .pclass');

    await step('exportar un ejercicio a .pclass', async () => {
      const res = await js('return await window.pc.pclass.exportarA("ejercicio", ' +
        JSON.stringify(estado.ejercicioFlojo) + ', ' + JSON.stringify(estado.exportado) + ');');
      if (!res.ok) throw new Error(res.error);
      if (!fs.existsSync(estado.exportado)) throw new Error('no se creó el archivo');
      const datos = JSON.parse(fs.readFileSync(estado.exportado, 'utf8'));
      if (datos.formato !== 'pclass') throw new Error('formato: ' + datos.formato);
      if (!datos.exercise || datos.exercise.title !== 'Capturar errores con try') {
        throw new Error('contenido inesperado');
      }
      return path.basename(estado.exportado) + ' · ' + Math.round(res.sizeBytes / 1024) + ' KB · versión ' + datos.version;
    });

    await step('exportar una entrega con sus comentarios', async () => {
      const destino = path.join(tmp, 'entrega.pclass');
      const res = await js('return await window.pc.pclass.exportarA("entrega", ' +
        JSON.stringify(estado.entregaFloja) + ', ' + JSON.stringify(destino) + ');');
      if (!res.ok) throw new Error(res.error);
      const d = JSON.parse(fs.readFileSync(destino, 'utf8'));
      const campos = ['studentId', 'studentName', 'exerciseId', 'submissionId', 'attemptNumber', 'code',
        'status', 'startedAt', 'submittedAt', 'timeSpentSec', 'grade', 'maxScore', 'xpEarned',
        'teacherComment', 'feedback'];
      const faltan = campos.filter((c) => d[c] === undefined);
      if (faltan.length) throw new Error('faltan campos: ' + faltan.join(', '));
      if (d.grade !== 1) throw new Error('nota exportada: ' + d.grade);
      return 'entrega de ' + d.studentName + ' · nota ' + d.grade + ' · ' + campos.length + ' campos';
    });

    await step('importar el .pclass avisa de que ya existe', async () => {
      const previa = await js('return await window.pc.pclass.previa(' + JSON.stringify(estado.exportado) + ');');
      if (!previa.ok) throw new Error(JSON.stringify(previa.errores));
      if (!previa.conflicto) throw new Error('no avisó del conflicto');
      if (previa.conflicto.motivo.indexOf('Ya existe') === -1) throw new Error(previa.conflicto.motivo);
      return previa.conflicto.motivo + ' («' + previa.conflicto.title + '»)';
    });

    await step('importar como copia deja el ejercicio idéntico', async () => {
      const antes = await js('return await window.pc.exercises.get(' +
        JSON.stringify(estado.ejercicioFlojo) + ');');
      const res = await js('return await window.pc.pclass.importar(' + JSON.stringify(estado.exportado) +
        ', "nuevo");');
      if (!res.ok) throw new Error(JSON.stringify(res.errores));
      const nuevo = res.ejercicio;
      if (nuevo.id === estado.ejercicioFlojo) throw new Error('sobrescribió el original');
      if (nuevo.status !== 'draft') throw new Error('debería entrar como borrador: ' + nuevo.status);

      const iguales = ['description', 'instructions', 'xp', 'maxScore', 'difficulty', 'type', 'timeLimit'];
      const distintos = iguales.filter((c) => String(nuevo[c]) !== String(antes[c]));
      if (distintos.length) throw new Error('cambiaron: ' + distintos.join(', '));
      if (nuevo.tema !== antes.tema) throw new Error('tema: ' + nuevo.tema + ' vs ' + antes.tema);
      if (nuevo.title.indexOf(antes.title) !== 0) throw new Error('título: ' + nuevo.title);

      const original = await js('return await window.pc.exercises.get(' +
        JSON.stringify(estado.ejercicioFlojo) + ');');
      if (original.status !== antes.status) throw new Error('el original cambió de estado');
      estado.importadoId = nuevo.id;
      return '«' + nuevo.title + '» · mismos ' + iguales.length + ' campos · el original intacto';
    });

    await step('un .pclass corrupto se rechaza con un mensaje claro', async () => {
      fs.writeFileSync(estado.corrupto, '{ esto no es "json" valido', 'utf8');
      const roto = await js('return await window.pc.pclass.abrir(' + JSON.stringify(estado.corrupto) + ');');
      if (roto.ok) throw new Error('aceptó un archivo roto');
      if (!roto.errores.length) throw new Error('sin explicación');

      const incompleto = path.join(tmp, 'incompleto.pclass');
      fs.writeFileSync(incompleto, JSON.stringify({ formato: 'pclass', version: 1, tipo: 'ejercicio' }), 'utf8');
      const res2 = await js('return await window.pc.pclass.abrir(' + JSON.stringify(incompleto) + ');');
      if (res2.ok) throw new Error('aceptó un ejercicio sin contenido');

      const otroFormato = path.join(tmp, 'ajeno.pclass');
      fs.writeFileSync(otroFormato, JSON.stringify({ formato: 'otra-cosa', version: 1 }), 'utf8');
      const res3 = await js('return await window.pc.pclass.abrir(' + JSON.stringify(otroFormato) + ');');
      if (res3.ok) throw new Error('aceptó un formato ajeno');

      return [roto.errores[0], res2.errores[0], res3.errores[0]].join(' · ').slice(0, 150);
    });

    await step('un .pclass se puede ver en modo lectura', async () => {
      const p = js('await window.__pc.estadisticas.verPclass(' + JSON.stringify(estado.exportado) + '); return true;');
      await waitFor('!!document.querySelector(".modal-backdrop")', 10000, 'visor');
      const texto = await js('return document.querySelector(".modal-backdrop").innerText;');
      if (texto.indexOf('Capturar errores con try') === -1) throw new Error('no muestra el ejercicio');
      if (texto.indexOf('solo lectura') === -1) throw new Error('no avisa de que es solo lectura');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await p.catch(() => {});
      return texto.split('\n').filter(Boolean).slice(0, 2).join(' · ');
    });

    /* ================================================================ */
    group('24. Fase 5 · informes');

    await step('el CSV tiene una fila por entrega calificada', async () => {
      const res = await js('return await window.pc.reports.csv(' + JSON.stringify(estado.csv) + ');');
      if (!res.ok) throw new Error(res.error);
      const texto = fs.readFileSync(estado.csv, 'utf8').replace(/^﻿/, '');
      const filas = texto.trim().split(/\r?\n/);
      const datos = await js('return await window.pc.stats.course();');
      if (filas.length - 1 !== datos.resumen.calificadas) {
        throw new Error('CSV con ' + (filas.length - 1) + ' filas y ' + datos.resumen.calificadas + ' calificadas');
      }
      if (filas[0].indexOf('Nota') === -1) throw new Error('cabecera: ' + filas[0]);
      return (filas.length - 1) + ' filas + cabecera · separador ";" · ' +
        Math.round(res.sizeBytes / 1024) + ' KB';
    });

    await step('el JSON del curso trae todo lo importante', async () => {
      const res = await js('return await window.pc.reports.json(' + JSON.stringify(estado.curso) + ');');
      if (!res.ok) throw new Error(res.error);
      const d = JSON.parse(fs.readFileSync(estado.curso, 'utf8'));
      for (const clave of ['estadisticas', 'usuarios', 'temas', 'ejercicios', 'entregas', 'feedback',
        'insignias', 'insigniasConcedidas', 'premios']) {
        if (d[clave] === undefined) throw new Error('falta ' + clave);
      }
      return Object.keys(d).length + ' bloques · ' + d.entregas.length + ' entregas · ' +
        d.insigniasConcedidas.length + ' insignia(s) concedida(s)';
    });

    await step('el informe imprimible de un estudiante se genera', async () => {
      const estudiantes = await js('return await window.pc.users.students();');
      const alumno = estudiantes[0];
      const res = await js('return await window.pc.reports.student(' + JSON.stringify(alumno.uid) + ', ' +
        JSON.stringify(estado.informe) + ');');
      if (!res.ok) throw new Error(res.error);
      const html = fs.readFileSync(estado.informe, 'utf8');
      if (html.indexOf('<!doctype html>') !== 0) throw new Error('no es HTML');
      if (html.indexOf(alumno.nombreCompleto) === -1) throw new Error('no lleva el nombre del estudiante');
      for (const seccion of ['Progreso por tema', 'Entregas', 'Insignias', 'Comentarios por línea']) {
        if (html.indexOf(seccion) === -1) throw new Error('falta la sección ' + seccion);
      }
      if (html.indexOf('@media print') === -1) throw new Error('no tiene estilos de impresión');
      return alumno.nombreCompleto + ' · ' + Math.round(res.sizeBytes / 1024) + ' KB · 4 secciones';
    });

    /* ================================================================ */
    group('25. Fase 5 · importar una copia de seguridad');

    await step('la vista previa dice qué entra y qué chocaría', async () => {
      const copia = path.join(tmp, 'copia.json');
      const curso = JSON.parse(fs.readFileSync(estado.curso, 'utf8'));
      fs.writeFileSync(copia, JSON.stringify({
        exportadoEn: new Date().toISOString(),
        esquema: 3,
        academico: {
          temarios: curso.temas,
          ejercicios: curso.ejercicios,
          entregas: curso.entregas,
          feedback: curso.feedback
        }
      }), 'utf8');
      estado.copia = copia;

      const previa = await js('return await window.pc.backups.importPreview(' + JSON.stringify(copia) + ');');
      if (!previa.ok) throw new Error(previa.error);
      if (!previa.totalConflictos) throw new Error('debería avisar de que ya existe todo');
      if (previa.totalFilas !== previa.totalConflictos) {
        throw new Error('filas ' + previa.totalFilas + ' vs conflictos ' + previa.totalConflictos);
      }
      return previa.bloques.map((b) => b.etiqueta + ' ' + b.total + ' (' + b.conflictos + ' repetidas)').join(' · ');
    });

    await step('importar conservando lo mío no pisa nada', async () => {
      const antes = await js('return await window.pc.exercises.get(' +
        JSON.stringify(estado.ejercicioFlojo) + ');');
      const res = await js('return await window.pc.backups.import(' + JSON.stringify(estado.copia) + ', "omitir");');
      if (!res.ok) throw new Error(res.error);
      if (res.sobrescritos !== 0) throw new Error('sobrescribió ' + res.sobrescritos);
      if (!res.omitidos) throw new Error('no conservó nada');
      if (!res.copiaPrevia) throw new Error('no hizo copia de seguridad previa');
      const despues = await js('return await window.pc.exercises.get(' +
        JSON.stringify(estado.ejercicioFlojo) + ');');
      if (despues.updatedAt !== antes.updatedAt) throw new Error('modificó el ejercicio existente');
      return res.omitidos + ' fila(s) conservadas · copia previa ' + res.copiaPrevia;
    });

    await step('importar una copia con datos nuevos los añade', async () => {
      const copia = path.join(tmp, 'copia-nueva.json');
      fs.writeFileSync(copia, JSON.stringify({
        exportadoEn: new Date().toISOString(),
        academico: {
          temarios: [{
            id: 'topic_importado_e2e',
            name: 'Tema importado',
            description: 'Llegó en una copia de seguridad.',
            orderIndex: 99,
            status: 'active',
            color: '#57c7d4',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }]
        }
      }), 'utf8');
      const res = await js('return await window.pc.backups.import(' + JSON.stringify(copia) + ', "omitir");');
      if (!res.ok) throw new Error(res.error);
      if (res.insertados !== 1) throw new Error('insertados: ' + res.insertados);
      const temas = await js('return await window.pc.topics.list();');
      if (!temas.some((t) => t.nombre === 'Tema importado')) throw new Error('el tema no aparece');
      return '1 tema nuevo añadido sin tocar lo demás';
    });

  })();
};
