'use strict';
/*
 * Pruebas de extremo a extremo de la FASE 4 (gamificacion).
 *
 * Comprueban lo que pide el pliego de la fase:
 *   catalogo de insignias, insignia manual, concesion automatica al calificar,
 *   vitrina del estudiante, no conceder dos veces, reglas de seguridad,
 *   ranking general y por posicion propia, ranking sin conexion, y un reto con
 *   ejercicio asociado que se resuelve y da premio.
 *
 * Se apoyan en el mismo doble de Firebase que la fase 3
 * (src/js/test/fake-firebase.js), que aplica una version reducida de las
 * Security Rules.
 */

const fase3 = require('./e2e-fase3.js');

const PROFE = fase3.PROFE;
const ALUMNO = fase3.ALUMNO;

const ALUMNO2 = {
  nombre: 'Lucía', apellido: 'Beltrán',
  correo: 'lucia.beltran@colegio.edu.co',
  password: 'alumna2026',
  grado: '10', grupo: 'B'
};

module.exports = function fase4(h) {
  const { js, waitFor, step, group, sleep } = h;

  const estado = {
    ejercicioId: null,       // ejercicio normal
    retoEjercicioId: null,   // ejercicio asociado al reto
    retoId: null,
    insigniaManualId: null,
    alumnoUid: null,
    alumna2Uid: null,
    entregaNormal: null,
    entregaReto: null,
    cursoId: null
  };

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
    // Entrar termina antes de que la sincronizacion sepa quien entro: se espera.
    await waitFor('window.__pc.sync.estadoActual().activo === true', 15000, 'sincronización lista');
  }

  async function registrar(datos) {
    // El alta pide el código de la clase: se toma el del profesor.
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

  /** Entrega un ejercicio como el estudiante que tiene la sesion abierta. */
  async function resolverYEntregar(exerciseId, codigo) {
    const inicio = await js('return await window.pc.submissions.start(' + JSON.stringify(exerciseId) + ');');
    if (!inicio.ok) throw new Error(inicio.error);
    const res = await js('return await window.pc.submissions.submit(' +
      JSON.stringify(inicio.submission.id) + ', {code: ' + JSON.stringify(codigo) + '});');
    if (!res.ok) throw new Error(res.error);
    return inicio.submission.id;
  }

  return (async () => {

    /* ================================================================ */
    group('16. Fase 4 · catálogo de insignias y premios (profesor)');

    await step('el profesor carga el catálogo sugerido de insignias', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const curso = await js('return await window.pc.courses.active();');
      if (!curso) throw new Error('sin curso activo');
      estado.cursoId = curso.id;
      const res = await js('return await window.pc.badges.seed();');
      if (!res.ok) throw new Error('no se pudo cargar el catálogo');
      const lista = await js('return await window.pc.badges.list();');
      if (lista.length < 7) throw new Error('solo hay ' + lista.length + ' insignias');
      const auto = lista.filter((b) => b.type === 'auto');
      if (auto.length < 7) throw new Error('insignias automáticas: ' + auto.length);
      return res.creadas + ' creadas · ' + lista.map((b) => b.name).slice(0, 4).join(', ') + '…';
    });

    await step('cargar el catálogo dos veces no duplica nada', async () => {
      const antes = (await js('return await window.pc.badges.list();')).length;
      const res = await js('return await window.pc.badges.seed();');
      const despues = (await js('return await window.pc.badges.list();')).length;
      if (antes !== despues) throw new Error(antes + ' -> ' + despues);
      return res.creadas + ' nuevas · siguen ' + despues;
    });

    await step('crear una insignia manual con premio', async () => {
      const res = await js('return await window.pc.badges.save(' + JSON.stringify({
        name: 'Maestro de funciones',
        description: 'Premio del reto del número secreto.',
        icon: 'target', color: '#c58cf5', type: 'manual', xpBonus: 40
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      estado.insigniaManualId = res.insignia.id;
      return res.insignia.name + ' · manual · +' + res.insignia.xpBonus + ' XP';
    });

    await step('una regla automática inválida se rechaza', async () => {
      const res = await js('return await window.pc.badges.save(' + JSON.stringify({
        name: 'Insignia imposible', type: 'auto', rule: { tipo: 'leer_la_mente', n: 3 }
      }) + ');');
      if (res.ok) throw new Error('aceptó una condición inventada');
      return (res.errores && res.errores.rule) || res.error;
    });

    await step('crear los ejercicios de la fase 4 y publicarlos', async () => {
      const temas = await js('return await window.pc.topics.list();');
      const tema = temas.find((t) => t.nombre === 'Ciclos') || temas[0];

      const normal = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Contar hasta diez',
        description: 'Un ciclo que imprime del 1 al 10.',
        instructions: 'Usa un for para imprimir los números del 1 al 10.',
        topicId: tema.id, type: 'normal', difficulty: 'easy',
        xp: 40, maxScore: 5, status: 'published'
      }) + ');');
      if (!normal.ok) throw new Error(JSON.stringify(normal.errores || normal.error));
      estado.ejercicioId = normal.ejercicio.id;

      const reto = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'El número secreto',
        description: 'Adivina el número con pistas.',
        instructions: 'Pide números hasta acertar el secreto.',
        topicId: tema.id, type: 'challenge', difficulty: 'hard',
        xp: 120, maxScore: 5, status: 'published'
      }) + ');');
      if (!reto.ok) throw new Error(JSON.stringify(reto.errores || reto.error));
      estado.retoEjercicioId = reto.ejercicio.id;

      return normal.ejercicio.title + ' y ' + reto.ejercicio.title + ' publicados';
    });

    await step('crear el reto con su ejercicio asociado y publicarlo', async () => {
      const res = await js('return await window.pc.challenges.save(' + JSON.stringify({
        title: 'Reto del número secreto',
        description: 'Resuélvelo y llévate la insignia.',
        difficulty: 'hard', xp: 120, maxAttempts: 2, status: 'published',
        exerciseId: estado.retoEjercicioId
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      estado.retoId = res.reto.id;
      if (res.reto.exerciseId !== estado.retoEjercicioId) throw new Error('no quedó asociado al ejercicio');
      if (!res.reto.disponible) throw new Error('el reto no está disponible');
      return res.reto.title + ' · ejercicio asociado · disponible';
    });

    await step('configurar el premio del reto', async () => {
      const res = await js('return await window.pc.rewards.save(' + JSON.stringify({
        scope: 'challenge', challengeId: null, badgeId: null, title: 'Premio del reto'
      }) + ');');
      if (res.ok) throw new Error('aceptó un premio de reto sin reto');

      const bueno = await js('return await window.pc.rewards.save(' + JSON.stringify({
        scope: 'challenge',
        challengeId: estado.retoId,
        badgeId: estado.insigniaManualId,
        title: 'Premio del reto del número secreto',
        description: 'Se concede al calificar la entrega del reto.'
      }) + ');');
      if (!bueno.ok) throw new Error(JSON.stringify(bueno.errores || bueno.error));
      if (!bueno.premio.insignia) throw new Error('el premio quedó sin insignia');
      return bueno.premio.title + ' → insignia ' + bueno.premio.insignia.name;
    });

    await step('el catálogo y los premios se publican en Firebase', async () => {
      await sincronizar();
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const insignias = Object.keys(arbol.badges || {}).length;
      const premios = Object.keys(arbol.rewards || {}).length;
      if (insignias < 8) throw new Error('badges/ tiene ' + insignias);
      if (!premios) throw new Error('rewards/ vacío');
      return 'badges/ con ' + insignias + ' · rewards/ con ' + premios;
    });

    /* ================================================================ */
    group('17. Fase 4 · concesión automática al calificar');

    await step('el estudiante entrega el ejercicio nuevo', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();
      const yo = await js('return await window.pc.session.me();');
      estado.alumnoUid = yo.uid;
      estado.entregaNormal = await resolverYEntregar(estado.ejercicioId,
        'for i in range(1, 11):\n    print(i)\n');
      const s = await js('return await window.pc.submissions.get(' + JSON.stringify(estado.entregaNormal) + ');');
      if (['submitted', 'late'].indexOf(s.status) === -1) throw new Error('estado: ' + s.status);
      return 'entrega ' + s.attemptNumber + ' en estado ' + s.status;
    });

    await step('antes de calificar el estudiante no tiene ninguna insignia', async () => {
      const vitrina = await js('return await window.pc.badges.mine();');
      if (vitrina.conseguidas !== 0) throw new Error('ya tenía ' + vitrina.conseguidas);
      if (!vitrina.insignias.length) throw new Error('no ve el catálogo');
      const primera = vitrina.insignias.find((b) => b.name === 'Pythonista');
      if (!primera) throw new Error('no ve la insignia Pythonista');
      if (primera.conseguida) throw new Error('aparece como conseguida sin calificar');
      return vitrina.total + ' insignias visibles · 0 conseguidas · "' + primera.comoSeConsigue + '"';
    });

    await step('al calificar se concede la insignia de primera entrega', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const res = await js('return await window.pc.submissions.grade(' + JSON.stringify(estado.entregaNormal) +
        ', {grade: 5, teacherComment: "Perfecto."});');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      const nombres = (res.insigniasNuevas || []).map((b) => b.name);
      if (nombres.indexOf('Pythonista') === -1) {
        throw new Error('insignias concedidas: ' + JSON.stringify(nombres));
      }
      return nombres.join(', ') + ' (nota 5 / 5)';
    });

    await step('recalificar no concede la misma insignia dos veces', async () => {
      const antes = await js('return (await window.pc.badges.holders(null)).length;');
      const res = await js('return await window.pc.submissions.grade(' + JSON.stringify(estado.entregaNormal) +
        ', {grade: 4.5, teacherComment: "Ajuste de nota.", reason: "Revisión posterior"});');
      if (!res.ok) throw new Error(res.error);
      const despues = await js('return (await window.pc.badges.holders(null)).length;');
      if (despues !== antes) throw new Error('concesiones: ' + antes + ' -> ' + despues);
      if ((res.insigniasNuevas || []).length) {
        throw new Error('volvió a conceder: ' + JSON.stringify(res.insigniasNuevas.map((b) => b.name)));
      }
      return antes + ' concesión(es) antes y después · sin duplicados';
    });

    await step('la insignia aparece en la vitrina con fecha y motivo', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();
      const vitrina = await js('return await window.pc.badges.mine();');
      const b = vitrina.insignias.find((x) => x.name === 'Pythonista');
      if (!b || !b.conseguida) throw new Error('no la tiene en la vitrina');
      if (!b.grantedAt) throw new Error('sin fecha de concesión');
      if (!b.reason) throw new Error('sin motivo');

      // Una insignia automatica que todavia esta lejos: su ficha tiene que decir
      // cuanto le falta, con numeros (seccion 8 del pliego de la fase 4).
      const lejana = vitrina.insignias.find((x) => !x.conseguida && x.type === 'auto' &&
        x.avance && x.avance.objetivo > 1 && (x.avance.actual || 0) < x.avance.objetivo);
      if (!lejana) {
        throw new Error('ninguna insignia pendiente con avance medible: ' +
          JSON.stringify(vitrina.insignias.map((x) => x.name + '=' + x.comoSeConsigue)));
      }
      if (!/falta/i.test(lejana.comoSeConsigue)) {
        throw new Error('«' + lejana.name + '» no dice qué falta: ' + lejana.comoSeConsigue);
      }

      await js('window.__pc.irPagina("inicio"); return true;');
      /*
       * Se espera la ficha EN COLOR, no una cualquiera: la vitrina puede pintarse
       * un instante antes de que la sincronizacion aplique la concesion, y en ese
       * momento solo hay fichas bloqueadas.
       */
      await waitFor('document.querySelectorAll("#page-host .badge-tile:not(.bloqueada)").length > 0',
        15000, 'insignia conseguida en la vitrina');
      /*
       * La pagina se repinta cada vez que llega algo nuevo, asi que entre la
       * espera y la lectura puede quedar un instante vacio: se reintenta.
       */
      const leerVitrina = () => js('return {' +
        ' fichas: document.querySelectorAll("#page-host .badge-tile").length,' +
        ' conseguidas: document.querySelectorAll("#page-host .badge-tile:not(.bloqueada)").length,' +
        ' bloqueadas: document.querySelectorAll("#page-host .badge-tile.bloqueada").length,' +
        ' notas: Array.from(document.querySelectorAll("#page-host .badge-tile.bloqueada .bt-note")).map(n=>n.textContent),' +
        ' texto: document.getElementById("page-host").innerText };');

      let info = await leerVitrina();
      for (let i = 0; i < 8 && info.conseguidas < 1; i++) {
        await sleep(700);
        info = await leerVitrina();
      }
      if (info.conseguidas < 1) throw new Error('ninguna ficha en color de ' + info.fichas);
      if (info.bloqueadas < 1) throw new Error('no muestra las que faltan en gris');
      if (info.texto.indexOf('Mis insignias') === -1) throw new Error('sin sección de insignias');
      if (info.notas.some((t) => !String(t).trim())) throw new Error('hay fichas bloqueadas sin explicación');
      if (!info.notas.some((t) => /falta/i.test(t))) {
        throw new Error('ninguna ficha bloqueada dice qué falta: ' + JSON.stringify(info.notas));
      }
      return info.conseguidas + ' en color · ' + info.bloqueadas + ' en gris · «' + lejana.name + '»: ' +
        lejana.comoSeConsigue;
    });

    /* ================================================================ */
    group('18. Fase 4 · reglas de seguridad de la gamificación');

    await step('un estudiante no puede escribir en userBadges/', async () => {
      const salida = await js(
        'const fb = window.__pcFakeFirebase;' +
        'const uid = (await window.pc.session.me()).uid;' +
        'const insignias = await window.pc.badges.list();' +
        'const otra = insignias.find(b => b.name === "Maestro de funciones") || insignias[0];' +
        'try {' +
        '  await fb.dbSet(fb.ref(fb._db, "courses/' + estado.cursoId + '/userBadges/" + uid + "/" + otra.id),' +
        '    { studentId: uid, badgeId: otra.id, grantedAt: new Date().toISOString(), reason: "me la doy yo" });' +
        '  return "ESCRIBIO";' +
        '} catch (e) { return e.message; }');
      if (salida === 'ESCRIBIO') throw new Error('¡el estudiante se concedió una insignia!');
      if (salida.indexOf('PERMISSION_DENIED') !== 0) throw new Error('error inesperado: ' + salida);
      return salida;
    });

    await step('un estudiante no puede tocar badges/, rewards/ ni rankings/', async () => {
      const salida = await js(
        'const fb = window.__pcFakeFirebase;' +
        'const out = {};' +
        'for (const ruta of ["badges/inventada", "rewards/inventado", "rankings"]) {' +
        '  try { await fb.dbSet(fb.ref(fb._db, ruta), { name: "trampa" }); out[ruta] = "ESCRIBIO"; }' +
        '  catch (e) { out[ruta] = e.code || e.message; }' +
        '}' +
        'return out;');
      const malas = Object.entries(salida).filter(([, v]) => v === 'ESCRIBIO').map(([k]) => k);
      if (malas.length) throw new Error('pudo escribir en: ' + malas.join(', '));
      return Object.keys(salida).join(', ') + ' rechazados';
    });

    /* ================================================================ */
    group('19. Fase 4 · rankings');

    await step('el ranking general está ordenado por XP', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const r = await js('return await window.pc.rankings.get();');
      if (!r.disponible) throw new Error(r.motivo);
      if (!r.global.length) throw new Error('ranking vacío');
      for (let i = 1; i < r.global.length; i++) {
        if (r.global[i - 1].xp < r.global[i].xp) {
          throw new Error('orden incorrecto en la posición ' + (i + 1));
        }
      }
      if (r.global[0].position !== 1) throw new Error('el primero no tiene posición 1');
      return r.global.map((e) => e.position + '. ' + e.name + ' ' + e.xp + ' XP').join('  |  ');
    });

    await step('el ranking se publica en Firebase al calificar', async () => {
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      if (!delCurso.rankings || !delCurso.rankings.global) throw new Error('no hay nodo rankings/');
      const conInsignias = delCurso.rankings.global.filter((e) => e.badges != null).length;
      if (!conInsignias) throw new Error('el ranking no lleva el número de insignias');
      return delCurso.rankings.global.length + ' estudiante(s) publicados · ' +
        'actualizado ' + String(delCurso.rankings.updatedAt).slice(0, 19);
    });

    await step('el profesor limita los puestos visibles', async () => {
      const res = await js('return await window.pc.rankings.setConfig({limitePuestos: 1});');
      if (res.limitePuestos !== 1) throw new Error('quedó en ' + res.limitePuestos);
      await sincronizar();
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      if (delCurso.rankingLimit !== 1) {
        const cola = await js('return { stats: await window.pc.sync.stats(),' +
          ' pendientes: (await window.pc.sync.pending(20)).map(i => i.entity + "/" + i.entityId +' +
          '   " [" + i.status + "] " + (i.lastError || "")) };');
        throw new Error('courses/' + estado.cursoId + '/rankingLimit = ' + delCurso.rankingLimit +
          ' · cola: ' + JSON.stringify(cola));
      }
      return 'límite 1 guardado en config/rankingLimit';
    });

    await step('un segundo estudiante entra en el ranking', async () => {
      await salir();
      await registrar(ALUMNO2);
      await sincronizar();
      const yo = await js('return await window.pc.session.me();');
      estado.alumna2Uid = yo.uid;
      if (yo.rol !== 'estudiante') throw new Error('rol: ' + yo.rol);

      // El ranking lo publica el profesor: hasta que no vuelve a sincronizar, la
      // copia que hay en Firebase es la anterior al registro.
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const delProfesor = await js('return await window.pc.rankings.get();');
      if (!delProfesor.global.some((e) => e.uid === estado.alumna2Uid)) {
        throw new Error('la nueva estudiante no aparece en el ranking del profesor');
      }

      await salir();
      await entrarComo(ALUMNO2.correo, ALUMNO2.password);
      await sincronizar();
      const r = await js('return await window.pc.rankings.get();');
      if (!r.disponible) throw new Error(r.motivo);
      return yo.nombreCompleto + ' registrada · ranking descargado con ' + r.total + ' estudiante(s)';
    });

    await step('el estudiante ve su posición aunque quede fuera de la lista', async () => {
      const r = await js('return await window.pc.rankings.get();');
      if (r.limitePuestos !== 1) throw new Error('límite recibido: ' + r.limitePuestos);
      if (r.global.length !== 1) throw new Error('ve ' + r.global.length + ' puesto(s)');
      if (!r.yo) throw new Error('no recibe su propia fila');
      if (!r.yoFueraDeLista) throw new Error('no marca que está fuera de la lista');

      // Se espera el bloque de la posicion propia, no solo que haya filas: si se
      // mira demasiado pronto se puede leer todavia el ranking del profesor.
      await js('window.__pc.irPagina("rankings"); return true;');
      await waitFor('!!document.querySelector("#page-host .rk-sep") &&' +
        ' document.querySelectorAll("#page-host .rk-row.mia").length > 0', 15000, 'mi posición en el ranking');
      const info = await js('return {' +
        ' filas: document.querySelectorAll("#page-host .rk-row").length,' +
        ' mia: document.querySelectorAll("#page-host .rk-row.mia").length,' +
        ' separador: !!document.querySelector("#page-host .rk-sep"),' +
        ' texto: document.getElementById("page-host").innerText };');
      if (!info.separador) throw new Error('no aparece el bloque TU POSICIÓN');
      if (!info.mia) throw new Error('no resalta su fila');
      if (info.texto.indexOf('TU POSICIÓN') === -1) throw new Error('sin encabezado de posición propia');
      return 'puesto ' + r.yo.position + ' de ' + r.total + ' · lista limitada a ' + r.global.length +
        ' · su fila se muestra aparte';
    });

    await step('sin conexión se muestra el ranking descargado con su fecha', async () => {
      await js('window.__pcFakeFirebase._simularSinRed(true); return true;');
      const r = await js('return await window.pc.rankings.get();');
      if (!r.disponible) throw new Error('perdió el ranking sin conexión');
      if (r.fuente !== 'descargado') throw new Error('fuente: ' + r.fuente);
      if (!r.descargadoEn) throw new Error('sin fecha de descarga');
      await js('window.__pc.irPagina("rankings"); return true;');
      await waitFor('!!document.querySelector("#page-host .rk-estado")', 10000, 'estado del ranking');
      const texto = await js('return document.querySelector("#page-host .rk-estado").innerText;');
      if (texto.indexOf('Actualizado') === -1) throw new Error('no informa de cuándo: ' + texto);
      await js('window.__pcFakeFirebase._simularSinRed(false); return true;');
      return texto.replace(/\s+/g, ' ').trim();
    });

    await step('el ranking por tema y por grado tienen datos', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const r = await js('return await window.pc.rankings.get();');
      const temas = Object.keys(r.topics || {});
      const grados = Object.keys(r.grades || {});
      if (!temas.length) throw new Error('ranking por tema vacío');
      if (!grados.length) throw new Error('ranking por grado vacío');
      await js('window.__pc.irPagina("rankings"); return true;');
      await waitFor('document.querySelectorAll("#page-host .filtro-barra .btn").length >= 3', 10000, 'pestañas');
      return temas.length + ' tema(s) con ranking · grados: ' + grados.join(', ');
    });

    /* ================================================================ */
    group('20. Fase 4 · retos resolubles y premios');

    await step('el estudiante ve el reto en la página de ejercicios', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      await sincronizar();
      await js('window.__pc.irPagina("ejercicios"); return true;');
      await waitFor('document.getElementById("page-host").innerText.indexOf("Retos") !== -1', 12000, 'sección de retos');
      const texto = await js('return document.getElementById("page-host").innerText;');
      if (texto.indexOf('Reto del número secreto') === -1) throw new Error('no aparece el reto');
      if (texto.indexOf('Maestro de funciones') === -1) throw new Error('no muestra el premio del reto');
      const boton = await js('return Array.from(document.querySelectorAll("#page-host .ex-card.reto .btn"))' +
        '.map(b=>b.textContent).join(" | ");');
      if (boton.indexOf('reto') === -1) throw new Error('sin botón para aceptar el reto: ' + boton);
      return 'reto visible con su premio · botones: ' + boton;
    });

    await step('el reto se resuelve con el flujo normal de ejercicios', async () => {
      const lista = await js('return await window.pc.exercises.list();');
      const ej = lista.find((e) => e.title === 'El número secreto');
      if (!ej) throw new Error('el estudiante no ve el ejercicio del reto');
      await js('await window.__pc.sesionEjercicio.abrir(' + JSON.stringify(ej.id) + '); return true;');
      await waitFor('!!window.__pc.sesionEjercicio.sesionActiva()', 15000, 'sesión del reto');
      const s = await js('const a = window.__pc.sesionEjercicio.sesionActiva();' +
        'return { id: a.submissionId, titulo: a.exercise.title };');
      estado.entregaReto = s.id;
      await js('window.__pc.sesionEjercicio.cerrar(); return true;');
      const res = await js('return await window.pc.submissions.submit(' + JSON.stringify(s.id) +
        ', {code: "secreto = 7\\nprint(\\"acertaste\\")\\n"});');
      if (!res.ok) throw new Error(res.error);
      return s.titulo + ' entregado desde la misma sesión de ejercicio (' + res.submission.status + ')';
    });

    await step('al calificar el reto se concede el premio configurado', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();
      const res = await js('return await window.pc.submissions.grade(' + JSON.stringify(estado.entregaReto) +
        ', {grade: 5, teacherComment: "Muy bien resuelto."});');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      const nombres = (res.insigniasNuevas || []).map((b) => b.name);
      if (nombres.indexOf('Maestro de funciones') === -1) {
        throw new Error('no concedió el premio del reto: ' + JSON.stringify(nombres));
      }
      const tiene = await js('return await window.pc.badges.holders(' +
        JSON.stringify(estado.insigniaManualId) + ');');
      if (!tiene.some((t) => t.studentId === estado.alumnoUid)) throw new Error('el premio no quedó registrado');
      const motivo = tiene.find((t) => t.studentId === estado.alumnoUid).reason;
      return nombres.join(', ') + ' · motivo: "' + motivo + '"';
    });

    await step('la concesión manual queda con su motivo escrito', async () => {
      const insignias = await js('return await window.pc.badges.list();');
      const velocista = insignias.find((b) => b.name === 'Velocista');
      const res = await js('return await window.pc.badges.grant(' + JSON.stringify(estado.alumna2Uid) + ', ' +
        JSON.stringify(velocista.id) + ', "Excelente trabajo durante el proyecto.");');
      if (!res.ok) throw new Error(res.error);
      if (res.repetida) throw new Error('la marcó como repetida');
      const otra = await js('return await window.pc.badges.grant(' + JSON.stringify(estado.alumna2Uid) + ', ' +
        JSON.stringify(velocista.id) + ', "otra vez");');
      if (!otra.repetida) throw new Error('permitió concederla dos veces');
      const holders = await js('return await window.pc.badges.holders(' + JSON.stringify(velocista.id) + ');');
      const suyas = holders.filter((x) => x.studentId === estado.alumna2Uid);
      if (suyas.length !== 1) throw new Error('concesiones a la misma persona: ' + suyas.length);
      if (suyas[0].reason.indexOf('Excelente trabajo') === -1) throw new Error('motivo: ' + suyas[0].reason);
      return suyas[0].nombre + ' · "' + suyas[0].reason + '" · segunda concesión ignorada';
    });

    await step('las insignias concedidas viajan a Firebase', async () => {
      await sincronizar();
      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const delCurso = (arbol.courses && arbol.courses[estado.cursoId]) || {};
      const uids = Object.keys(delCurso.userBadges || {});
      if (uids.length < 2) throw new Error('userBadges/ tiene ' + uids.length + ' estudiante(s)');
      const delAlumno = Object.keys(delCurso.userBadges[estado.alumnoUid] || {}).length;
      if (!delAlumno) throw new Error('el alumno no tiene nada en userBadges/');
      return uids.length + ' estudiante(s) con insignias · el alumno tiene ' + delAlumno;
    });

    await step('el panel de premios del profesor se pinta', async () => {
      await js('window.__pc.exercises.irPestana("premios"); window.__pc.irPagina("ejercicios"); return true;');
      await waitFor('document.getElementById("page-host").innerText.indexOf("Catálogo de insignias") !== -1',
        12000, 'panel de premios');
      const info = await js('return {' +
        ' filas: document.querySelectorAll("#page-host .list-row").length,' +
        ' pestanas: Array.from(document.querySelectorAll("#page-host .filtro-barra .btn")).map(b=>b.textContent) };');
      if (info.filas < 5) throw new Error('solo ' + info.filas + ' insignias en el panel');
      await js('window.__pc.exercises.irPestana("ejercicios"); return true;');
      return info.filas + ' insignias · pestañas: ' + info.pestanas.join(', ');
    });

  })();
};

module.exports.ALUMNO2 = ALUMNO2;
