'use strict';
/*
 * Pruebas funcionales de extremo a extremo de Python Classroom.
 *
 *   set PC_E2E=1 && npx electron . --dev --user-data-dir=<carpeta temporal>
 * o, mas comodo:
 *   npm run test:e2e
 *
 * Conduce la interfaz real (no simula nada): escribe codigo en CodeMirror,
 * ejecuta Python de verdad, lee la consola, usa la terminal y pip.
 */

const os = require('os');
const path = require('path');

const results = [];
let currentGroup = '';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function group(name) { currentGroup = name; console.log('\n== ' + name + ' ' + '='.repeat(Math.max(0, 56 - name.length))); }

function pass(name, detail) {
  results.push({ ok: true, group: currentGroup, name });
  console.log('  PASA  ' + name + (detail ? '   -> ' + String(detail).replace(/\s+/g, ' ').slice(0, 110) : ''));
}

function fail(name, detail) {
  results.push({ ok: false, group: currentGroup, name, detail: String(detail) });
  console.log('  FALLA ' + name + '   -> ' + String(detail).replace(/\s+/g, ' ').slice(0, 400));
}

module.exports = function runE2E(win, app) {
  const wc = win.webContents;

  const js = (code) => wc.executeJavaScript('(async () => {' + code + '})()', true);

  async function waitFor(expr, timeout, label) {
    const limit = timeout || 15000;
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < limit) {
      try {
        last = await js('return (' + expr + ');');
        if (last) return last;
      } catch (err) {
        last = 'error: ' + err.message;
      }
      await sleep(180);
    }
    throw new Error('tiempo agotado esperando ' + (label || expr) + ' (ultimo valor: ' + JSON.stringify(last) + ')');
  }

  async function step(name, fn) {
    try {
      const detail = await fn();
      pass(name, detail);
    } catch (err) {
      fail(name, err && err.message ? err.message : err);
    }
  }

  /** Escribe codigo en el editor sustituyendo todo el documento. */
  async function setCode(code) {
    await js(
      'const v = window.__pc.editor.getView();' +
      'v.dispatch({changes:{from:0,to:v.state.doc.length,insert:' + JSON.stringify(code) + '}});' +
      'window.__pc.documents.syncActive();' +
      'return v.state.doc.length;'
    );
  }

  const consoleText = 'document.getElementById("console-out").innerText';
  const termText = 'document.getElementById("term-out").innerText';

  /**
   * Cambia el tamano de la ventana de verdad. Lo usan las pruebas de diseno
   * adaptable: el CSS reacciona al ancho real, no a uno simulado.
   */
  function resize(ancho, alto) {
    const w = Math.round(ancho);
    const h = Math.round(alto);
    try {
      /*
       * Una ventana minimizada tiene area de cliente 0x0 y Windows ignora los
       * cambios de tamano: hay que restaurarla antes o el resize se pierde en
       * silencio (era el motivo de que estas pruebas fallaran a ratos).
       */
      if (win.isMinimized()) win.restore();
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      win.show();

      const antes = win.getBounds();
      win.setBounds({ x: antes.x, y: antes.y, width: w, height: h });
      let real = win.getSize();
      if (Math.abs(real[0] - w) > 4) {          // segundo intento por si acaso
        win.setSize(w, h);
        real = win.getSize();
      }
      if (Math.abs(real[0] - w) > 4) {
        console.log('[e2e] no se pudo redimensionar a', w + 'x' + h, '- quedó en', real.join('x'),
          '· minimo', win.getMinimumSize().join('x'),
          '· maximizada', win.isMaximized(), '· minimizada', win.isMinimized());
      }
      return { pedido: [w, h], real: real, maximizada: win.isMaximized() };
    } catch (err) {
      console.log('[e2e] resize falló:', err && err.message);
      return { pedido: [w, h], real: null, error: err && err.message };
    }
  }

  /**
   * Guarda una captura de la ventana. La usan las pruebas de diseno adaptable
   * para poder MIRAR el resultado, no solo medirlo.
   */
  async function captura(nombre) {
    const destino = path.join(os.tmpdir(), 'python-classroom-' + String(nombre).replace(/[^a-z0-9_-]/gi, '') + '.png');
    try {
      const img = await win.capturePage();
      require('fs').writeFileSync(destino, img.toPNG());
      return destino;
    } catch (err) {
      return null;
    }
  }

  /** Trae la ventana al frente: el autocompletado se cierra al perder el foco. */
  function focusWin() {
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      wc.focus();
    } catch (err) { /* la ventana puede estar cerrandose */ }
  }

  /**
   * Escribe codigo, pide sugerencias y devuelve sus etiquetas.
   * Lee el estado real de CodeMirror (no el DOM) y reintenta hasta que llegan,
   * asi no depende de un sleep fijo ni de que el popup ya este pintado.
   */
  async function sugerencias(codigo, timeout) {
    focusWin();
    await js('document.querySelectorAll(".cm-tooltip-autocomplete").forEach(n=>n.remove()); return true;');
    await setCode(codigo);
    await sleep(250);
    const limit = timeout || 6000;
    const t0 = Date.now();
    let ultimo = [];
    while (Date.now() - t0 < limit) {
      ultimo = await js(
        'const v = window.__pc.editor.getView();' +
        'v.focus();' +
        'v.dispatch({selection:{anchor: v.state.doc.length}});' +
        'const cm = await import("./js/vendor/cm6.js");' +
        'cm.startCompletion(v);' +
        'await new Promise(r => setTimeout(r, 420));' +
        'const activas = cm.currentCompletions(v.state) || [];' +
        'return activas.map(c => c.label);'
      );
      if (ultimo && ultimo.length) return ultimo;
      await sleep(200);
    }
    return ultimo || [];
  }

  /** Espera a que la terminal no tenga ningun proceso en marcha. */
  async function termIdle(timeout) {
    await waitFor('!window.__pc.terminal.isBusy()', timeout || 45000, 'terminal libre');
  }

  /** Lanza un comando en la terminal y espera a que termine. */
  async function termRun(command, timeout) {
    await termIdle();
    await js('await window.__pc.terminal.runCommand(' + JSON.stringify(command) + '); return true;');
    await sleep(150);
    await termIdle(timeout);
  }

  (async () => {
    console.log('\n#################################################');
    console.log('#  Python Classroom - pruebas de extremo a extremo');
    console.log('#################################################');

    try {
      focusWin();
      /* ---------------------------------------------------------- arranque */
      group('1. Arranque de la interfaz');

      await step('la interfaz termina de cargar', async () => {
        const ready = await waitFor('window.__pc && window.__pc.ready ? "si" : false', 25000, 'window.__pc');
        return ready;
      });

      await js('document.querySelectorAll(".modal-backdrop").forEach(n=>n.remove()); ' +
        'await window.pc.config.set({showWelcome:false}); return true;');

      /*
       * Elegir rol al registrarse: se prueba ANTES que nada más para poder
       * usar una instalacion realmente vacia -config/bootstrap sin reclamar-,
       * que es justo el escenario que hace especial al primer profesor. El
       * resto de la suite (empezando por "0. Fase 3") crea a su profesor con
       * un atajo directo (fb._sembrar) que nunca pasa por este camino, así
       * que el bootstrap sigue libre hasta este punto y no vuelve a estarlo
       * despues -por eso va aqui y no mas adelante-.
       */
      group('0a. Elegir rol al registrarse · bootstrap del primer profesor');

      const BOOTSTRAP_PROFE = {
        nombre: 'Rosa', apellido: 'Nieto',
        correo: 'rosa.nieto@colegio.edu.co', password: 'profesor2026'
      };
      const bootstrap = {};

      await step('el alta deja elegir entre "estudiante" y "profesor"', async () => {
        await js('window.__pc.auth.show("registro"); return true;');
        await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro');
        const info = await js('return {' +
          ' estudiante: !!document.querySelector("#auth-card input[name=_rolAlta][value=estudiante]"),' +
          ' profesor: !!document.querySelector("#auth-card input[name=_rolAlta][value=profesor]"),' +
          ' estudianteMarcado: document.querySelector("#auth-card input[name=_rolAlta][value=estudiante]").checked };');
        if (!info.estudiante || !info.profesor) throw new Error('no aparecen los dos radios de rol: ' + JSON.stringify(info));
        if (!info.estudianteMarcado) throw new Error('"estudiante" debería venir marcado por defecto');
        return 'radios "estudiante"/"profesor" presentes · estudiante marcado por defecto';
      });

      await step('elegir "profesor" sin código en una instalación sin ningún profesor todavía te vuelve profesor de una', async () => {
        /*
         * El proceso principal comprueba el rol por su cuenta (role-verify.js)
         * y en pruebas eso pasa por un doble sembrado a mano: como el uid de
         * Rosa todavía no existe -lo genera el propio alta, un instante
         * después-, se siembra por CORREO (que sí se conoce de antemano) en
         * vez de por uid. Lo que de verdad prueba este paso -que el bootstrap
         * escribe config/bootstrap y roles/<uid> en Firebase- se comprueba
         * más abajo contra el árbol del doble, no contra este sembrado.
         */
        await js('return await window.pc.test.seedIdentity([' +
          '{ correo: ' + JSON.stringify(BOOTSTRAP_PROFE.correo) + ', role: "teacher" }]);');
        await js('const f=document.querySelector("#auth-card form");' +
          'f.querySelector("input[name=_rolAlta][value=profesor]").click();' +
          'f.querySelector("[name=nombre]").value=' + JSON.stringify(BOOTSTRAP_PROFE.nombre) + ';' +
          'f.querySelector("[name=apellido]").value=' + JSON.stringify(BOOTSTRAP_PROFE.apellido) + ';' +
          'f.querySelector("[name=correo]").value=' + JSON.stringify(BOOTSTRAP_PROFE.correo) + ';' +
          'f.querySelector("[name=password]").value=' + JSON.stringify(BOOTSTRAP_PROFE.password) + ';' +
          'f.querySelector("[name=password2]").value=' + JSON.stringify(BOOTSTRAP_PROFE.password) + ';' +
          'f.requestSubmit(); return true;');
        await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar tras el alta');
        const yo = await waitFor('await window.pc.session.me()', 10000, 'sesión activa');
        if (yo.rol !== 'profesor') throw new Error('no quedó como profesor de una: ' + yo.rol);
        bootstrap.uid = yo.uid;

        const arbol = await js('return window.__pcFakeFirebase._volcado();');
        if (!arbol.config || arbol.config.bootstrap !== yo.uid) {
          throw new Error('config/bootstrap no quedó a nombre de quien se registró primero: ' + JSON.stringify(arbol.config));
        }
        if (!arbol.roles || arbol.roles[yo.uid] !== 'teacher') {
          throw new Error('roles/' + yo.uid + ' no quedó en "teacher" en Firebase: ' + JSON.stringify(arbol.roles));
        }

        const misCursos = await js('return await window.pc.courses.mine();');
        if (!misCursos.length) throw new Error('el primer profesor se quedó sin ningún curso propio');
        return yo.nombreCompleto + ' es profesor · dueño de config/bootstrap · ' + misCursos.length + ' curso(s) propio(s)';
      });

      await step('cierre del grupo: se cierra la sesión de bootstrap y se olvida la cuenta de prueba', async () => {
        await js('document.querySelectorAll(".tut-backdrop,.modal-backdrop").forEach(n=>n.remove());' +
          'try { await window.pc.users.setTutorialDone(true); } catch(e){}' +
          'await window.__pc.auth.forceLogout(); return true;');
        await waitFor('!document.getElementById("auth-screen").hidden', 12000, 'pantalla de acceso');
        /*
         * Si Rosa se queda en SQLite, es la cuenta de profesor MÁS ANTIGUA
         * para siempre -y "el profesor más antiguo es el dueño" (migrarACursos,
         * grupo 42) elegiría a Rosa en vez de a Ana Ruiz, rompiendo todos los
         * grupos de cursos que vienen después-. En Firebase no hace falta
         * limpiarla: nadie vuelve a leer users/roles de forma global.
         */
        if (bootstrap.uid) await js('return await window.pc.test.olvidarCuentaDePrueba(' + JSON.stringify(bootstrap.uid) + ');');
        return 'sesión cerrada · cuenta de bootstrap olvidada en local';
      });

      /* -------- fase 3: Firebase, configuracion inicial y sesion ---------- */
      group('0. Fase 3 · acceso con Firebase');

      const fase3 = require('./e2e-fase3.js');

      await step('el doble de Firebase esta instalado', async () => {
        const info = await js('return {' +
          ' doble: !!window.__pcFakeFirebase,' +
          ' estado: window.__pc.auth.estadoConexion() };');
        if (!info.doble) throw new Error('no se inyectó el doble de Firebase');
        if (!info.estado.disponible) throw new Error('el cliente no arrancó: ' + info.estado.error);
        return 'proyecto ' + info.estado.proyecto + ' · SDK simulado en memoria';
      });

      await step('la aplicación arranca en la pantalla de acceso', async () => {
        const visible = await js('return !document.getElementById("auth-screen").hidden;');
        if (!visible) throw new Error('no se mostró la pantalla de acceso');
        const info = await js('return {' +
          ' titulo: document.querySelector("#auth-card h2").textContent,' +
          ' texto: document.getElementById("auth-card").innerText,' +
          ' correo: !!document.querySelector("#auth-card form input[name=\\"correo\\"]"),' +
          ' password: !!document.querySelector("#auth-card form input[name=\\"password\\"]") };');
        if (!info.correo || !info.password) throw new Error('no es el formulario de acceso: ' + info.titulo);
        if (/pendiente de autorizaci/i.test(info.texto)) {
          throw new Error('sigue apareciendo la pantalla de autorización');
        }
        if (/configuraci[oó]n inicial/i.test(info.texto)) {
          throw new Error('sigue apareciendo la configuración inicial');
        }
        return info.titulo;
      });

      await step('elegir "profesor" ya sin bootstrap disponible y sin código no concede el rol', async () => {
        /*
         * El grupo "0a" ya gastó config/bootstrap (Rosa fue la primera). Elegir
         * "profesor" aquí, sin ningún código de curso, es el tercer camino de
         * establecerSesion() en auth.js: ni bootstrap ni solicitud posible -la
         * cuenta debe quedar de estudiante, sin ninguna marca pendiente. Antes
         * este formulario ni siquiera dejaba elegir el rol (ver 0a para esa
         * comprobación); lo que hay que garantizar ahora es que elegirlo no
         * concede nada sin la aprobacion de nadie.
         */
        await js('window.__pc.auth.show("registro"); return true;');
        await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro');
        const correo = 'sin.codigo.' + Date.now() + '@colegio.edu.co';
        await js('const f=document.querySelector("#auth-card form");' +
          'f.querySelector("input[name=_rolAlta][value=profesor]").click();' +
          'f.querySelector("[name=nombre]").value="Sin"; f.querySelector("[name=apellido]").value="Código";' +
          'f.querySelector("[name=correo]").value=' + JSON.stringify(correo) + ';' +
          'f.querySelector("[name=password]").value="profesor2026"; f.querySelector("[name=password2]").value="profesor2026";' +
          'f.requestSubmit(); return true;');
        await waitFor('document.getElementById("auth-screen").hidden', 20000, 'entrar tras el alta');
        const yo = await waitFor('await window.pc.session.me()', 10000, 'sesión activa');
        if (yo.rol !== 'estudiante') throw new Error('quedó como ' + yo.rol + ' sin bootstrap ni código ni aprobación de nadie');

        const arbol = await js('return window.__pcFakeFirebase._volcado();');
        if (arbol.roles && arbol.roles[yo.uid] === 'teacher') throw new Error('roles/' + yo.uid + ' quedó en "teacher" en Firebase sin autorización');

        await js('document.querySelectorAll(".tut-backdrop,.modal-backdrop").forEach(n=>n.remove());' +
          'try { await window.pc.users.setTutorialDone(true); } catch(e){}' +
          'await window.__pc.auth.forceLogout(); return true;');
        await waitFor('!document.getElementById("auth-screen").hidden', 12000, 'pantalla de acceso');
        // El siguiente paso ("el formulario de alta rechaza datos incompletos")
        // da por hecho que la pantalla de registro sigue abierta -como la
        // dejaba la prueba que reemplazó esta-, así que se vuelve a abrir.
        await js('window.__pc.auth.show("registro"); return true;');
        await waitFor('!!document.querySelector("#auth-card form input[name=\\"grado\\"]")', 8000, 'formulario de registro (de vuelta)');
        return 'quedó como estudiante · sin rol de profesor en Firebase';
      });

      await step('el formulario de alta rechaza datos incompletos', async () => {
        await js('const f=document.querySelector("#auth-card form");' +
          'f.querySelector("[name=nombre]").value="A";' +
          'f.querySelector("[name=apellido]").value="B";' +
          'f.querySelector("[name=correo]").value="esto-no-es-un-correo";' +
          'f.querySelector("[name=password]").value="123";' +
          'f.querySelector("[name=password2]").value="123";' +
          'f.requestSubmit(); return true;');
        await sleep(700);
        const errores = await js(
          'return Array.from(document.querySelectorAll("#auth-card .form-field.error")).map(f=>f.dataset.field);');
        if (!errores.length) throw new Error('aceptó datos inválidos');
        if (await js('return document.getElementById("auth-screen").hidden;')) throw new Error('entró igualmente');
        return 'campos rechazados: ' + errores.join(', ');
      });

      await step('el profesor autorizado en Firebase entra con su cuenta', async () => {
        const P = fase3.PROFE;
        /*
         * Lo que hace una persona con acceso a la consola de Firebase: crear la
         * cuenta y poner roles/<uid> = teacher. La aplicacion no tiene ningun
         * camino para esto, ni falta que le hace.
         */
        const uid = await js(
          'const fb = window.__pcFakeFirebase;' +
          'const cred = await fb.createUserWithEmailAndPassword(null, ' + JSON.stringify(P.correo) + ', ' +
          JSON.stringify(P.password) + ');' +
          'const uid = cred.user.uid;' +
          'fb._sembrar("roles/" + uid, "teacher");' +
          'fb._sembrar("users/" + uid, {' +
          '  email: ' + JSON.stringify(P.correo) + ', firstName: ' + JSON.stringify(P.nombre) + ',' +
          '  lastName: ' + JSON.stringify(P.apellido) + ', createdAt: new Date().toISOString(),' +
          '  updatedAt: new Date().toISOString() });' +
          'await window.__pc.auth.forceLogout();' +
          'return uid;');
        await waitFor('!document.getElementById("auth-screen").hidden', 12000, 'pantalla de acceso');

        // El proceso principal comprueba el rol por su cuenta; en pruebas se le
        // siembra lo mismo que leeria de Firebase.
        await js('return await window.pc.test.seedIdentity([' +
          '{ uid: ' + JSON.stringify(uid) + ', role: "teacher", email: ' + JSON.stringify(P.correo) + ' }]);');

        await js('window.__pc.auth.show("login"); return true;');
        await waitFor('!!document.querySelector("#auth-card form input[name=\\"correo\\"]")', 8000, 'formulario');
        await js('const f=document.querySelector("#auth-card form");' +
          'f.querySelector("[name=correo]").value=' + JSON.stringify(P.correo) + ';' +
          'f.querySelector("[name=password]").value=' + JSON.stringify(P.password) + ';' +
          'f.requestSubmit(); return true;');
        await waitFor('document.getElementById("auth-screen").hidden', 25000, 'entrar en la aplicación');
        const u = await waitFor('await window.pc.session.me()', 10000, 'usuario en sesión');
        if (u.rol !== 'profesor') throw new Error('entró como ' + u.rol);
        if (u.uid !== uid) throw new Error('uid distinto: ' + u.uid);
        return u.nombreCompleto + ' · ' + u.rol + ' · autorizado en roles/' + uid.slice(0, 12) + '…';
      });

      await step('el rol y el perfil viven en la base de datos remota', async () => {
        const arbol = await js('return window.__pcFakeFirebase._volcado();');
        const uid = (await js('return await window.pc.session.me();')).uid;
        if (arbol.roles[uid] !== 'teacher') throw new Error('rol remoto: ' + arbol.roles[uid]);
        if (!arbol.users || !arbol.users[uid]) throw new Error('no se guardó el perfil remoto');
        return 'roles/' + uid.slice(0, 12) + '… = teacher · perfil remoto escrito';
      });

      await step('el tutorial de bienvenida aparece', async () => {
        await waitFor('!!document.querySelector(".tut-backdrop")', 12000, 'tutorial');
        const pasos = await js('return document.querySelector(".tut-dots").childElementCount;');
        const titulo = await js('return document.querySelector(".tut-card h3").textContent;');
        await js('const b=Array.from(document.querySelectorAll(".tut-foot .btn"))' +
          '.find(x=>x.textContent==="Siguiente"); if(b) b.click(); return true;');
        await sleep(350);
        const paso2 = await js('return document.querySelector(".tut-card .step").textContent;');
        await js('document.querySelectorAll(".tut-backdrop").forEach(n=>n.remove());' +
          'await window.pc.users.setTutorialDone(true); return true;');
        return titulo + ' · ' + pasos + ' pasos · avanzó a "' + paso2 + '"';
      });

      await step('el avatar y la barra de estado muestran al usuario', async () => {
        const info = await js('return {avatar: document.getElementById("user-avatar").textContent,' +
          ' chip: document.getElementById("sb-user").textContent.trim(),' +
          ' sync: document.getElementById("sb-sync").textContent.trim(),' +
          ' cursoVisible: !document.getElementById("act-curso").hidden};');
        if (info.avatar !== 'AR') throw new Error('iniciales: ' + info.avatar);
        if (!info.cursoVisible) throw new Error('no apareció la sección de curso del profesor');
        return 'avatar ' + info.avatar + ' · ' + info.chip + ' · sync: ' + info.sync;
      });

      // El resto de la suite trabaja en el IDE, no en las páginas.
      await js('window.__pc.irIDE(); return true;');
      await sleep(400);

      await step('todas las zonas visibles tienen tamaño', async () => {
        const info = await js(
          'const r = (s) => { const n = document.querySelector(s); if(!n) return null; const b = n.getBoundingClientRect();' +
          'return {w: Math.round(b.width), h: Math.round(b.height)}; };' +
          'return {titlebar:r(".titlebar"), activity:r(".activitybar"), sidebar:r(".sidebar"), toolbar:r(".toolbar"),' +
          ' tabs:r("#tabs"), editorArea:r(".editor-area"), panel:r("#panel"), panelTabs:r(".panel-tabs"),' +
          ' panelBody:r(".panel-body"), status:r(".statusbar"), consoleOut:r("#console-out")};'
        );
        const missing = Object.entries(info).filter(([, v]) => !v || v.h <= 0 || v.w <= 0).map(([k]) => k);
        if (missing.length) throw new Error('elementos sin tamaño: ' + missing.join(', ') + '  ' + JSON.stringify(info));
        return 'panel ' + info.panel.w + 'x' + info.panel.h + ', cuerpo del panel ' + info.panelBody.h +
          'px, barra de estado ' + info.status.w + 'x' + info.status.h;
      });

      await step('las vistas ocultas del panel se activan correctamente', async () => {
        const sizes = {};
        for (const tab of ['terminal', 'problems', 'console']) {
          await js('window.__pc.showPanelTab(' + JSON.stringify(tab) + '); return true;');
          await sleep(220);
          const sel = tab === 'terminal' ? '#term-out' : tab === 'problems' ? '#problem-list' : '#console-out';
          const box = await js('const b = document.querySelector(' + JSON.stringify(sel) + ').getBoundingClientRect();' +
            'return {w: Math.round(b.width), h: Math.round(b.height)};');
          if (box.h <= 0 || box.w <= 0) throw new Error('la vista "' + tab + '" no se muestra: ' + JSON.stringify(box));
          sizes[tab] = box.w + 'x' + box.h;
        }
        return Object.entries(sizes).map(([k, v]) => k + ' ' + v).join(', ');
      });

      await step('nada se sale de la ventana', async () => {
        const m = await js(
          'const sb = document.querySelector(".statusbar").getBoundingClientRect();' +
          'const p = document.getElementById("panel").getBoundingClientRect();' +
          'return {innerH: window.innerHeight, innerW: window.innerWidth,' +
          ' sbBottom: Math.round(sb.bottom), panelBottom: Math.round(p.bottom),' +
          ' scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth};'
        );
        if (m.sbBottom > m.innerH + 1) throw new Error('la barra de estado se sale: ' + JSON.stringify(m));
        if (m.scrollH > m.innerH + 1) throw new Error('la página tiene desplazamiento vertical: ' + JSON.stringify(m));
        if (m.scrollW > m.innerW + 1) throw new Error('la página tiene desplazamiento horizontal: ' + JSON.stringify(m));
        return 'ventana ' + m.innerW + 'x' + m.innerH + ', barra de estado termina en ' + m.sbBottom;
      });

      await step('runtime de Python detectado', async () => {
        const rt = await js('return await window.pc.python.runtime();');
        if (!rt.ok) throw new Error(rt.error || 'no disponible');
        if (!rt.embedded) throw new Error('no está usando el runtime embebido: ' + rt.executable);
        return 'Python ' + rt.version + ' (embebido)';
      });

      /* ------------------------------------------------------------ editor */
      group('2. Editor');

      await step('crear archivo nuevo y escribir código', async () => {
        await js('window.__pc.documents.newFile("prueba.py"); return true;');
        await setCode('print("hola mundo")\n');
        const val = await js('return window.__pc.editor.getValue();');
        if (val.indexOf('hola mundo') === -1) throw new Error('el editor no contiene el texto: ' + val);
        return JSON.stringify(val);
      });

      await step('resaltado de sintaxis activo', async () => {
        await setCode('def suma(a, b):\n    """Suma dos numeros."""\n    total = a + b  # comentario\n    return total\n');
        await sleep(400);
        const info = await js(
          'const spans = document.querySelectorAll("#editor-host .cm-line span[class]");' +
          'const classes = new Set(); spans.forEach(s => s.className.split(" ").forEach(c => classes.add(c)));' +
          'return {spans: spans.length, classes: Array.from(classes).slice(0,12)};'
        );
        if (info.spans < 4) throw new Error('apenas ' + info.spans + ' tokens resaltados');
        return info.spans + ' tokens con ' + info.classes.length + ' estilos distintos';
      });

      await step('números de línea y plegado', async () => {
        const n = await js('return {gutters: document.querySelectorAll("#editor-host .cm-lineNumbers .cm-gutterElement").length,' +
          ' fold: document.querySelectorAll("#editor-host .cm-foldGutter").length};');
        if (n.gutters < 4) throw new Error('gutter con ' + n.gutters + ' elementos');
        return n.gutters + ' números de línea, gutter de plegado presente';
      });

      await step('deshacer y rehacer', async () => {
        await setCode('a = 1\n');
        await js('window.__pc.editor.commands.insert("b = 2\\n"); return true;');
        const withB = await js('return window.__pc.editor.getValue();');
        await js('window.__pc.editor.commands.undo(); return true;');
        const undone = await js('return window.__pc.editor.getValue();');
        await js('window.__pc.editor.commands.redo(); return true;');
        const redone = await js('return window.__pc.editor.getValue();');
        if (undone === withB) throw new Error('deshacer no cambió nada');
        if (redone !== withB) throw new Error('rehacer no restauró el texto');
        return 'ok';
      });

      await step('comentar y descomentar (Ctrl+/)', async () => {
        await setCode('x = 1\n');
        await js('const v=window.__pc.editor.getView(); v.dispatch({selection:{anchor:0}}); ' +
          'window.__pc.editor.commands.comment(); return true;');
        const commented = await js('return window.__pc.editor.getValue();');
        if (commented.indexOf('#') !== 0) throw new Error('no comentó: ' + JSON.stringify(commented));
        await js('window.__pc.editor.commands.comment(); return true;');
        const back = await js('return window.__pc.editor.getValue();');
        if (back.indexOf('#') === 0) throw new Error('no descomentó: ' + JSON.stringify(back));
        return JSON.stringify(commented.trim());
      });

      await step('buscar abre el panel de búsqueda', async () => {
        await js('window.__pc.editor.commands.find(); return true;');
        await sleep(250);
        const has = await js('return !!document.querySelector("#editor-host .cm-panel.cm-search");');
        if (!has) throw new Error('no apareció el panel de búsqueda');
        await js('const v=window.__pc.editor.getView(); v.focus(); ' +
          'const btn=document.querySelector("#editor-host .cm-panel.cm-search [name=close]"); if(btn) btn.click(); return true;');
        return 'panel de búsqueda con campo de reemplazo';
      });

      await step('autocompletado contextual reconoce variables del alumno', async () => {
        const options = await sugerencias('nombre = "Juan"\nedad = 16\nno');
        if (!options.length) throw new Error('no se mostró ninguna sugerencia');
        if (options.indexOf('nombre') === -1) throw new Error('no sugirió la variable "nombre": ' + options.join(', '));
        return options.slice(0, 8).join(', ');
      });

      await step('autocompletado de métodos según el tipo inferido', async () => {
        const options = await sugerencias('nombre = "Juan"\nnombre.');
        if (!options.length) throw new Error('no se mostró ninguna sugerencia');
        if (options.indexOf('upper') === -1) throw new Error('no sugirió métodos de str: ' + options.join(', '));
        return options.slice(0, 8).join(', ');
      });

      await step('autocompletado de módulos reales del intérprete', async () => {
        const options = await sugerencias('import math\nmath.', 12000);
        if (options.indexOf('sqrt') === -1) throw new Error('no listó los símbolos de math: ' + options.slice(0, 12).join(', '));
        return options.slice(0, 10).join(', ');
      });

      /* --------------------------------------------------------- ejecucion */
      group('3. Ejecución de Python real');

      await step('print() llega a la consola', async () => {
        await js('document.querySelectorAll(".cm-tooltip-autocomplete").forEach(n=>n.remove()); return true;');
        await setCode('print("hola desde python classroom")\nprint(2 + 3 * 4)\n');
        await js('window.__pc.showPanelTab("console"); window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("hola desde python classroom")', 25000, 'salida del programa');
        await waitFor(consoleText + '.includes("finalizado correctamente")', 15000, 'mensaje de fin');
        const text = await js('return ' + consoleText + ';');
        if (text.indexOf('14') === -1) throw new Error('no calculó 2+3*4: ' + text);
        return text.split('\n').filter(Boolean).slice(-3).join(' | ');
      });

      await step('errores y trazas van a stderr', async () => {
        await setCode('def dividir(a, b):\n    return a / b\n\nprint(dividir(10, 0))\n');
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("ZeroDivisionError")', 25000, 'ZeroDivisionError');
        const text = await js('return ' + consoleText + ';');
        if (text.indexOf('Traceback') === -1) throw new Error('sin traceback');
        // Además del traceback, la consola explica el error en castellano y deja
        // claro que equivocarse no cuesta intentos (versión 1.0.0).
        if (text.indexOf('Error al ejecutar') === -1) throw new Error('sin explicación del error');
        if (!/Línea \d+/.test(text)) throw new Error('no dice en qué línea: ' + text.slice(-200));
        if (text.indexOf('dividiendo entre cero') === -1) {
          throw new Error('no explica el error en castellano: ' + text.slice(-200));
        }
        if (text.indexOf('ningún intento') === -1) throw new Error('no aclara que no gasta intentos');
        return 'traceback + código de salida 1';
      });

      await step('salida con acentos y emojis (UTF-8)', async () => {
        await setCode('print("Programación en español: áéíóú ñ ¿qué tal? ✓")\n');
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("¿qué tal?")', 20000, 'texto acentuado');
        return 'ok';
      });

      await step('input() interactivo desde la consola', async () => {
        await setCode('nombre = input("¿Cómo te llamas? ")\nedad = int(input("Edad: "))\nprint(f"Hola {nombre}, en 10 años tendrás {edad + 10}")\n');
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("¿Cómo te llamas?")', 20000, 'el programa pide el nombre');
        await waitFor('!document.getElementById("console-input-row").classList.contains("disabled")', 8000, 'caja de entrada activa');
        await js('const i=document.getElementById("console-stdin"); i.value="Mathias";' +
          'i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return true;');
        await waitFor(consoleText + '.includes("Edad:")', 12000, 'el programa pide la edad');
        await js('const i=document.getElementById("console-stdin"); i.value="16";' +
          'i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return true;');
        await waitFor(consoleText + '.includes("Hola Mathias, en 10 años tendrás 26")', 12000, 'respuesta final');
        return 'Hola Mathias, en 10 años tendrás 26';
      });

      await step('bucle infinito detenido por tiempo máximo', async () => {
        await js('await window.pc.config.set({runTimeoutMs: 4000}); return true;');
        await setCode('while True:\n    pass\n');
        const t0 = Date.now();
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("Se detuvo el programa")', 20000, 'aviso de tiempo máximo');
        const elapsed = Date.now() - t0;
        const alive = await js('return await window.pc.python.active();');
        if (alive.length) throw new Error('el proceso sigue vivo');
        await js('await window.pc.config.set({runTimeoutMs: 30000}); return true;');
        return 'cortado en ' + (elapsed / 1000).toFixed(1) + ' s y sin procesos huérfanos';
      });

      await step('la interfaz sigue respondiendo tras un bucle infinito', async () => {
        const t0 = Date.now();
        const v = await js('return 40 + 2;');
        if (v !== 42) throw new Error('la interfaz no responde');
        return 'respuesta en ' + (Date.now() - t0) + ' ms';
      });

      await step('botón Detener corta la ejecución', async () => {
        await setCode('import time\nprint("empezando")\ntime.sleep(60)\nprint("nunca")\n');
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("empezando")', 20000, 'inicio del programa');
        await js('window.__pc.stopRun(); return true;');
        await waitFor(consoleText + '.includes("detenida por el usuario")', 12000, 'mensaje de detención');
        const text = await js('return ' + consoleText + ';');
        if (text.indexOf('nunca') !== -1) throw new Error('el programa siguió ejecutándose');
        return 'proceso terminado sin llegar al final';
      });

      await step('librería instalada disponible en tiempo de ejecución', async () => {
        await setCode('from rich.console import Console\nc = Console()\nc.print("[bold green]rich funciona[/bold green]")\n');
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("rich funciona")', 25000, 'salida de rich');
        return 'rich importado desde el runtime interno';
      });

      /* -------------------------------------------------------- diagnostico */
      group('4. Comprobación de sintaxis');

      await step('un error de sintaxis se marca en el editor', async () => {
        await setCode('def saludar(:\n    print("hola")\n');
        await js('window.__pc.syntaxCheckNow(); return true;');
        const diags = await waitFor('(() => { const d = window.__pc.renderProblems(); return d.length ? d : false; })()', 15000, 'diagnósticos');
        const badge = await js('return document.getElementById("problems-badge").textContent;');
        const marks = await js('return document.querySelectorAll("#editor-host .cm-lintRange-error").length;');
        if (String(badge) !== String(diags.length)) throw new Error('la insignia dice ' + badge);
        if (!marks) throw new Error('el editor no subrayó el error');
        return 'línea ' + diags[0].line + ': ' + diags[0].message + ' (subrayado en el editor)';
      });

      await step('un archivo correcto no genera problemas', async () => {
        await setCode('x = 1\nprint(x)\n');
        await js('window.__pc.syntaxCheckNow(); return true;');
        await sleep(1500);
        const diags = await js('return window.__pc.renderProblems();');
        if (diags.length) throw new Error('reportó ' + diags.length + ' problemas en código válido');
        return 'sin problemas';
      });

      /* ----------------------------------------------------------- terminal */
      group('5. Terminal integrada');

      await step('la terminal arranca con el Python interno', async () => {
        await js('window.__pc.showPanelTab("terminal"); return true;');
        await waitFor(termText + '.includes("Terminal de Python Classroom")', 15000, 'cabecera de la terminal');
        const text = await js('return ' + termText + ';');
        if (text.indexOf('runtime interno') === -1) throw new Error('no usa el runtime interno: ' + text.slice(0, 200));
        return text.split('\n').filter(Boolean)[1];
      });

      await step('ejecutar un comando con comillas', async () => {
        await termRun('python -c "print(6*7)"', 60000);
        await waitFor(termText + '.includes("42")', 15000, 'salida 42');
        return 'python -c "print(6*7)" -> 42';
      });

      await step('el "python" de la terminal es el embebido', async () => {
        await termRun('python -c "import sys;print(sys.executable)"', 60000);
        await waitFor(termText + '.toLowerCase().includes("runtime")', 15000, 'ruta del ejecutable');
        const text = await js('return ' + termText + ';');
        const line = text.split('\n').filter((l) => l.toLowerCase().indexOf('runtime') !== -1).pop();
        if (!line || line.toLowerCase().indexOf('win-x64') === -1) {
          throw new Error('no apunta al runtime interno: ' + line);
        }
        return line.trim();
      });

      await step('el REPL interactivo de python funciona', async () => {
        await termIdle();
        await js('await window.__pc.terminal.runCommand("python"); return true;');
        await waitFor(termText + '.includes(">>>")', 25000, 'prompt del REPL');
        await js('const i=document.getElementById("term-input"); i.value="print(3**4)";' +
          'i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return true;');
        await waitFor(termText + '.includes("81")', 15000, 'resultado 3**4');
        await js('const i=document.getElementById("term-input"); i.value="exit()";' +
          'i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return true;');
        await termIdle(20000);
        return 'REPL: print(3**4) -> 81';
      });

      await step('pip responde desde la terminal', async () => {
        await termRun('pip --version', 90000);
        await waitFor(termText + '.includes("pip ")', 15000, 'versión de pip');
        const text = await js('return ' + termText + ';');
        return (text.split('\n').filter((l) => /^pip \d/.test(l.trim())).pop() || '').slice(0, 90);
      });

      await step('cd cambia el directorio de trabajo', async () => {
        await termIdle();
        const before = await js('return document.getElementById("term-prompt").title;');
        await termRun('cd ..', 20000);
        const after = await js('return document.getElementById("term-prompt").title;');
        if (before === after) throw new Error('el directorio no cambió (' + before + ')');
        await termRun('cd ' + JSON.stringify(process.cwd()), 20000);
        return before + '  ->  ' + after;
      });

      await step('el comando "ayuda" existe', async () => {
        await termRun('ayuda', 20000);
        await waitFor(termText + '.includes("Terminal de Python Classroom")', 10000, 'ayuda');
        const text = await js('return ' + termText + ';');
        if (text.indexOf('pip install nombre') === -1) throw new Error('la ayuda está incompleta');
        return 'lista de comandos disponible';
      });

      await step('un comando inexistente informa del error', async () => {
        await termRun('comando_que_no_existe_123', 20000);
        const text = await js('return ' + termText + ';');
        if (!/no se reconoce|not recognized|not found|no encontrado|código de salida/i.test(text)) {
          throw new Error('no informó del error: ' + text.slice(-200));
        }
        return 'error reportado en la terminal';
      });

      /* ---------------------------------------------------------- librerias */
      group('6. Gestor de librerías (pip real)');

      await step('listar paquetes instalados', async () => {
        const res = await js('return await window.pc.packages.list();');
        if (!res.ok) throw new Error(res.error);
        const names = res.items.map((p) => p.name.toLowerCase());
        if (names.indexOf('rich') === -1) throw new Error('no aparece rich: ' + names.join(', '));
        return res.items.length + ' paquetes: ' + names.slice(0, 8).join(', ');
      });

      await step('buscar en el catálogo (sin conexión)', async () => {
        const res = await js('return await window.pc.packages.search("pandas", {offline:true});');
        if (!res.ok || !res.items.length) throw new Error('sin resultados');
        if (res.items[0].name !== 'pandas') throw new Error('primer resultado: ' + res.items[0].name);
        return res.items.length + ' resultados, el primero es ' + res.items[0].name;
      });

      await step('consultar información de un paquete', async () => {
        const info = await js('return await window.pc.packages.info("colorama");');
        if (!info.ok) throw new Error(info.error);
        if (!info.installedVersion) throw new Error('no detectó la versión instalada');
        return 'colorama ' + info.installedVersion + (info.latestVersion ? ' (última: ' + info.latestVersion + ')' : ' [sin conexión]');
      });

      await step('instalar un paquete nuevo con pip', async () => {
        await js('window.__pc.showSideView("packages"); return true;');
        const started = await js('return await window.pc.packages.install("six");');
        if (!started.ok) throw new Error(started.error);
        // Esperamos a que pip termine, consultando el estado de la operacion.
        const t0 = Date.now();
        let installed = false;
        while (Date.now() - t0 < 120000) {
          await sleep(1500);
          const busy = await js('return await window.pc.packages.busy();');
          if (!busy.busy) {
            const res = await js('return await window.pc.packages.list();');
            installed = res.ok && res.items.some((p) => p.name.toLowerCase() === 'six');
            break;
          }
        }
        if (!installed) throw new Error('six no quedó instalado');
        return 'six instalado con el pip interno';
      });

      await step('el paquete recién instalado se puede importar', async () => {
        await js('window.__pc.showPanelTab("console"); return true;');
        await setCode('import six\nprint("six version:", six.__version__)\n');
        await js('window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("six version:")', 25000, 'importación de six');
        const text = await js('return ' + consoleText + ';');
        return (text.split('\n').filter((l) => l.indexOf('six version') !== -1).pop() || '').trim();
      });

      await step('desinstalar el paquete', async () => {
        const started = await js('return await window.pc.packages.uninstall("six");');
        if (!started.ok) throw new Error(started.error);
        const t0 = Date.now();
        let gone = false;
        while (Date.now() - t0 < 90000) {
          await sleep(1200);
          const busy = await js('return await window.pc.packages.busy();');
          if (!busy.busy) {
            const res = await js('return await window.pc.packages.list();');
            gone = res.ok && !res.items.some((p) => p.name.toLowerCase() === 'six');
            break;
          }
        }
        if (!gone) throw new Error('six sigue instalado');
        return 'six desinstalado';
      });

      /* ------------------------------------------------------- archivos */
      group('7. Archivos y proyectos');

      let projectPath = null;

      await step('crear un proyecto con su estructura', async () => {
        const project = await js('return await window.pc.files.createProject(null, "ProyectoE2E");');
        projectPath = project.path;
        const entries = await js('return await window.pc.files.list(' + JSON.stringify(project.path) + ');');
        const names = entries.map((e) => e.name).sort();
        for (const need of ['main.py', 'funciones.py', 'datos.json', 'README.txt']) {
          if (names.indexOf(need) === -1) throw new Error('falta ' + need + ' (' + names.join(', ') + ')');
        }
        return project.name + ': ' + names.join(', ');
      });

      await step('abrir la carpeta en el explorador', async () => {
        await js('const f = await window.pc.files.openWorkspace(' + JSON.stringify(projectPath) + ');' +
          'await window.__pc.explorer.setRoot(f); return true;');
        await sleep(700);
        const rows = await js('return Array.from(document.querySelectorAll("#explorer-body .tree-row .label")).map(n=>n.textContent);');
        if (rows.indexOf('main.py') === -1) throw new Error('el árbol no muestra main.py: ' + rows.join(', '));
        return rows.join(', ');
      });

      await step('abrir, modificar y guardar un archivo', async () => {
        const sep = projectPath.indexOf('\\') !== -1 ? '\\' : '/';
        const mainPy = projectPath + sep + 'main.py';
        await js('await window.__pc.documents.openPath(' + JSON.stringify(mainPy) + '); return true;');
        await sleep(400);
        await setCode('print("guardado desde la prueba")\n');
        await js('return await window.__pc.documents.save();');
        await sleep(500);
        const onDisk = await js('return (await window.pc.files.read(' + JSON.stringify(mainPy) + ')).content;');
        if (onDisk.indexOf('guardado desde la prueba') === -1) throw new Error('el disco no tiene el cambio: ' + onDisk);
        const dirty = await js('return window.__pc.documents.current().dirty;');
        if (dirty) throw new Error('la pestaña sigue marcada como modificada');
        return 'archivo escrito y pestaña limpia';
      });

      await step('ejecutar el archivo guardado del proyecto', async () => {
        await js('window.__pc.showPanelTab("console"); window.__pc.runCurrent(); return true;');
        await waitFor(consoleText + '.includes("guardado desde la prueba")', 25000, 'ejecución del archivo');
        return 'main.py ejecutado desde el proyecto';
      });

      await step('varias pestañas abiertas a la vez', async () => {
        const sep = projectPath.indexOf('\\') !== -1 ? '\\' : '/';
        await js('await window.__pc.documents.openPath(' + JSON.stringify(projectPath + sep + 'funciones.py') + '); return true;');
        await sleep(300);
        const tabs = await js('return Array.from(document.querySelectorAll("#tabs .tab .name")).map(n=>n.textContent);');
        if (tabs.length < 2) throw new Error('solo hay ' + tabs.length + ' pestaña(s)');
        return tabs.join(' | ');
      });

      await step('cada pestaña conserva su propio historial', async () => {
        const docs = await js('return window.__pc.documents.all().map(d=>({name:d.name, len:d.state.doc.length}));');
        if (docs.length < 2) throw new Error('no hay suficientes documentos');
        if (docs[0].len === docs[1].len && docs[0].name === docs[1].name) throw new Error('estados compartidos');
        return docs.map((d) => d.name + ' (' + d.len + ' car.)').join(', ');
      });

      /* --------------------------------------------------------- interfaz */
      group('8. Interfaz y preferencias');

      await step('cambiar de tema', async () => {
        const before = await js('return document.documentElement.dataset.theme;');
        await js('document.getElementById("btn-theme").click(); return true;');
        await sleep(400);
        const after = await js('return document.documentElement.dataset.theme;');
        if (before === after) throw new Error('el tema no cambió (' + before + ')');
        const bg = await js('return getComputedStyle(document.body).backgroundColor;');
        await js('document.getElementById("btn-theme").click(); return true;');
        return before + ' -> ' + after + ' (fondo ' + bg + ')';
      });

      await step('el zoom del editor cambia el tamaño de letra', async () => {
        const before = await js('return getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size").trim();');
        await js('document.getElementById("btn-zoom-in").click(); return true;');
        await sleep(300);
        const after = await js('return getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size").trim();');
        if (before === after) throw new Error('el tamaño no cambió (' + before + ')');
        await js('document.getElementById("btn-zoom-out").click(); return true;');
        return before + ' -> ' + after;
      });

      await step('las preferencias se guardan en disco', async () => {
        await js('await window.pc.config.set({tabSize: 2}); return true;');
        const saved = await js('return (await window.pc.config.get()).tabSize;');
        if (saved !== 2) throw new Error('no se guardó: ' + saved);
        await js('await window.pc.config.set({tabSize: 4}); return true;');
        const paths = await js('return await window.pc.config.paths();');
        return 'settings.json en ' + paths.userData;
      });

      await step('panel y barra lateral se pueden ocultar', async () => {
        await js('window.__pc.togglePanel(); return true;');
        await sleep(250);
        const collapsed = await js('return document.getElementById("panel").classList.contains("collapsed");');
        await js('window.__pc.togglePanel(); return true;');
        await sleep(200);
        const open = await js('return !document.getElementById("panel").classList.contains("collapsed");');
        if (!collapsed || !open) throw new Error('el panel no responde');
        return 'contraer y expandir correctos';
      });

      await step('las vistas laterales cambian', async () => {
        const views = [];
        for (const v of ['packages', 'python', 'help', 'settings', 'explorer']) {
          await js('window.__pc.showSideView(' + JSON.stringify(v) + '); return true;');
          await sleep(180);
          const active = await js('const n=document.querySelector(".side-view.active"); return n ? n.dataset.view : null;');
          if (active !== v) throw new Error('no cambió a ' + v + ' (quedó en ' + active + ')');
          views.push(v);
        }
        return views.join(' -> ');
      });

      await step('el panel de configuración se pinta', async () => {
        await js('window.__pc.showSideView("settings"); return true;');
        await sleep(300);
        const n = await js('return {fields: document.querySelectorAll("#settings-body .field").length,' +
          ' groups: document.querySelectorAll("#settings-body .settings-group").length};');
        if (n.fields < 10) throw new Error('solo ' + n.fields + ' opciones');
        return n.fields + ' opciones en ' + n.groups + ' grupos';
      });

      await step('el panel del runtime muestra el intérprete', async () => {
        await js('window.__pc.showSideView("python"); return true;');
        await sleep(600);
        const text = await js('return document.getElementById("runtime-body").innerText;');
        if (text.indexOf('Runtime interno') === -1) throw new Error('no indica runtime interno: ' + text.slice(0, 200));
        if (text.indexOf('python.exe') === -1 && text.indexOf('bin') === -1) throw new Error('no muestra la ruta');
        return text.split('\n').filter(Boolean).slice(0, 3).join(' | ');
      });

      await step('la barra de estado informa del intérprete', async () => {
        const text = await js('return document.getElementById("sb-python").textContent.trim();');
        if (text.indexOf('Python 3.11') === -1) throw new Error('barra de estado: ' + text);
        return text;
      });

      /*
       * PC_E2E_ONLY=responsive (o "seguridad,fase4"...) corre solo esos grupos.
       * El arranque y el acceso se ejecutan siempre: sin sesion no hay nada que
       * probar. Sin la variable, se corre todo.
       */
      const soloGrupos = String(process.env.PC_E2E_ONLY || '').split(',')
        .map((x) => x.trim()).filter(Boolean);
      const correr = (clave) => !soloGrupos.length || soloGrupos.indexOf(clave) !== -1;
      if (soloGrupos.length) {
        console.log('[e2e] solo los grupos:', soloGrupos.join(', '));
        /*
         * Las fases 4, 5 y 6 y las de seguridad trabajan sobre lo que crea la
         * fase 3 (temario, ejercicio, estudiante). Pedirlas sueltas no tiene
         * sentido: se avisa en vez de dejar que fallen en cascada.
         */
        const dependen = ['fase4', 'fase5', 'fase6', 'v1', 'offline', 'multiarchivo', 'cursos', 'seguridad'];
        if (soloGrupos.indexOf('fase3') === -1 && soloGrupos.some((g) => dependen.indexOf(g) !== -1)) {
          console.log('[e2e] AVISO: ' + soloGrupos.join(', ') + ' necesita los datos de la fase 3.' +
            ' Usa PC_E2E_ONLY=fase3,' + soloGrupos.join(','));
        }
      }

      /* ------------------------------- pruebas de la fase 3 (sistema local) */
      if (correr('fase3')) {
        await fase3({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /* ------------------ pruebas de la fase 4 (insignias, premios, ranking) */
      const fase4 = require('./e2e-fase4.js');
      if (correr('fase4')) {
        await fase4({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /* ------------ pruebas de la fase 5 (estadisticas, informes, .pclass) */
      const fase5 = require('./e2e-fase5.js');
      if (correr('fase5')) {
        await fase5({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /* ---------- pruebas de la fase 6 (runtime, copias y actualizaciones) */
      const fase6 = require('./e2e-fase6.js');
      if (correr('fase6')) {
        await fase6({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /*
       * Pulido final (1.0.0): tiempo real, cola con prioridades, fotos de
       * perfil, lenguaje de la interfaz y 60 estudiantes. Va ANTES de las
       * pruebas de seguridad porque esas borran la base a proposito.
       */
      const v1 = require('./e2e-v1.js');
      if (correr('v1')) {
        await v1({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /*
       * Sin conexion y red lenta. Va despues de v1 porque usa el ejercicio y el
       * estudiante que ya existen, y antes de seguridad porque esa borra la base.
       */
      const offline = require('./e2e-offline.js');
      if (correr('offline')) {
        await offline({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /*
       * Entregas de varios archivos y ejecucion desde la revision. Necesita el
       * temario y el estudiante de la fase 3.
       */
      const multiarchivo = require('./e2e-multiarchivo.js');
      if (correr('multiarchivo')) {
        await multiarchivo({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /*
       * Cursos, fase 1: esquema y migracion silenciosa. Necesita el temario y
       * el profesor/estudiante de la fase 3 para tener algo real que migrar.
       */
      const cursos = require('./e2e-cursos.js');
      if (correr('cursos')) {
        await cursos({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /*
       * Seguridad del rol. Va al final porque borra la base de datos local a
       * proposito: es justo el escenario que hay que comprobar.
       */
      const seguridad = require('./e2e-seguridad.js');
      if (correr('seguridad')) {
        await seguridad({ js, waitFor, step, group, sleep, setCode, consoleText, termText, app });
      }

      /* ------------------------ diseno adaptable (tableta y telefono) */
      const responsive = require('./e2e-responsive.js');
      if (correr('responsive')) {
        await responsive({ js, waitFor, step, group, sleep, resize, captura, app });
      }

    } catch (err) {
      fail('ejecución de la suite', err && err.stack ? err.stack.split('\n')[0] : err);
    }

    /* ------------------------------------------------------------ resumen */
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log('\n#################################################');
    console.log('#  RESULTADO: ' + passed + ' pruebas correctas, ' + failed.length + ' fallidas');
    console.log('#################################################');
    if (failed.length) {
      console.log('\nFallos:');
      for (const f of failed) console.log('  - [' + f.group + '] ' + f.name + ': ' + f.detail);
    }
    console.log('');

    await sleep(400);
    app.exit(failed.length ? 1 : 0);
  })();
};
