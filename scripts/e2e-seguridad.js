'use strict';
/*
 * Pruebas de la barrera de seguridad del rol.
 *
 * Reproducen los dos ataques que eran posibles antes:
 *
 *   1. Con las herramientas de desarrollo, llamar al canal de sesion diciendo
 *      "soy profesor" (o suplantando el uid de otra persona).
 *   2. Borrar la base de datos local para que el equipo "empiece de cero" y
 *      quedarse con el rol de profesor en la siguiente entrada.
 *
 * Y comprueban el comportamiento honesto sin conexion: no se concede un rol que
 * no se puede verificar, pero tampoco se pierde el que ya se verifico en este
 * equipo.
 */

const fase3 = require('./e2e-fase3.js');

const PROFE = fase3.PROFE;
const ALUMNO = fase3.ALUMNO;

module.exports = function seguridad(h) {
  const { js, waitFor, step, group, sleep } = h;

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

  /** Vuelve a dejar sembrada la identidad del profesor (y solo la suya). */
  async function sembrarProfesor(uidProfesor) {
    await js('return await window.pc.test.seedIdentity([' +
      '{ uid: ' + JSON.stringify(uidProfesor) + ', role: "teacher", email: ' + JSON.stringify(PROFE.correo) + ' }]);');
  }

  return (async () => {

    group('29. Seguridad · el rol lo decide el proceso principal');

    const uids = {};

    await step('quién es cada quién antes de empezar', async () => {
      const lista = await js('return await window.pc.users.list();');
      const profe = lista.find((u) => u.correo === PROFE.correo);
      const alumno = lista.find((u) => u.correo === ALUMNO.correo);
      if (!profe || !alumno) throw new Error('faltan cuentas en el espejo local');
      uids.profesor = profe.uid;
      uids.alumno = alumno.uid;
      if (profe.rol !== 'profesor') throw new Error('el profesor no está como profesor');
      if (!profe.rolVerificadoEn) throw new Error('el rol del profesor no está marcado como verificado');
      if (alumno.rol !== 'estudiante') throw new Error('el alumno está como ' + alumno.rol);
      return 'profesor ' + profe.uid.slice(0, 12) + '… verificado el ' +
        String(profe.rolVerificadoEn).slice(0, 19) + ' · alumno ' + uids.alumno.slice(0, 12) + '…';
    });

    await step('pedir el rol de profesor desde la interfaz no sirve de nada', async () => {
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);

      // Esto es lo que haría alguien con la consola del navegador abierta.
      const res = await js('return await window.pc.session.set({' +
        ' uid: ' + JSON.stringify(uids.alumno) + ',' +
        ' email: ' + JSON.stringify(ALUMNO.correo) + ',' +
        ' idToken: "fake:' + uids.alumno + '",' +
        ' remoteRole: "teacher", role: "teacher", verifiedRole: "teacher" });');
      if (res.usuario.rol !== 'estudiante') throw new Error('se quedó como ' + res.usuario.rol);

      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'estudiante') throw new Error('la sesión activa es ' + yo.rol);
      return 'pidió teacher tres veces y sigue siendo ' + yo.rol;
    });

    await step('un estudiante no puede usar los canales de profesor', async () => {
      const salida = await js(
        'const out = {};' +
        'const pruebas = {' +
        '  crearEjercicio: () => window.pc.exercises.save({ title: "Ejercicio pirata", xp: 10 }),' +
        '  listarCuentas: () => window.pc.users.list(),' +
        '  calificar: () => window.pc.submissions.review({ status: "all" }),' +
        '  cargarInsignias: () => window.pc.badges.seed(),' +
        '  estadisticas: () => window.pc.stats.course(),' +
        '  borrarTodo: () => window.pc.data.wipe("BORRAR TODO")' +
        '};' +
        'for (const [nombre, fn] of Object.entries(pruebas)) {' +
        '  try { await fn(); out[nombre] = "PERMITIDO"; } catch (e) { out[nombre] = e.message; }' +
        '}' +
        'return out;');
      const permitidos = Object.entries(salida).filter(([, v]) => v === 'PERMITIDO').map(([k]) => k);
      if (permitidos.length) throw new Error('un estudiante pudo: ' + permitidos.join(', '));
      return Object.keys(salida).length + ' canales rechazados: "' +
        String(salida.crearEjercicio).slice(0, 48) + '…"';
    });

    await step('no se puede suplantar el uid de otra persona', async () => {
      // Token de estudiante, uid de profesor: manda el token.
      const res = await js('return await window.pc.session.set({' +
        ' uid: ' + JSON.stringify(uids.profesor) + ',' +
        ' email: ' + JSON.stringify(PROFE.correo) + ',' +
        ' idToken: "fake:' + uids.alumno + '" });');
      if (res.usuario.uid !== uids.alumno) throw new Error('quedó como ' + res.usuario.uid);
      if (res.usuario.rol !== 'estudiante') throw new Error('rol: ' + res.usuario.rol);
      return 'pidió entrar como el profesor y la sesión sigue siendo la del alumno';
    });

    await step('una sesión sin token se rechaza', async () => {
      const salida = await js('try {' +
        ' await window.pc.session.set({ uid: ' + JSON.stringify(uids.alumno) + ', email: "x@y.z" });' +
        ' return "PERMITIDO";' +
        '} catch (e) { return e.message; }');
      if (salida === 'PERMITIDO') throw new Error('aceptó una sesión sin token');
      return salida;
    });

    await step('borrar la base local NO convierte al estudiante en profesor', async () => {
      /*
       * El caso que pedía el colegio: alguien borra los datos del equipo para
       * que la app "empiece de cero" y entra el primero.
       */
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const borrado = await js('return await window.pc.data.wipe("BORRAR TODO");');
      if (!borrado.ok) throw new Error('no se pudo borrar: ' + borrado.error);
      const vacio = await js('return await window.pc.session.bootstrapInfo();');
      if (vacio.usuariosLocales !== 0) throw new Error('quedaron ' + vacio.usuariosLocales + ' cuentas');

      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'estudiante') throw new Error('¡el primero en entrar quedó como ' + yo.rol + '!');
      const intento = await js('try { await window.pc.badges.seed(); return "PERMITIDO"; }' +
        ' catch (e) { return e.message; }');
      if (intento === 'PERMITIDO') throw new Error('pudo tocar el catálogo de insignias');
      return 'base vacía + primera entrada = ' + yo.rol + ' · canales de profesor cerrados';
    });

    await step('el profesor autorizado vuelve a ser profesor tras el borrado', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'profesor') throw new Error('el profesor entró como ' + yo.rol);
      if (!yo.rolVerificadoEn) throw new Error('sin marca de verificación');
      const ok = await js('return await window.pc.badges.seed();');
      if (!ok.ok) throw new Error('no pudo cargar el catálogo');
      return 'verificado contra Firebase y con sus permisos de vuelta';
    });

    await step('sin conexión no se concede un rol que no se puede comprobar', async () => {
      // El doble deja de responder: la comprobacion del rol falla.
      await js('return await window.pc.test.seedIdentity([{ offline: true }]);');
      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'estudiante') throw new Error('rol sin conexión: ' + yo.rol);
      const pendiente = await js('return window.__pc.auth.rolSinVerificar();');
      if (!pendiente) throw new Error('no avisa de que la verificación quedó pendiente');
      return 'entra como estudiante y queda marcado «verificación pendiente»';
    });

    await step('sin conexión el profesor conserva el rol ya verificado', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'profesor') throw new Error('perdió el rol sin conexión: ' + yo.rol);
      const pendiente = await js('return window.__pc.auth.rolSinVerificar();');
      if (!pendiente) throw new Error('debería avisar de que no pudo comprobarlo ahora');
      return 'mantiene el rol verificado antes en este equipo, avisando de que no pudo comprobarlo';
    });

    await step('sin conexión y sin nada verificado, tampoco hay profesor', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await js('return await window.pc.data.wipe("BORRAR TODO");');
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'estudiante') throw new Error('sin verificación previa quedó como ' + yo.rol);

      // Se devuelve la conexion y el rol vuelve solo.
      await sembrarProfesor(uids.profesor);
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const despues = await js('return await window.pc.session.me();');
      if (despues.rol !== 'profesor') throw new Error('con conexión sigue siendo ' + despues.rol);
      return 'base borrada + sin red = estudiante · con red vuelve a profesor';
    });

    await step('el modo de pruebas no existe en una instalación real', async () => {
      const info = await js('return await window.pc.app.info();');
      if (info.packaged) throw new Error('esta prueba corre empaquetada, revisa el arranque');
      const fuente = require('fs').readFileSync(
        require('path').resolve(__dirname, '..', 'electron', 'ipc', 'data.js'), 'utf8');
      if (fuente.indexOf("if (!app.isPackaged && process.env.PC_E2E)") === -1) {
        throw new Error('el canal de pruebas no está condicionado a PC_E2E');
      }
      const main = require('fs').readFileSync(
        require('path').resolve(__dirname, '..', 'electron', 'main.js'), 'utf8');
      if (main.indexOf('devTools: !app.isPackaged') === -1) {
        throw new Error('las herramientas de desarrollo siguen activas empaquetada');
      }
      if (main.indexOf('const permitirPruebas = !app.isPackaged') === -1) {
        throw new Error('PC_E2E se honraría también empaquetada');
      }
      return 'canal de pruebas y DevTools solo fuera del empaquetado';
    });

    // Se deja el entorno como estaba para las fases siguientes.
    await step('el entorno queda listo para el resto de la suite', async () => {
      await sembrarProfesor(uids.profesor);
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      const yo = await js('return await window.pc.session.me();');
      if (yo.rol !== 'profesor') throw new Error('rol: ' + yo.rol);
      return 'sesión de profesor restablecida';
    });

  })();
};
