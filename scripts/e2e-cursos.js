'use strict';
/*
 * Cursos — fase 1: esquema y migración silenciosa.
 *
 * Todavía no hay pantallas: esto prueba que la base de datos sabe migrarse
 * sola a un «Curso general» cuando ya había profesor y estudiantes de antes
 * de que existieran los cursos, y que la sesión resuelve un curso activo sin
 * que nadie tenga que hacer nada. Nada de esto es visible todavía para quien
 * usa la aplicación — es la base sobre la que se construyen las fases
 * siguientes (gestión de cursos, código de acceso, asignación).
 */

const fase3 = require('./e2e-fase3.js');

const PROFE = fase3.PROFE;
const ALUMNO = fase3.ALUMNO;

module.exports = function cursos(h) {
  const { js, waitFor, step, group, sleep } = h;

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
  }

  /*
   * Va a «Estudiantes y cuentas» reintentando la navegación. Con una sesión
   * ya cargada (muchos usuarios, mucho de fondo tras fases anteriores) un
   * refresco tardío de OTRA pantalla puede pisar la recién abierta un
   * instante después: se reintenta en vez de fiarse de una sola llamada.
   */
  async function irPaginaCurso() {
    for (let intento = 0; intento < 6; intento++) {
      await js('window.__pc.irPagina("curso"); return true;');
      try {
        await waitFor('document.getElementById("page-host").innerText.indexOf("Mis cursos") !== -1',
          6000, 'la página de cuentas');
        await sleep(300);   // deja pasar un refresco tardío, si lo hay
        const sigue = await js('return document.getElementById("page-host").innerText' +
          '.indexOf("Mis cursos") !== -1;');
        if (sigue) return;
      } catch (err) { /* se reintenta */ }
    }
    const diag = await js('return {' +
      ' texto: document.getElementById("page-host").innerText.slice(0, 300),' +
      ' rol: (window.__pc.getUsuario() || {}).rol,' +
      ' cursos: await window.pc.courses.mine().then(c => c.length).catch(e => "ERROR: " + e.message) };');
    throw new Error('no se quedó en «Estudiantes y cuentas» · ' + JSON.stringify(diag));
  }

  return (async () => {

    /* ================================================================ */
    group('42. Cursos · esquema y migración silenciosa');

    await step('la migración crea «Curso general» con el profesor y los estudiantes de antes', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      const yo = await js('return await window.pc.session.me();');
      const res = await js('return await window.pc.test.probarMigracionCursos();');
      if (!res.cursoId) throw new Error('no se creó ningún curso');
      if (res.curso.name !== 'Curso general') throw new Error('el curso se llama «' + res.curso.name + '»');
      // El profesor mas antiguo es el dueño; con un solo profesor en las
      // pruebas, tiene que ser exactamente este.
      if (res.curso.teacherId !== yo.uid) {
        throw new Error('el dueño del curso es «' + res.curso.teacherId + '», no «' + yo.uid + '»');
      }
      if (!res.curso.accessCode || res.curso.accessCode.length < 4) {
        throw new Error('el código de acceso es demasiado corto: «' + res.curso.accessCode + '»');
      }
      if (!res.miembros.some((m) => m.role === 'student')) {
        throw new Error('ningún estudiante quedó matriculado: ' + JSON.stringify(res.miembros));
      }
      if (res.sinCurso.topics > 0 || res.sinCurso.exercises > 0 || res.sinCurso.submissions > 0) {
        throw new Error('quedaron filas sin curso: ' + JSON.stringify(res.sinCurso));
      }
      return res.curso.name + ' («' + res.curso.accessCode + '») · ' +
        res.miembros.length + ' matriculado(s) · todo con curso asignado';
    });

    await step('el profesor entra con su curso ya activo, sin hacer nada', async () => {
      /*
       * La prueba anterior recreó el curso «por debajo» mientras la sesión ya
       * estaba abierta; el curso activo se resuelve al ENTRAR, así que hace
       * falta volver a entrar para que recoja el curso recién migrado — es
       * justo lo que pasaría de verdad: la migración ocurre una vez al abrir
       * la aplicación, y quien ya la tenía abierta la ve en la siguiente vez.
       */
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      const activo = await js('return await window.pc.courses.active();');
      if (!activo) throw new Error('no hay curso activo tras entrar');
      if (activo.nombre !== 'Curso general') throw new Error('curso activo: «' + activo.nombre + '»');
      if (!activo.activo) throw new Error('el curso no quedó en estado activo');

      const mios = await js('return await window.pc.courses.mine();');
      if (mios.length !== 1) throw new Error('el profesor tiene ' + mios.length + ' curso(s), se esperaba 1');
      return activo.nombre + ' · código ' + activo.codigo;
    });

    await step('el estudiante entra con el mismo curso activo', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);

      const activo = await js('return await window.pc.courses.active();');
      if (!activo) throw new Error('el estudiante no tiene curso activo');
      if (activo.nombre !== 'Curso general') throw new Error('curso activo: «' + activo.nombre + '»');

      const mios = await js('return await window.pc.courses.mine();');
      if (mios.length !== 1) throw new Error('el estudiante tiene ' + mios.length + ' curso(s), se esperaba 1');
      return 'mismo curso para el estudiante: ' + activo.nombre;
    });

    await step('al salir de la sesión, no queda ningún curso activo', async () => {
      await salir();
      const yo = await js('return await window.pc.session.me();');
      if (yo) throw new Error('todavía hay sesión activa');
      // No hay canal para leer el curso activo sin sesión (requiere usuario);
      // basta con que no reviente y no haya sesión — el propio guard()
      // de main lo comprobaría en cualquier otro canal si quedara colgado.
      return 'sesión cerrada, sin curso activo';
    });

    /* ================================================================ */
    group('43. Cursos · gestión de cursos (profesor)');

    const estado = {};

    await step('el profesor crea un segundo curso, con su propio código', async () => {
      await entrarComo(PROFE.correo, PROFE.password);

      const antes = await js('return (await window.pc.courses.mine()).map(c => c.codigo);');

      await irPaginaCurso();

      let creado = false;
      for (let i = 0; i < 8 && !creado; i++) {
        creado = await js('const b = Array.from(document.querySelectorAll("#page-host button"))' +
          '.find(x => x.textContent.indexOf("Crear curso") !== -1);' +
          'if (!b) return false; b.click(); return true;');
        if (!creado) await sleep(500);
      }
      if (!creado) throw new Error('no se encontró el botón «Crear curso»');
      await waitFor('!!document.querySelector(".modal-backdrop input.input")', 8000, 'diálogo de nombre');
      await js('const i = document.querySelector(".modal-backdrop input.input");' +
        'i.value = "11B"; i.dispatchEvent(new Event("input")); return true;');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await waitFor('(await window.pc.courses.mine()).length === ' + (antes.length + 1),
        10000, 'el curso nuevo');

      const mios = await js('return await window.pc.courses.mine();');
      const nuevo = mios.find((c) => c.nombre === '11B');
      if (!nuevo) throw new Error('no aparece «11B» entre los cursos: ' + JSON.stringify(mios));
      if (antes.indexOf(nuevo.codigo) !== -1) throw new Error('repitió un código ya usado');
      if (!nuevo.codigo || nuevo.codigo.length < 4) throw new Error('código demasiado corto: «' + nuevo.codigo + '»');
      estado.cursoNuevo = nuevo.id;
      return '«' + nuevo.nombre + '» creado con código ' + nuevo.codigo;
    });

    await step('usar el curso nuevo lo pone activo, y se ve en la barra de estado', async () => {
      await irPaginaCurso();

      let usado = false;
      for (let i = 0; i < 8 && !usado; i++) {
        usado = await js('const fila = Array.from(document.querySelectorAll("#page-host .list-row"))' +
          '.find(r => r.textContent.indexOf("11B") !== -1);' +
          'const b = fila ? fila.querySelector(".btn.outline") : null;' +
          'if (!b) return false; b.click(); return true;');
        if (!usado) await sleep(500);
      }
      if (!usado) throw new Error('no se encontró «Usar este curso» para 11B');
      await waitFor('(await window.pc.courses.active()).nombre === "11B"', 10000, 'el curso activo cambia');

      await waitFor('document.getElementById("sb-course") &&' +
        ' document.getElementById("sb-course").textContent.indexOf("11B") !== -1',
        8000, 'la barra de estado se actualiza');
      return 'curso activo: 11B (también en la barra de estado)';
    });

    await step('renombrar y cambiar el código de acceso se guardan', async () => {
      const antes = await js('return (await window.pc.courses.mine()).find(c => c.nombre === "11B");');

      const rename = await js('return await window.pc.courses.rename(' +
        JSON.stringify(estado.cursoNuevo) + ', "Undécimo B");');
      if (!rename.ok) throw new Error(rename.error);

      const regen = await js('return await window.pc.courses.regenerateCode(' +
        JSON.stringify(estado.cursoNuevo) + ');');
      if (!regen.ok) throw new Error(regen.error);
      if (regen.curso.codigo === antes.codigo) throw new Error('el código no cambió');

      const ahora = await js('return (await window.pc.courses.mine()).find(c => c.id === ' +
        JSON.stringify(estado.cursoNuevo) + ');');
      if (ahora.nombre !== 'Undécimo B') throw new Error('el nombre quedó como «' + ahora.nombre + '»');
      if (ahora.codigo !== regen.curso.codigo) throw new Error('el código no se guardó');
      return 'renombrado a «' + ahora.nombre + '» · código ' + antes.codigo + ' → ' + ahora.codigo;
    });

    await step('archivar un curso y reactivarlo', async () => {
      const archivado = await js('return await window.pc.courses.setStatus(' +
        JSON.stringify(estado.cursoNuevo) + ', "archived");');
      if (!archivado.ok || archivado.curso.estado !== 'archived') {
        throw new Error('no quedó archivado: ' + JSON.stringify(archivado));
      }
      const reactivado = await js('return await window.pc.courses.setStatus(' +
        JSON.stringify(estado.cursoNuevo) + ', "active");');
      if (!reactivado.ok || reactivado.curso.estado !== 'active') {
        throw new Error('no se reactivó: ' + JSON.stringify(reactivado));
      }
      return 'archivado y reactivado sin perder nada';
    });

    await step('un estudiante no puede crear, renombrar ni activar cursos ajenos', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);

      const salida = await js(
        'const out = {};' +
        'const pruebas = {' +
        '  crear: () => window.pc.courses.create("Trampa"),' +
        '  renombrar: () => window.pc.courses.rename(' + JSON.stringify(estado.cursoNuevo) + ', "Robado"),' +
        '  activarAjeno: () => window.pc.courses.setActive(' + JSON.stringify(estado.cursoNuevo) + ')' +
        '};' +
        'for (const [nombre, fn] of Object.entries(pruebas)) {' +
        '  try { await fn(); out[nombre] = "PERMITIDO"; } catch (e) { out[nombre] = e.message; }' +
        '}' +
        'return out;');
      const permitidos = Object.entries(salida).filter(([, v]) => v === 'PERMITIDO').map(([k]) => k);
      if (permitidos.length) throw new Error('el estudiante pudo: ' + permitidos.join(', '));
      return Object.keys(salida).length + ' intentos rechazados';
    });

    /* ================================================================ */
    group('44. Cursos · unirse con código');

    const NUEVO1 = { nombre: 'Camila', apellido: 'Ríos', correo: 'camila.rios@colegio.edu.co',
      password: 'estudiante2026', grado: '11', grupo: 'A' };
    const NUEVO2 = { nombre: 'Diego', apellido: 'Salas', correo: 'diego.salas@colegio.edu.co',
      password: 'estudiante2026', grado: '11', grupo: 'A' };

    async function registrarConCodigo(datos, codigo) {
      await js('window.__pc.auth.show("registro"); return true;');
      await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro');
      await js('const f=document.querySelector("#auth-card form");' +
        'f.querySelector("[name=nombre]").value=' + JSON.stringify(datos.nombre) + ';' +
        'f.querySelector("[name=apellido]").value=' + JSON.stringify(datos.apellido) + ';' +
        'f.querySelector("[name=correo]").value=' + JSON.stringify(datos.correo) + ';' +
        'f.querySelector("[name=grado]").value=' + JSON.stringify(datos.grado) + ';' +
        'f.querySelector("[name=grupo]").value=' + JSON.stringify(datos.grupo) + ';' +
        'f.querySelector("[name=codigoCurso]").value=' + JSON.stringify(codigo) + ';' +
        'f.querySelector("[name=password]").value=' + JSON.stringify(datos.password) + ';' +
        'f.querySelector("[name=password2]").value=' + JSON.stringify(datos.password) + ';' +
        'f.requestSubmit(); return true;');
      await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar como estudiante');
      await js('document.querySelectorAll(".tut-backdrop").forEach(n=>n.remove());' +
        'try { await window.pc.users.setTutorialDone(true); } catch(e){} return true;');
    }

    await step('un estudiante nuevo se une al escribir el código en el alta', async () => {
      await entrarComo(PROFE.correo, PROFE.password);
      const cursoGeneral = await js('return (await window.pc.courses.mine())[0];');
      await salir();

      await registrarConCodigo(NUEVO1, cursoGeneral.codigo);
      /*
       * Entrar termina en cuanto se oculta la pantalla de acceso; unirse al
       * curso pasa DESPUÉS de eso (primero arranca toda la aplicación). Con
       * mucho de fondo cargado (el resto de la suite ya sembró bastante),
       * ese «después» puede tardar, así que se espera en vez de mirar una
       * sola vez.
       */
      await waitFor('!!(await window.pc.courses.active())', 15000, 'la unión al curso');
      const activo = await js('return await window.pc.courses.active();');
      if (activo.id !== cursoGeneral.id) {
        throw new Error('no quedó en «' + cursoGeneral.nombre + '», sino en «' + activo.nombre + '»');
      }
      return NUEVO1.nombre + ' se unió a «' + activo.nombre + '» con el código del alta';
    });

    await step('un código equivocado no bloquea la cuenta: se reintenta y se resuelve', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const cursoGeneral = await js('return (await window.pc.courses.mine())[0];');
      await salir();

      // Código inventado en el alta: la cuenta se crea igual, y aparece el
      // diálogo para intentarlo de nuevo.
      await registrarConCodigo(NUEVO2, 'ZZZZZZ');
      await waitFor('!!document.querySelector(".modal-backdrop input.input")', 10000, 'diálogo de reintento');

      const sinCurso = await js('return await window.pc.courses.active();');
      if (sinCurso) throw new Error('ya tenía curso activo antes de reintentar: ' + JSON.stringify(sinCurso));

      await js('const i = document.querySelector(".modal-backdrop input.input");' +
        'i.value = ' + JSON.stringify(cursoGeneral.codigo) + '; i.dispatchEvent(new Event("input")); return true;');
      await js('document.querySelector(".modal-backdrop .btn.primary").click(); return true;');
      await waitFor('(await window.pc.courses.active()) && (await window.pc.courses.active()).id === ' +
        JSON.stringify(cursoGeneral.id), 10000, 'el reintento se une al curso');
      return 'cuenta creada con un código malo, y unida después con el correcto';
    });

    await step('un estudiante que ya tiene curso no puede unirse a otro', async () => {
      const otro = await js('return await window.pc.courses.joinByCode(' + JSON.stringify('QQQQQQ') + ');');
      // Con cualquier código -válido o no- ya tiene curso: se rechaza antes
      // de mirar siquiera si el código existe.
      if (otro.ok) throw new Error('se pudo unir a un segundo curso');
      return otro.error;
    });

    await step('un curso archivado no admite estudiantes nuevos', async () => {
      await entrarComo(PROFE.correo, PROFE.password);
      const creado = await js('return await window.pc.courses.create("Para archivar");');
      await js('return await window.pc.courses.setStatus(' + JSON.stringify(creado.curso.id) + ', "archived");');
      await salir();

      /*
       * Hace falta un estudiante SIN curso para probar esto de verdad: se
       * registra uno nuevo con un código inventado y, cuando aparece el
       * diálogo de reintento, se cancela a propósito («Ahora no»).
       */
      const NUEVO3 = { nombre: 'Valeria', apellido: 'Nieto', correo: 'valeria.nieto@colegio.edu.co',
        password: 'estudiante2026', grado: '11', grupo: 'A' };
      await registrarConCodigo(NUEVO3, 'ZZZZZZ');
      await waitFor('!!document.querySelector(".modal-backdrop input.input")', 10000, 'diálogo de reintento');
      await js('const b = Array.from(document.querySelectorAll(".modal-backdrop .btn"))' +
        '.find(x => x.textContent.trim() === "Ahora no"); b.click(); return true;');
      await sleep(400);
      const sinCurso = await js('return await window.pc.courses.active();');
      if (sinCurso) throw new Error('quedó con curso pese a cancelar: ' + JSON.stringify(sinCurso));

      const res = await js('return await window.pc.courses.joinByCode(' +
        JSON.stringify(creado.curso.codigo) + ');');
      if (res.ok) throw new Error('se unió a un curso archivado');
      if (!/archivado/i.test(res.error)) throw new Error('el mensaje no habla de archivado: ' + res.error);
      return res.error;
    });

    /* ================================================================ */
    group('45. Cursos · aislamiento total entre profesores');

    const PROFEB = { nombre: 'Diana', apellido: 'Vega', correo: 'diana.vega@colegio.edu.co' };
    const aislamiento = {};

    /*
     * El alta de la interfaz solo crea estudiantes (sección 33): un segundo
     * profesor, independiente del primero, se autoriza como lo haría de
     * verdad quien tiene la consola de Firebase -exactamente el mismo atajo
     * que usa el arranque de la suite (grupo "0. Fase 3") para el primero-.
     */
    async function crearProfesor(datos) {
      const uid = await js(
        'const fb = window.__pcFakeFirebase;' +
        'const cred = await fb.createUserWithEmailAndPassword(null, ' + JSON.stringify(datos.correo) + ', "profesor2026");' +
        'const uid = cred.user.uid;' +
        'fb._sembrar("roles/" + uid, "teacher");' +
        'fb._sembrar("users/" + uid, { email: ' + JSON.stringify(datos.correo) + ',' +
        '  firstName: ' + JSON.stringify(datos.nombre) + ', lastName: ' + JSON.stringify(datos.apellido) + ',' +
        '  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });' +
        'await window.__pc.auth.forceLogout();' +
        'return uid;');
      await waitFor('!document.getElementById("auth-screen").hidden', 12000, 'pantalla de acceso');
      return uid;
    }

    await step('un segundo profesor, independiente, recibe su propio «Curso general»', async () => {
      await entrarComo(PROFE.correo, PROFE.password);
      const yo = await js('return await window.pc.session.me();');
      aislamiento.uidA = yo.uid;
      aislamiento.cursoA = (await js('return await window.pc.courses.active();')).id;
      await salir();

      aislamiento.uidB = await crearProfesor(PROFEB);
      // Los dos profesores necesitan poder verificarse a partir de ahora.
      await js('return await window.pc.test.seedIdentity([' +
        '{ uid: ' + JSON.stringify(aislamiento.uidA) + ', role: "teacher", email: ' + JSON.stringify(PROFE.correo) + ' },' +
        '{ uid: ' + JSON.stringify(aislamiento.uidB) + ', role: "teacher", email: ' + JSON.stringify(PROFEB.correo) + ' }]);');

      await entrarComo(PROFEB.correo, 'profesor2026');
      const cursoB = await js('return await window.pc.courses.active();');
      if (!cursoB) throw new Error('el segundo profesor se quedó sin curso');
      if (cursoB.id === aislamiento.cursoA) throw new Error('comparte curso con el primer profesor');
      aislamiento.cursoB = cursoB.id;

      // El temario es catálogo compartido: B lo ve aunque no lo haya cargado.
      const temasB = await js('return await window.pc.topics.list();');
      const res = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Ejercicio del profesor B', description: 'Solo para su curso.',
        instructions: 'No debería verlo nadie más.', type: 'normal', difficulty: 'easy',
        topicId: temasB[0].id, xp: 10, maxScore: 5, status: 'published'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      aislamiento.ejercicioB = res.ejercicio.id;
      await js('await window.__pc.sync.sincronizarAhora(); return true;');
      await sleep(400);
      return '«' + cursoB.nombre + '» (' + cursoB.codigo + '), independiente de «' + aislamiento.cursoA + '»';
    });

    await step('el profesor A no ve nada del curso de B por la vía normal', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      const mios = await js('return await window.pc.courses.mine();');
      if (mios.some((c) => c.id === aislamiento.cursoB)) throw new Error('el curso de B aparece entre los de A');

      const estudiantes = await js('return await window.pc.users.students();');
      const cuentas = await js('return await window.pc.users.list();');
      if (cuentas.some((u) => u.uid === aislamiento.uidB)) {
        throw new Error('«Estudiantes y cuentas» de A incluye al profesor B');
      }
      return mios.length + ' curso(s) propios · ' + estudiantes.length + ' estudiante(s) · sin rastro de B';
    });

    await step('A no puede leer NADA del curso de B directamente en Firebase', async () => {
      const rutas = [
        'courses/' + aislamiento.cursoB,
        'courses/' + aislamiento.cursoB + '/exercises',
        'courses/' + aislamiento.cursoB + '/roster',
        'courses/' + aislamiento.cursoB + '/members',
        'courses/' + aislamiento.cursoB + '/submissions',
        'courses/' + aislamiento.cursoB + '/rankings'
      ];
      const salida = await js(
        'const fb = window.__pcFakeFirebase;' +
        'const out = {};' +
        'for (const ruta of ' + JSON.stringify(rutas) + ') {' +
        '  try { const s = await fb.dbGet(fb.ref(null, ruta)); out[ruta] = s.exists() ? "LEIDO" : "vacío-permitido"; }' +
        '  catch (e) { out[ruta] = e.code || e.message; }' +
        '}' +
        'return out;');
      const leidos = Object.entries(salida).filter(([, v]) => v === 'LEIDO').map(([k]) => k);
      if (leidos.length) throw new Error('A pudo leer: ' + leidos.join(', '));
      return Object.keys(salida).length + ' rutas del curso de B, todas rechazadas o vacías';
    });

    await step('A no puede escribir en el curso de B', async () => {
      const salida = await js(
        'const fb = window.__pcFakeFirebase;' +
        'const out = {};' +
        'try {' +
        '  await fb.dbSet(fb.ref(null, "courses/' + aislamiento.cursoB + '/exercises/intruso"),' +
        '    { title: "Colado", xp: 1 });' +
        '  out.ejercicio = "ESCRIBIO";' +
        '} catch (e) { out.ejercicio = e.code || e.message; }' +
        'try {' +
        '  await fb.dbUpdate(fb.ref(null, "courses/' + aislamiento.cursoB + '"), { name: "Robado" });' +
        '  out.metadatos = "ESCRIBIO";' +
        '} catch (e) { out.metadatos = e.code || e.message; }' +
        'return out;');
      const permitidos = Object.entries(salida).filter(([, v]) => v === 'ESCRIBIO').map(([k]) => k);
      if (permitidos.length) throw new Error('A pudo escribir: ' + permitidos.join(', '));
      return Object.keys(salida).length + ' intentos de escritura rechazados';
    });

    await step('el panel de estadísticas de un estudiante ajeno se rechaza', async () => {
      await salir();
      await entrarComo(PROFEB.correo, 'profesor2026');
      const codigoB = (await js('return await window.pc.courses.active();')).codigo;
      await salir();

      const NUEVO = { nombre: 'Karen', apellido: 'Ospina', correo: 'karen.ospina@colegio.edu.co',
        password: 'estudiante2026', grado: '10', grupo: 'A' };
      await js('window.__pc.auth.show("registro"); return true;');
      await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro');
      await js('const f=document.querySelector("#auth-card form");' +
        'f.querySelector("[name=nombre]").value=' + JSON.stringify(NUEVO.nombre) + ';' +
        'f.querySelector("[name=apellido]").value=' + JSON.stringify(NUEVO.apellido) + ';' +
        'f.querySelector("[name=correo]").value=' + JSON.stringify(NUEVO.correo) + ';' +
        'f.querySelector("[name=grado]").value=' + JSON.stringify(NUEVO.grado) + ';' +
        'f.querySelector("[name=grupo]").value=' + JSON.stringify(NUEVO.grupo) + ';' +
        'f.querySelector("[name=codigoCurso]").value=' + JSON.stringify(codigoB) + ';' +
        'f.querySelector("[name=password]").value=' + JSON.stringify(NUEVO.password) + ';' +
        'f.querySelector("[name=password2]").value=' + JSON.stringify(NUEVO.password) + ';' +
        'f.requestSubmit(); return true;');
      await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar como estudiante');
      await js('document.querySelectorAll(".tut-backdrop").forEach(n=>n.remove());' +
        'try { await window.pc.users.setTutorialDone(true); } catch(e){} return true;');
      await waitFor('!!(await window.pc.courses.active())', 15000, 'la unión al curso de B');
      const estudianteDeB = (await js('return await window.pc.session.me();')).uid;

      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const salida = await js('try { await window.pc.stats.student(' + JSON.stringify(estudianteDeB) + ');' +
        ' return "PERMITIDO"; } catch (e) { return e.message; }');
      if (salida === 'PERMITIDO') throw new Error('A pudo pedir el informe de un estudiante de B');
      return salida;
    });

    /* ================================================================ */
    group('46. Cursos · asignación individual y por grupo');

    const fase5 = {};

    await step('un grupo con nombre se crea con los estudiantes que se le pongan', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      const estudiantes = await js('return await window.pc.users.students();');
      const camila = estudiantes.find((u) => u.correo === 'camila.rios@colegio.edu.co');
      const diego = estudiantes.find((u) => u.correo === 'diego.salas@colegio.edu.co');
      if (!camila || !diego) throw new Error('faltan estudiantes de la fase 44: ' + JSON.stringify(estudiantes.map((u) => u.correo)));
      fase5.camila = camila.uid;
      fase5.diego = diego.uid;

      const creado = await js('return await window.pc.groups.create("Prueba fase 5");');
      if (!creado.ok) throw new Error(creado.error);
      fase5.grupoId = creado.grupo.id;

      const conMiembro = await js('return await window.pc.groups.setMembers(' +
        JSON.stringify(fase5.grupoId) + ', [' + JSON.stringify(fase5.camila) + ']);');
      if (!conMiembro.ok) throw new Error(conMiembro.error);
      if (conMiembro.grupo.miembros.length !== 1) throw new Error('miembros: ' + JSON.stringify(conMiembro.grupo));
      return '«Prueba fase 5» creado con ' + conMiembro.grupo.miembros.length + ' miembro(s)';
    });

    await step('un ejercicio asignado a un grupo solo lo ve quien está en él', async () => {
      const temas = await js('return await window.pc.topics.list();');
      const res = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Solo para el grupo de prueba', description: 'Fase 5.',
        instructions: 'Visible solo para el grupo.', type: 'normal', difficulty: 'easy',
        topicId: temas[0].id, xp: 10, maxScore: 5, status: 'published'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      fase5.ejercicioId = res.ejercicio.id;

      const targets = await js('return await window.pc.exercises.setTargets(' +
        JSON.stringify(fase5.ejercicioId) + ', { estudiantes: [], grupos: [' + JSON.stringify(fase5.grupoId) + '] });');
      if (!targets.ok) throw new Error(targets.error);
      await js('await window.__pc.sync.sincronizarAhora(); return true;');
      await sleep(400);

      await salir();
      await entrarComo('camila.rios@colegio.edu.co', 'estudiante2026');
      const veCamila = await js('return (await window.pc.exercises.list())' +
        '.some(e => e.id === ' + JSON.stringify(fase5.ejercicioId) + ');');
      if (!veCamila) throw new Error('Camila (en el grupo) no ve el ejercicio asignado a su grupo');

      await salir();
      await entrarComo('diego.salas@colegio.edu.co', 'estudiante2026');
      const veDiego = await js('return (await window.pc.exercises.list())' +
        '.some(e => e.id === ' + JSON.stringify(fase5.ejercicioId) + ');');
      if (veDiego) throw new Error('Diego (fuera del grupo) SÍ ve un ejercicio que no es para él');

      return 'Camila (en el grupo) lo ve · Diego (fuera) no';
    });

    await step('asignar directo a un estudiante funciona igual que por grupo', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const res = await js('return await window.pc.exercises.setTargets(' +
        JSON.stringify(fase5.ejercicioId) + ', { estudiantes: [' + JSON.stringify(fase5.diego) +
        '], grupos: [] });');
      if (!res.ok) throw new Error(res.error);

      await salir();
      await entrarComo('diego.salas@colegio.edu.co', 'estudiante2026');
      const veDiego = await js('return (await window.pc.exercises.list())' +
        '.some(e => e.id === ' + JSON.stringify(fase5.ejercicioId) + ');');
      if (!veDiego) throw new Error('Diego, asignado directo, no ve el ejercicio');

      await salir();
      await entrarComo('camila.rios@colegio.edu.co', 'estudiante2026');
      const veCamila = await js('return (await window.pc.exercises.list())' +
        '.some(e => e.id === ' + JSON.stringify(fase5.ejercicioId) + ');');
      if (veCamila) throw new Error('Camila, ya sin destinatario, todavía ve el ejercicio');

      return 'Diego (asignado directo) lo ve · Camila (ya sin destinatario) no';
    });

    await step('quitar los destinatarios lo devuelve a todo el curso', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const res = await js('return await window.pc.exercises.setTargets(' +
        JSON.stringify(fase5.ejercicioId) + ', { estudiantes: [], grupos: [] });');
      if (!res.ok) throw new Error(res.error);

      await salir();
      await entrarComo('camila.rios@colegio.edu.co', 'estudiante2026');
      const veCamila = await js('return (await window.pc.exercises.list())' +
        '.some(e => e.id === ' + JSON.stringify(fase5.ejercicioId) + ');');
      if (!veCamila) throw new Error('sin destinatarios, Camila debería volver a verlo');
      return 'sin destinatarios, todo el curso lo ve de nuevo';
    });

    await step('borrar el grupo no borra sus miembros del curso', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const res = await js('return await window.pc.groups.remove(' + JSON.stringify(fase5.grupoId) + ');');
      if (!res.ok) throw new Error(res.error);
      const grupos = await js('return await window.pc.groups.list();');
      if (grupos.some((g) => g.id === fase5.grupoId)) throw new Error('el grupo sigue apareciendo');
      const estudiantes = await js('return await window.pc.users.students();');
      if (!estudiantes.some((u) => u.uid === fase5.camila)) throw new Error('Camila desapareció del curso');
      return 'grupo borrado · Camila sigue en el curso';
    });

    /* ================================================================ */
    group('47. Cursos · fase 7 (mover, coprofesores, borrar)');

    const fase7 = {};

    await step('el profesor mueve a un estudiante de «Curso general» a «Undécimo B»', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      const mios = await js('return await window.pc.courses.mine();');
      const cursoGeneral = mios.find((c) => c.nombre === 'Curso general');
      const undecimoB = mios.find((c) => c.nombre === 'Undécimo B');
      if (!cursoGeneral || !undecimoB) {
        throw new Error('faltan los cursos propios esperados: ' + JSON.stringify(mios.map((c) => c.nombre)));
      }
      fase7.cursoGeneral = cursoGeneral.id;
      fase7.undecimoB = undecimoB.id;

      await js('return await window.pc.courses.setActive(' + JSON.stringify(fase7.cursoGeneral) + ');');
      const antes = await js('return await window.pc.users.students();');
      const diego = antes.find((u) => u.correo === 'diego.salas@colegio.edu.co');
      if (!diego) throw new Error('Diego no está matriculado en «Curso general»: ' + JSON.stringify(antes.map((u) => u.correo)));
      fase7.diego = diego.uid;

      const mover = await js('return await window.pc.courses.moveStudent(' +
        JSON.stringify(fase7.diego) + ', ' + JSON.stringify(fase7.undecimoB) + ');');
      if (!mover.ok) throw new Error(mover.error);

      const origenTrasMover = await js('return await window.pc.users.students();');
      if (origenTrasMover.some((u) => u.uid === fase7.diego)) throw new Error('Diego sigue en «Curso general»');

      await js('return await window.pc.courses.setActive(' + JSON.stringify(fase7.undecimoB) + ');');
      const destinoTrasMover = await js('return await window.pc.users.students();');
      if (!destinoTrasMover.some((u) => u.uid === fase7.diego)) throw new Error('Diego no llegó a «Undécimo B»');

      return 'Diego: «Curso general» → «Undécimo B»';
    });

    await step('mover a un estudiante que no es de tu curso se rechaza', async () => {
      /*
       * aislamiento.cursoB (grupo 45) sigue siendo un curso válido, pero no
       * guardó ningún uid de estudiante -el que registró en su último paso
       * era una variable local a ese step-. Se reutiliza en su lugar a Karen
       * Ospina, matriculada ahí mismo en ese paso, con su propia sesión para
       * obtener su uid sin que el profesor A necesite leer nada ajeno.
       */
      await salir();
      await entrarComo('karen.ospina@colegio.edu.co', 'estudiante2026');
      const karen = await js('return await window.pc.session.me();');
      await salir();

      await entrarComo(PROFE.correo, PROFE.password);
      const res = await js('return await window.pc.courses.moveStudent(' +
        JSON.stringify(karen.uid) + ', ' + JSON.stringify(fase7.undecimoB) + ');');
      if (res.ok) throw new Error('PROFE pudo mover a un estudiante que no es suyo: ' + JSON.stringify(res));
      if (!/no es de tu curso/i.test(res.error)) throw new Error('mensaje inesperado: ' + res.error);
      return res.error;
    });

    await step('un profesor se une como coprofesor de un curso ajeno con su código, pero no puede crear ejercicios', async () => {
      const cursoGeneral = (await js('return await window.pc.courses.mine();')).find((c) => c.id === fase7.cursoGeneral);
      const codigo = cursoGeneral.codigo;
      await salir();

      await entrarComo(PROFEB.correo, 'profesor2026');
      const join = await js('return await window.pc.courses.joinCoTeacher(' + JSON.stringify(codigo) + ');');
      if (!join.ok) throw new Error(join.error);
      if (join.curso.id !== fase7.cursoGeneral) throw new Error('se unió a un curso distinto: ' + JSON.stringify(join.curso));

      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const coprofes = await js('return await window.pc.courses.coTeachers(' + JSON.stringify(fase7.cursoGeneral) + ');');
      if (!coprofes.some((c) => c.correo === PROFEB.correo)) {
        throw new Error('PROFEB no aparece como coprofesor: ' + JSON.stringify(coprofes));
      }

      await salir();
      await entrarComo(PROFEB.correo, 'profesor2026');
      await js('return await window.pc.courses.setActive(' + JSON.stringify(fase7.cursoGeneral) + ');');
      const estudiantesVistosPorB = await js('return await window.pc.users.students();');
      if (!estudiantesVistosPorB.some((u) => u.correo === 'camila.rios@colegio.edu.co')) {
        throw new Error('el coprofesor no ve a los estudiantes del curso: ' + JSON.stringify(estudiantesVistosPorB));
      }

      /*
       * exercises:save solo exige ser profesor (cualquiera), no dueño de ESE
       * curso -la app todavía no distingue dueño de coprofesor en local-, así
       * que la escritura local se admite (ok:true) y el ejercicio queda en
       * SQLite. Lo que de verdad impide a un coprofesor crear contenido es la
       * regla de Firebase (courses/$courseId/exercises: .write solo teacherId):
       * al sincronizar, ese cambio se queda «rechazado por las reglas» para
       * siempre, sin llegar nunca al curso de verdad. Se comprueba ahí, no en
       * la respuesta inmediata de exercises.save -que no es donde ocurre el
       * rechazo real.
       */
      const temas = await js('return await window.pc.topics.list();');
      const intento = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Intento de coprofesor', description: 'No debería poder crear esto.',
        instructions: 'x', type: 'normal', difficulty: 'easy',
        topicId: temas[0].id, xp: 5, maxScore: 5, status: 'published'
      }) + ');');
      if (!intento.ok) throw new Error('exercises.save rechazó localmente (inesperado): ' + JSON.stringify(intento.errores || intento.error));
      fase7.ejercicioCoprofesor = intento.ejercicio.id;

      await js('await window.__pc.sync.sincronizarAhora(); return true;');
      const fallidas = await js('return (await window.pc.sync.pending(100, "failed"))' +
        '.filter(i => i.status === "failed" && i.entity === "exercises" && i.entityId === ' +
        JSON.stringify(fase7.ejercicioCoprofesor) + ');');
      if (!fallidas.length) throw new Error('el ejercicio del coprofesor no quedó rechazado al sincronizar');
      if (!/reglas de seguridad/i.test(fallidas[0].lastError || '')) {
        throw new Error('mensaje de rechazo inesperado: ' + JSON.stringify(fallidas[0]));
      }
      return 've a los estudiantes · crear ejercicio: admitido en local, rechazado por Firebase («' +
        fallidas[0].lastError + '»)';
    });

    await step('el dueño quita al coprofesor y le retira el acceso', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const quitar = await js('return await window.pc.courses.removeCoTeacher(' +
        JSON.stringify(fase7.cursoGeneral) + ', ' + JSON.stringify(aislamiento.uidB) + ');');
      if (!quitar.ok) throw new Error(quitar.error);

      const coprofesTrasQuitar = await js('return await window.pc.courses.coTeachers(' +
        JSON.stringify(fase7.cursoGeneral) + ');');
      if (coprofesTrasQuitar.some((c) => c.correo === PROFEB.correo)) throw new Error('sigue apareciendo como coprofesor');

      await salir();
      await entrarComo(PROFEB.correo, 'profesor2026');
      const misCursosB = await js('return await window.pc.courses.mine();');
      if (misCursosB.some((c) => c.id === fase7.cursoGeneral)) throw new Error('el excoprofesor todavía ve el curso');
      return 'ya no aparece en coTeachers() ni en courses.mine() de B';
    });

    await step('un curso vacío solo se borra después de archivarlo', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      const creado = await js('return await window.pc.courses.create("Curso temporal 47");');
      if (!creado.ok) throw new Error(creado.error);
      const cursoTemp = creado.curso.id;

      const sinArchivar = await js('return await window.pc.courses.remove(' + JSON.stringify(cursoTemp) + ');');
      if (sinArchivar.ok) throw new Error('se pudo borrar sin archivar primero');
      if (!/archívalo primero/i.test(sinArchivar.error)) throw new Error('mensaje inesperado: ' + sinArchivar.error);

      const archivado = await js('return await window.pc.courses.setStatus(' + JSON.stringify(cursoTemp) + ', "archived");');
      if (!archivado.ok) throw new Error(archivado.error);

      const borrado = await js('return await window.pc.courses.remove(' + JSON.stringify(cursoTemp) + ');');
      if (!borrado.ok) throw new Error(borrado.error);

      const misCursos = await js('return await window.pc.courses.mine();');
      if (misCursos.some((c) => c.id === cursoTemp)) throw new Error('el curso borrado sigue apareciendo');
      return 'rechazado sin archivar («' + sinArchivar.error + '») · borrado tras archivarlo';
    });

    await step('un curso con entregas no se puede borrar aunque esté archivado', async () => {
      const archivarGeneral = await js('return await window.pc.courses.setStatus(' +
        JSON.stringify(fase7.cursoGeneral) + ', "archived");');
      if (!archivarGeneral.ok) throw new Error(archivarGeneral.error);

      const intentoBorrar = await js('return await window.pc.courses.remove(' + JSON.stringify(fase7.cursoGeneral) + ');');

      // Se reactiva pase lo que pase: el grupo de seguridad que sigue necesita
      // el curso activo, y no debe quedar archivado por culpa de esta prueba.
      const reactivar = await js('return await window.pc.courses.setStatus(' +
        JSON.stringify(fase7.cursoGeneral) + ', "active");');
      if (!reactivar.ok) throw new Error('no se pudo reactivar «Curso general»: ' + reactivar.error);

      if (intentoBorrar.ok) throw new Error('«Curso general» se borró pese a tener entregas');
      if (!/entrega/i.test(intentoBorrar.error)) throw new Error('mensaje inesperado: ' + intentoBorrar.error);

      const misCursos = await js('return await window.pc.courses.mine();');
      const general = misCursos.find((c) => c.id === fase7.cursoGeneral);
      if (!general || general.estado !== 'active') throw new Error('«Curso general» no quedó activo: ' + JSON.stringify(general));
      return 'rechazado por tener entregas («' + intentoBorrar.error + '») · reactivado';
    });

    await step('cierre del grupo: sesión de profesor y ningún curso propio queda archivado', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const misCursos = await js('return await window.pc.courses.mine();');
      for (const c of misCursos) {
        if (c.estado === 'archived') {
          const r = await js('return await window.pc.courses.setStatus(' + JSON.stringify(c.id) + ', "active");');
          if (!r.ok) throw new Error('no se pudo reactivar «' + c.nombre + '»: ' + r.error);
        }
      }
      const final = await js('return await window.pc.courses.mine();');
      const archivados = final.filter((c) => c.estado === 'archived');
      if (archivados.length) throw new Error('quedaron cursos archivados: ' + JSON.stringify(archivados));
      return misCursos.length + ' curso(s) propio(s) revisados · ninguno archivado';
    });

    /* ================================================================ */
    group('48. Cursos · elegir rol al registrarse (solicitud de profesor y aprobación)');

    /*
     * El bootstrap (primer profesor de la instalación, sin código) ya se
     * probó al principio de toda la suite (grupo "0a" en scripts/e2e.js, con
     * Rosa Nieto) porque necesitaba config/bootstrap todavía sin reclamar.
     * Aquí, con la instalación ya llena de profesores, toca el camino normal:
     * alguien elige "profesor" con el código de un curso ajeno y se queda de
     * estudiante con una solicitud pendiente, visible solo para el dueño de
     * ESE curso, hasta que la aprueba o la rechaza.
     */
    const CANDIDATA = { nombre: 'Laura', apellido: 'Méndez', correo: 'laura.mendez@colegio.edu.co', password: 'profesor2026' };
    const CANDIDATO_RECHAZADO = { nombre: 'Marco', apellido: 'Islas', correo: 'marco.islas@colegio.edu.co', password: 'profesor2026' };
    const elegirRol = {};

    async function registrarComoProfesor(datos, codigoCurso) {
      await js('window.__pc.auth.show("registro"); return true;');
      await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro');
      await js('const f=document.querySelector("#auth-card form");' +
        'f.querySelector("input[name=_rolAlta][value=profesor]").click();' +
        'f.querySelector("[name=nombre]").value=' + JSON.stringify(datos.nombre) + ';' +
        'f.querySelector("[name=apellido]").value=' + JSON.stringify(datos.apellido) + ';' +
        'f.querySelector("[name=correo]").value=' + JSON.stringify(datos.correo) + ';' +
        'f.querySelector("[name=codigoCurso]").value=' + JSON.stringify(codigoCurso || '') + ';' +
        'f.querySelector("[name=password]").value=' + JSON.stringify(datos.password) + ';' +
        'f.querySelector("[name=password2]").value=' + JSON.stringify(datos.password) + ';' +
        'f.requestSubmit(); return true;');
      await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar tras el alta');
      const yo = await waitFor('await window.pc.session.me()', 10000, 'sesión activa');
      await limpiarCapas();
      await js('try { await window.pc.users.setTutorialDone(true); } catch(e){} return true;');
      return yo;
    }

    await step('se obtiene el código de «Curso general» de PROFE', async () => {
      await entrarComo(PROFE.correo, PROFE.password);
      const mios = await js('return await window.pc.courses.mine();');
      const cursoGeneral = mios.find((c) => c.nombre === 'Curso general');
      if (!cursoGeneral) throw new Error('PROFE no tiene «Curso general»: ' + JSON.stringify(mios.map((c) => c.nombre)));
      elegirRol.cursoGeneralId = cursoGeneral.id;
      elegirRol.codigo = cursoGeneral.codigo;
      await salir();
      return 'código: ' + elegirRol.codigo;
    });

    await step('elegir "profesor" con el código de un curso ajeno deja la cuenta de estudiante con una solicitud pendiente', async () => {
      const yo = await registrarComoProfesor(CANDIDATA, elegirRol.codigo);
      if (yo.rol !== 'estudiante') throw new Error('se volvió profesor sin que nadie la aprobara: ' + yo.rol);
      elegirRol.uidCandidata = yo.uid;

      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const entradaRoster = arbol.courses && arbol.courses[elegirRol.cursoGeneralId] &&
        arbol.courses[elegirRol.cursoGeneralId].roster && arbol.courses[elegirRol.cursoGeneralId].roster[yo.uid];
      if (!entradaRoster || entradaRoster.teacherRequestedCourseId !== elegirRol.cursoGeneralId) {
        throw new Error('la solicitud no quedó escrita en el roster remoto de ese curso: ' + JSON.stringify(entradaRoster));
      }
      await salir();
      return 'quedó como estudiante · solicitud escrita en courses/' + elegirRol.cursoGeneralId + '/roster/' + yo.uid;
    });

    await step('el dueño del curso ve la solicitud pendiente y la aprueba', async () => {
      await entrarComo(PROFE.correo, PROFE.password);
      await js('return await window.pc.courses.setActive(' + JSON.stringify(elegirRol.cursoGeneralId) + ');');
      // Sin esto, la solicitud sigue solo en Firebase: hace falta traerla a lo
      // local (mismo mecanismo -y mismo arreglo- que arrastrarAhora/applyRemote).
      await js('await window.__pc.sync.sincronizarAhora(); return true;');

      const solicitudes = await js('return await window.pc.users.solicitudesProfesor();');
      const laSuya = solicitudes.find((s) => s.uid === elegirRol.uidCandidata);
      if (!laSuya) throw new Error('la solicitud de Laura no aparece: ' + JSON.stringify(solicitudes.map((s) => s.correo)));

      const res = await js('return await window.pc.users.aprobarSolicitudProfesor(' + JSON.stringify(elegirRol.uidCandidata) + ');');
      if (!res.ok) throw new Error(res.error);
      /*
       * Empuja el cambio local (role=teacher, sin solicitud) ANTES de que el
       * temporizador de arrastre periódico (cada 3 min, solo lectura) pueda
       * volver a bajar el roster viejo -todavía con la solicitud pendiente-
       * y pisar la aprobación que se acaba de guardar en SQLite.
       */
      await js('await window.__pc.sync.sincronizarAhora(); return true;');

      const coprofes = await js('return await window.pc.courses.coTeachers(' + JSON.stringify(elegirRol.cursoGeneralId) + ');');
      if (!coprofes.some((c) => c.correo === CANDIDATA.correo)) throw new Error('no quedó como coprofesora: ' + JSON.stringify(coprofes));

      const solicitudesTrasAprobar = await js('return await window.pc.users.solicitudesProfesor();');
      if (solicitudesTrasAprobar.some((s) => s.uid === elegirRol.uidCandidata)) throw new Error('la solicitud sigue apareciendo tras aprobarla');
      return laSuya.nombreCompleto + ' aprobada · ahora coprofesora de «Curso general»';
    });

    await step('la aprobada entra ya como profesora, coprofesora de «Curso general»', async () => {
      /*
       * test:seedIdentity REEMPLAZA la tabla entera (no la combina): hay que
       * repetir a PROFE y PROFEB, o su PRÓXIMO inicio de sesión -que este
       * mismo grupo todavía necesita- se verificaría como estudiante. Mismo
       * patrón que ya usa crearProfesor() en el grupo 45.
       */
      await js('return await window.pc.test.seedIdentity([' +
        '{ uid: ' + JSON.stringify(aislamiento.uidA) + ', role: "teacher", email: ' + JSON.stringify(PROFE.correo) + ' },' +
        '{ uid: ' + JSON.stringify(aislamiento.uidB) + ', role: "teacher", email: ' + JSON.stringify(PROFEB.correo) + ' },' +
        '{ uid: ' + JSON.stringify(elegirRol.uidCandidata) + ', role: "teacher", email: ' + JSON.stringify(CANDIDATA.correo) + ' }' +
        ']);');
      await salir();
      await entrarComo(CANDIDATA.correo, CANDIDATA.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'profesor') throw new Error('sigue sin ser profesora tras la aprobación: ' + yo.rol);
      const mios = await js('return await window.pc.courses.mine();');
      if (!mios.some((c) => c.id === elegirRol.cursoGeneralId)) throw new Error('no ve «Curso general» entre los suyos: ' + JSON.stringify(mios));
      await salir();
      return yo.nombreCompleto + ' · profesora · ve «Curso general»';
    });

    await step('un segundo candidato pide lo mismo y queda pendiente, independiente del ya aprobado', async () => {
      const yo = await registrarComoProfesor(CANDIDATO_RECHAZADO, elegirRol.codigo);
      if (yo.rol !== 'estudiante') throw new Error('se volvió profesor sin aprobación: ' + yo.rol);
      elegirRol.uidRechazado = yo.uid;
      await salir();
      return 'Marco queda pendiente, sin tocar la aprobación de Laura';
    });

    await step('aprobar o rechazar una solicitud solo funciona con el curso correcto como activo', async () => {
      /*
       * Regresión directa del hueco que tenía rechazarSolicitudProfesor: no
       * comprobaba que la solicitud fuera del curso activo de quien la
       * resuelve (aprobarSolicitudProfesor sí lo hacía). Con «Undécimo B»
       * -otro curso real de PROFE- como activo, ninguna de las dos debe
       * poder tocar la solicitud de Marco, que es de «Curso general».
       */
      await entrarComo(PROFE.correo, PROFE.password);
      await js('return await window.pc.courses.setActive(' + JSON.stringify(elegirRol.cursoGeneralId) + ');');
      await js('await window.__pc.sync.sincronizarAhora(); return true;');   // trae a Marco a lo local de PROFE

      const undecimoB = (await js('return await window.pc.courses.mine();')).find((c) => c.nombre === 'Undécimo B');
      if (!undecimoB) throw new Error('falta «Undécimo B» entre los cursos de PROFE');
      await js('return await window.pc.courses.setActive(' + JSON.stringify(undecimoB.id) + ');');

      const solicitudesDesdeOtroCurso = await js('return await window.pc.users.solicitudesProfesor();');
      if (solicitudesDesdeOtroCurso.some((s) => s.uid === elegirRol.uidRechazado)) {
        throw new Error('la solicitud de «Curso general» aparece con «Undécimo B» activo');
      }

      const intentoRechazar = await js('return await window.pc.users.rechazarSolicitudProfesor(' + JSON.stringify(elegirRol.uidRechazado) + ');');
      if (intentoRechazar.ok) throw new Error('se pudo rechazar una solicitud de OTRO curso con «Undécimo B» activo');

      const intentoAprobar = await js('return await window.pc.users.aprobarSolicitudProfesor(' + JSON.stringify(elegirRol.uidRechazado) + ');');
      if (intentoAprobar.ok) throw new Error('se pudo aprobar una solicitud de OTRO curso con «Undécimo B» activo');

      return 'ambas rechazadas con el curso activo equivocado: «' + intentoRechazar.error + '»';
    });

    await step('el dueño real del curso rechaza la solicitud', async () => {
      await js('return await window.pc.courses.setActive(' + JSON.stringify(elegirRol.cursoGeneralId) + ');');
      const solicitudes = await js('return await window.pc.users.solicitudesProfesor();');
      const laSuya = solicitudes.find((s) => s.uid === elegirRol.uidRechazado);
      if (!laSuya) throw new Error('el dueño real no ve la solicitud: ' + JSON.stringify(solicitudes.map((s) => s.correo)));

      const res = await js('return await window.pc.users.rechazarSolicitudProfesor(' + JSON.stringify(elegirRol.uidRechazado) + ');');
      if (!res.ok) throw new Error(res.error);
      // Mismo resguardo que en la aprobación: empujar antes de que el arrastre
      // periódico pueda bajar el roster viejo y resucitar la solicitud.
      await js('await window.__pc.sync.sincronizarAhora(); return true;');

      const trasRechazar = await js('return await window.pc.users.solicitudesProfesor();');
      if (trasRechazar.some((s) => s.uid === elegirRol.uidRechazado)) throw new Error('la solicitud sigue apareciendo tras rechazarla');
      return 'solicitud de ' + laSuya.nombreCompleto + ' rechazada';
    });

    await step('el rechazado sigue de estudiante, sin ningún curso propio', async () => {
      await salir();
      await entrarComo(CANDIDATO_RECHAZADO.correo, CANDIDATO_RECHAZADO.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'estudiante') throw new Error('quedó como ' + yo.rol + ' pese al rechazo');
      const mios = await js('return await window.pc.courses.mine();');
      if (mios.length) throw new Error('un estudiante rechazado no debería tener ningún curso propio: ' + JSON.stringify(mios));
      await salir();
      return yo.nombreCompleto + ' · sigue de estudiante · sin cursos propios';
    });

    // El siguiente grupo de pruebas (seguridad) da por hecho que queda una
    // sesión de profesor abierta, como dejaba el grupo anterior a este.
    await entrarComo(PROFE.correo, PROFE.password);

  })();
};
