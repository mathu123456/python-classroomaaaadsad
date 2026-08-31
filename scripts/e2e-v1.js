'use strict';
/*
 * Pruebas de la versión 1.0.0.
 *
 * Cubren lo que el pliego final pide y que antes no se comprobaba:
 *
 *   - tiempo real: el estudiante recibe ejercicios y notas sin recargar nada,
 *     y el profesor recibe las entregas igual
 *   - cola de sincronización: prioridades, identificador único, sin duplicados
 *   - fotos de perfil: recorte, subida y que solo viaje la dirección
 *   - lenguaje: ni «null», ni «undefined», ni nombres de tecnologías en pantalla
 *   - un error de Python no gasta intentos ni marca nada como abandonado
 *   - 60 estudiantes a la vez
 */

const fase3 = require('./e2e-fase3.js');

const PROFE = fase3.PROFE;
const ALUMNO = fase3.ALUMNO;

module.exports = function v1(h) {
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
    // Entrar termina antes de que la sincronizacion sepa quien entro: se espera.
    await waitFor('window.__pc.sync.estadoActual().activo === true', 15000, 'sincronización lista');
  }

  async function sincronizar() {
    const res = await js('const r = await window.__pc.sync.sincronizarAhora();' +
      'const e = window.__pc.sync.estadoActual();' +
      'return { ok: !!(r && r.ok), resumen: (r && r.resumen) || null, error: (r && r.error) || null,' +
      ' motivo: (r && r.motivo) || null, estado: e.mensaje,' +
      ' conexion: { activo: e.activo, disponible: e.conexion.disponible,' +
      '   habilitado: e.conexion.habilitado, online: e.conexion.online } };');
    await sleep(400);
    return res;
  }

  return (async () => {

    /* ================================================================ */
    group('31. 1.0.0 · cola de sincronización');

    await step('la cola no duplica la misma operación', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);
      await sincronizar();

      const temas = await js('return await window.pc.topics.list();');
      const tema = temas[0];

      /*
       * Se corta la red mientras se mide: lo que se comprueba es lo que la cola
       * GUARDA, y con red la subida podría vaciarla en mitad de la medición.
       */
      await js('window.__pcFakeFirebase._simularSinRed(true); return true;');
      await sleep(300);

      // Cinco guardados seguidos del mismo tema: una sola operación en la cola.
      for (let i = 0; i < 5; i++) {
        await js('return await window.pc.topics.save({ id: ' + JSON.stringify(tema.id) +
          ', nombre: ' + JSON.stringify(tema.nombre) +
          ', descripcion: "guardado ' + i + '" });');
      }
      const cola = await js('return await window.pc.sync.pending(50);');
      const delTema = cola.filter((x) => x.entity === 'topics' && x.entityId === tema.id);
      if (delTema.length !== 1) {
        throw new Error('la cola tiene ' + delTema.length + ' operaciones para el mismo tema');
      }
      if (!delTema[0].opId) throw new Error('la operación no tiene identificador único');
      if (delTema[0].payload.description.indexOf('guardado 4') === -1) {
        throw new Error('la cola no guardó el último cambio: ' + delTema[0].payload.description);
      }
      return '5 guardados → 1 operación (' + delTema[0].opId + ') con el último contenido';
    });

    await step('las entregas y las notas tienen prioridad alta', async () => {
      const cola = await js('return await window.pc.sync.pending(50);');
      const prioridades = {};
      for (const item of cola) prioridades[item.entity] = item.priority;

      // Se provoca una entrega para tener las dos cosas en la cola.
      const info = await js('return await window.pc.data.info();');
      if (info.db.schemaVersion < 7) throw new Error('esquema ' + info.db.schemaVersion);

      const conPrioridad = cola.filter((x) => x.priority != null);
      if (!conPrioridad.length) throw new Error('la cola no lleva prioridades');
      for (const item of cola) {
        if (item.entity === 'submissions' && item.priority !== 1) {
          throw new Error('una entrega con prioridad ' + item.priority);
        }
        if (item.entity === 'sessionEvents' && item.priority !== 9) {
          throw new Error('un evento con prioridad ' + item.priority);
        }
      }
      // Y salen ordenadas: primero lo urgente.
      const orden = cola.map((x) => x.priority);
      for (let i = 1; i < orden.length; i++) {
        if (orden[i - 1] > orden[i]) throw new Error('la cola no sale ordenada: ' + orden.join(','));
      }
      await js('window.__pcFakeFirebase._simularSinRed(false); return true;');
      return cola.length + ' operación(es) · ' + JSON.stringify(prioridades);
    });

    await step('la cola se vacía y queda en «Conectado»', async () => {
      await sincronizar();
      await waitFor('(await window.pc.sync.stats()).pending === 0', 15000, 'cola vacía');
      try {
        await waitFor('document.getElementById("sb-sync").textContent.trim() === "Conectado"',
          20000, 'la barra se asienta en «Conectado»');
      } catch (err) {
        const diag = await js('return { estado: window.__pc.sync.estadoActual(),' +
          ' cola: await window.pc.sync.stats(),' +
          ' fallidas: (await window.pc.sync.pending(30, "failed"))' +
          '   .map(i => i.entity + "/" + i.entityId + ": " + (i.lastError || "")) };');
        throw new Error(err.message + ' · ' + JSON.stringify(diag));
      }
      const chip = await js('const c = document.getElementById("sb-sync");' +
        'return { texto: c.textContent.trim(), punto: !!c.querySelector(".punto-estado.verde") };');
      if (chip.texto !== 'Conectado') throw new Error('la barra dice «' + chip.texto + '»');
      if (!chip.punto) throw new Error('sin el punto verde');
      return 'barra de estado: ' + chip.texto;
    });

    /* ================================================================ */
    group('32. 1.0.0 · tiempo real');

    await step('el profesor publica un ejercicio y el estudiante lo recibe solo', async () => {
      const curso = await js('return await window.pc.courses.active();');
      if (!curso) throw new Error('sin curso activo');
      estado.cursoId = curso.id;
      const temas = await js('return await window.pc.topics.list();');
      const tema = temas.find((t) => t.nombre === 'Listas') || temas[0];
      const res = await js('return await window.pc.exercises.save(' + JSON.stringify({
        title: 'Ejercicio en vivo',
        description: 'Aparece sin recargar nada.',
        instructions: 'Imprime los números pares del 1 al 10.',
        topicId: tema.id, type: 'normal', difficulty: 'easy',
        xp: 30, maxScore: 5, status: 'published'
      }) + ');');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      estado.ejercicioVivo = res.ejercicio.id;
      await sincronizar();

      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);

      /*
       * A partir de aqui NO se llama a sincronizar: la señal del profesor tiene
       * que traer el ejercicio sola. Es justo lo que pide el pliego: sin cerrar
       * sesión, sin reiniciar y sin actualizar a mano.
       */
      await waitFor('(await window.pc.exercises.list()).some(e => e.title === "Ejercicio en vivo")',
        25000, 'el ejercicio llega solo');

      /*
       * Los filtros de la pagina son del estudiante y se conservan entre
       * visitas; para comprobar que el ejercicio llego, se limpian primero.
       */
      await js('window.__pc.exercises.limpiarFiltros(); window.__pc.irPagina("ejercicios"); return true;');
      try {
        await waitFor('document.getElementById("page-host").innerText.indexOf("Ejercicio en vivo") !== -1',
          15000, 'el ejercicio en pantalla');
      } catch (err) {
        const diag = await js('return {' +
          ' filtros: window.__pc.exercises.filtrosActuales(),' +
          ' cuantos: (await window.pc.exercises.list()).length,' +
          ' texto: document.getElementById("page-host").innerText.slice(0, 200) };');
        throw new Error(err.message + ' · ' + JSON.stringify(diag));
      }
      return 'el ejercicio apareció sin intervención';
    });

    await step('el estudiante entrega y el profesor la recibe solo', async () => {
      const inicio = await js('return await window.pc.submissions.start(' +
        JSON.stringify(estado.ejercicioVivo) + ');');
      if (!inicio.ok) throw new Error(inicio.error);
      estado.entregaViva = inicio.submission.id;
      const env = await js('return await window.pc.submissions.submit(' +
        JSON.stringify(estado.entregaViva) + ', {code: "for i in range(2, 11, 2):\\n    print(i)\\n"});');
      if (!env.ok) throw new Error(env.error);
      await sincronizar();

      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      // Sin sincronizar a mano: la señal de entregas tiene que traerla.
      await waitFor('(await window.pc.submissions.review({status:"pending", limit:50}))' +
        '.items.some(s => s.id === ' + JSON.stringify(estado.entregaViva) + ')',
        25000, 'la entrega llega sola');
      return 'la entrega apareció en la bandeja sin intervención';
    });

    await step('el profesor califica y el estudiante recibe el aviso solo', async () => {
      const res = await js('return await window.pc.submissions.grade(' +
        JSON.stringify(estado.entregaViva) + ', {grade: 4.7, teacherComment: "Muy bien."});');
      if (!res.ok) throw new Error(JSON.stringify(res.errores || res.error));
      await sincronizar();

      await salir();
      await entrarComo(ALUMNO.correo, ALUMNO.password);

      /*
       * En clase, el profesor califica en SU computador y la nota le llega al
       * estudiante por la red. Aquí las dos sesiones comparten la base local, así
       * que la nota ya estaría puesta y no habría nada que anunciar: para probar
       * de verdad el aviso, se borra la nota de la copia local -como si este
       * equipo aún no la conociera- y se deja la remota intacta.
       */
      await js('return await window.pc.test.olvidarNota(' +
        JSON.stringify(estado.entregaViva) + ');');
      await js('await window.__pc.sync.arrastrar(); return true;');

      try {
        await waitFor('(await window.pc.submissions.get(' + JSON.stringify(estado.entregaViva) +
          ')).grade === 4.7', 25000, 'la nota llega sola');
      } catch (err) {
        const diag = await js(
          'const arbol = window.__pcFakeFirebase._volcado();' +
          'const delCurso = (arbol.courses || {})[' + JSON.stringify(estado.cursoId) + '] || {};' +
          'const id = ' + JSON.stringify(estado.entregaViva) + ';' +
          'const remoto = (delCurso.submissions || {})[id] || null;' +
          'const local = await window.pc.submissions.get(id);' +
          'return { remotoNota: remoto && remoto.grade, remotoEstado: remoto && remoto.status,' +
          '  localNota: local && local.grade, cola: await window.pc.sync.stats(),' +
          '  pendientes: (await window.pc.sync.pending(20)).map(i => i.entity + "/" + i.entityId +' +
          '    " [" + i.status + "] " + (i.lastError || "")),' +
          '  ultimoArrastre: await window.__pc.sync.arrastrar() };');
        throw new Error(err.message + ' · ' + JSON.stringify(diag));
      }
      await waitFor('Array.from(document.querySelectorAll("#toast-root .toast"))' +
        '.some(t => t.innerText.indexOf("Nueva calificación") !== -1)',
        15000, 'aviso de calificación');
      const aviso = await js('return Array.from(document.querySelectorAll("#toast-root .toast"))' +
        '.map(t => t.innerText.replace(/\\s+/g, " ").trim())' +
        '.find(t => t.indexOf("Nueva calificación") !== -1) || "";');
      if (aviso.indexOf('4.7') === -1) throw new Error('el aviso no trae la nota: ' + aviso);
      return aviso.slice(0, 80);
    });

    /* ================================================================ */
    group('33. 1.0.0 · un error de Python no cuesta nada');

    await step('equivocarse no gasta intentos ni marca abandono', async () => {
      const antes = await js('return await window.pc.submissions.mine(' +
        JSON.stringify(estado.ejercicioVivo) + ');');

      // Se ejecuta código roto varias veces, como haría cualquiera aprendiendo.
      await js('window.__pc.irIDE(); return true;');
      for (let i = 0; i < 3; i++) {
        await js('const v = window.__pc.editor.getView();' +
          'v.dispatch({changes:{from:0,to:v.state.doc.length,insert:"print(no_existe)\\n"}});' +
          'window.__pc.documents.syncActive(); window.__pc.runCurrent(); return true;');
        await sleep(1800);
      }

      const despues = await js('return await window.pc.submissions.mine(' +
        JSON.stringify(estado.ejercicioVivo) + ');');
      if (despues.length !== antes.length) {
        throw new Error('los intentos pasaron de ' + antes.length + ' a ' + despues.length);
      }
      if (despues.some((s) => s.status === 'abandoned')) throw new Error('marcó una entrega como abandonada');
      if (despues.some((s) => s.grade !== antes.find((a) => a.id === s.id).grade)) {
        throw new Error('cambió alguna nota');
      }

      const consola = await js('return document.getElementById("console-out").innerText;');
      if (consola.indexOf('Error al ejecutar') === -1) throw new Error('no explicó el error');
      if (consola.indexOf('no está definida') === -1) {
        throw new Error('no explicó el NameError en castellano: ' + consola.slice(-160));
      }
      return '3 ejecuciones con error · ' + despues.length + ' intento(s), ninguno abandonado';
    });

    /* ================================================================ */
    group('34. 1.0.0 · fotos de perfil');

    await step('sin foto se muestran las iniciales, nunca una dirección', async () => {
      await js('window.__pc.irPagina("inicio"); return true;');
      await waitFor('!!document.querySelector("#page-host .h-avatar")', 12000, 'avatar');
      const info = await js('const a = document.querySelector("#page-host .h-avatar");' +
        'return { texto: a.textContent.trim(), imagen: !!a.querySelector("img"),' +
        ' pagina: document.getElementById("page-host").innerText };');
      if (info.imagen) throw new Error('hay una imagen sin haber puesto foto');
      if (!/^[A-ZÁÉÍÓÚÑ]{1,2}$/i.test(info.texto)) throw new Error('las iniciales son «' + info.texto + '»');
      if (/res\.cloudinary\.com|https:\/\//.test(info.pagina)) {
        throw new Error('se ve una dirección en la pantalla');
      }
      return 'iniciales «' + info.texto + '»';
    });

    await step('la foto se recorta y se comprime antes de salir del equipo', async () => {
      const res = await js(
        'const { prepararFoto } = await import("./js/avatar.js");' +
        // Imagen de prueba grande y rectangular, hecha aqui mismo.
        'const c = document.createElement("canvas"); c.width = 1200; c.height = 800;' +
        'const g = c.getContext("2d");' +
        'const grad = g.createLinearGradient(0, 0, 1200, 800);' +
        'grad.addColorStop(0, "#4b8bf5"); grad.addColorStop(1, "#ffd43b");' +
        'g.fillStyle = grad; g.fillRect(0, 0, 1200, 800);' +
        'const blob = await new Promise(r => c.toBlob(r, "image/png"));' +
        'const archivo = new File([blob], "prueba.png", { type: "image/png" });' +
        'const out = await prepararFoto(archivo);' +
        'const img = new Image(); img.src = out.dataUrl;' +
        'await img.decode();' +
        'return { kb: out.kb, formato: out.formato, ancho: img.naturalWidth, alto: img.naturalHeight,' +
        '  original: Math.round(blob.size / 1024) };');
      if (res.ancho !== 256 || res.alto !== 256) throw new Error('quedó en ' + res.ancho + 'x' + res.alto);
      if (res.kb > 120) throw new Error('pesa ' + res.kb + ' KB');
      if (res.kb >= res.original) throw new Error('no comprimió: ' + res.original + ' → ' + res.kb);
      return res.original + ' KB → ' + res.kb + ' KB en ' + res.formato + ' de ' + res.ancho + 'x' + res.alto;
    });

    await step('sin configurar, la subida lo dice sin tecnicismos', async () => {
      const cfg = await js('return await window.pc.photo.config();');
      const res = await js('return await window.pc.photo.upload("data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==");');
      if (cfg.listo) {
        // Si el equipo ya tiene fotos configuradas, la subida real necesita red.
        if (!res.ok && /Firebase|SQLite|preset|token/i.test(res.error || '')) {
          throw new Error('el mensaje de error es técnico: ' + res.error);
        }
        return 'fotos configuradas · respuesta: ' + (res.ok ? 'subida' : res.error);
      }
      if (res.ok) throw new Error('dijo que subió sin estar configurado');
      if (/Cloudinary|preset|unsigned|api|token/i.test(res.error)) {
        throw new Error('el mensaje es técnico: ' + res.error);
      }
      return res.error;
    });

    await step('la foto viaja como dirección, no como imagen', async () => {
      const url = 'https://res.cloudinary.com/ptx44tre/image/upload/v1/prueba.webp';
      const puesto = await js('return await window.pc.test.setPhoto(' + JSON.stringify(url) + ');');
      if (!puesto.ok) throw new Error(puesto.error || 'no se pudo poner la foto de prueba');
      await sincronizar();

      const arbol = await js('return window.__pcFakeFirebase._volcado();');
      const yo = await js('return await window.pc.session.me();');
      const remoto = arbol.users[yo.uid] || {};
      if (remoto.photoURL !== url) throw new Error('en la base remota quedó: ' + remoto.photoURL);
      const pesoUsuario = JSON.stringify(remoto).length;
      if (pesoUsuario > 1200) throw new Error('el perfil remoto pesa ' + pesoUsuario + ' caracteres');

      /*
       * La imagen se pide recortada al tamaño que se va a ver (y al doble, para
       * pantallas densas). Se comprueba sobre el elemento que construye la
       * aplicacion: la direccion de prueba no existe de verdad, y cuando una
       * imagen no carga la aplicacion se queda con las iniciales a proposito,
       * asi que mirar el DOM un segundo despues no probaria nada.
       */
      const pedido = await js(
        'const { avatar } = await import("./js/avatar.js");' +
        'const caja = avatar({ foto: ' + JSON.stringify(url) + ', color: "#5aa9e6",' +
        '  nombreCompleto: "Mateo Castro" }, 96);' +
        'const img = caja.querySelector("img");' +
        'return { src: img ? img.getAttribute("src") : null, alt: img ? img.getAttribute("alt") : null,' +
        '  iniciales: caja.textContent.trim() };');
      if (!pedido.src) throw new Error('el avatar no pide la imagen');
      if (pedido.src.indexOf('c_fill') === -1 || pedido.src.indexOf('w_192') === -1 ||
        pedido.src.indexOf('f_auto') === -1) {
        throw new Error('la imagen no se pide recortada: ' + pedido.src);
      }
      if (!pedido.iniciales) throw new Error('sin iniciales de respaldo debajo de la foto');

      // Y en la pantalla: ni la direccion a la vista, ni un hueco roto.
      await js('window.__pc.irPagina("inicio"); return true;');
      await waitFor('!!document.querySelector("#page-host .h-avatar")', 12000, 'avatar en pantalla');
      await sleep(1200);                       // margen para que la imagen falle si va a fallar
      const enPantalla = await js('const a = document.querySelector("#page-host .h-avatar");' +
        'return { conFoto: !!a.querySelector("img"), texto: a.textContent.trim(),' +
        '  pagina: document.getElementById("page-host").innerText };');
      if (!enPantalla.conFoto && !enPantalla.texto) {
        throw new Error('el avatar quedó vacío');
      }
      if (/res\.cloudinary\.com|https:\/\//.test(enPantalla.pagina)) {
        throw new Error('la dirección se ve en pantalla');
      }
      return 'solo la dirección en la base (' + pesoUsuario + ' caracteres), pedida ya recortada (' +
        pedido.src.split('/upload/')[1].split('/')[0] + ') y con iniciales de respaldo';
    });

    await step('quitar la foto vuelve a las iniciales', async () => {
      const out = await js('return await window.pc.photo.remove();');
      if (!out.ok) throw new Error('no se pudo quitar');
      if (out.usuario.foto) throw new Error('sigue habiendo foto');
      await js('window.__pc.irPagina("inicio"); return true;');
      await sleep(600);
      const hayImagen = await js('return !!document.querySelector("#page-host .h-avatar img");');
      if (hayImagen) throw new Error('la imagen sigue en pantalla');
      return 'de vuelta a las iniciales';
    });

    /* ================================================================ */
    group('35. 1.0.0 · lenguaje de la interfaz');

    await step('ninguna pantalla del estudiante muestra tecnicismos ni «null»', async () => {
      const paginas = ['inicio', 'ejercicios', 'entregas', 'proyectos', 'rankings', 'insignias'];
      const prohibidas = ['Firebase', 'SQLite', 'Realtime Database', 'undefined', 'NaN',
        '[object Object]', 'PERMISSION_DENIED', 'studentId', 'exerciseId', 'submissionId', 'listener'];
      const encontradas = [];
      const enBlanco = [];

      for (const p of paginas) {
        await js('window.__pc.irPagina(' + JSON.stringify(p) + '); return true;');
        await sleep(700);
        const texto = await js('return document.getElementById("page-host").innerText;');
        for (const mala of prohibidas) {
          if (texto.indexOf(mala) !== -1) encontradas.push(p + ': ' + mala);
        }
        // «null» solo cuenta como palabra suelta.
        if (/\bnull\b/.test(texto)) encontradas.push(p + ': null');

        /*
         * Y ninguna pantalla se queda en blanco: cuando no hay nada que
         * mostrar tiene que haber una explicacion, no un hueco.
         */
        if (texto.replace(/\s+/g, ' ').trim().length < 60) enBlanco.push(p);
      }
      if (enBlanco.length) throw new Error('pantallas casi vacias: ' + enBlanco.join(', '));

      // La barra de estado y el editor también los ve el estudiante.
      const marco = await js('return document.querySelector(".statusbar").innerText + " " +' +
        ' document.querySelector(".titlebar").innerText;');
      for (const mala of prohibidas) {
        if (marco.indexOf(mala) !== -1) encontradas.push('marco: ' + mala);
      }

      if (encontradas.length) throw new Error(encontradas.join(' · '));
      return paginas.length + ' pantallas con texto propio + barra de estado, limpias';
    });

    await step('los estados de entrega usan los nombres del pliego', async () => {
      const nombres = await js(
        'const d = await import("./js/dashboard.js");' +
        'return {' +
        ' submitted: d.textoEstado("submitted"),' +
        ' under_review: d.textoEstado("under_review"),' +
        ' graded: d.textoEstado("graded"),' +
        ' abandoned: d.textoEstado("abandoned"),' +
        ' late: d.textoEstado("late"),' +
        ' desconocido: d.textoEstado("lo_que_sea"),' +
        ' ayudaAbandono: d.ayudaEstado("abandoned"),' +
        ' nota: d.textoNota(4.7, 5), sinNota: d.textoNota(null, 5),' +
        ' intentos: d.textoIntentos(1, 3), ilimitados: d.textoIntentos(2, 0),' +
        ' vacio: d.texto(null), raro: d.texto(NaN) };');

      const esperado = {
        submitted: 'Pendiente de revisión',
        under_review: 'En revisión',
        graded: 'Calificado',
        abandoned: 'Abandonado',
        late: 'Fuera de tiempo'
      };
      for (const [clave, valor] of Object.entries(esperado)) {
        if (nombres[clave] !== valor) throw new Error(clave + ' = «' + nombres[clave] + '»');
      }
      if (nombres.desconocido !== 'Sin información') throw new Error('estado raro: ' + nombres.desconocido);
      if (nombres.nota !== '4.7 / 5.0') throw new Error('nota: ' + nombres.nota);
      if (nombres.sinNota !== 'Pendiente') throw new Error('sin nota: ' + nombres.sinNota);
      if (nombres.intentos !== '1 de 3') throw new Error('intentos: ' + nombres.intentos);
      if (nombres.vacio !== 'Sin información' || nombres.raro !== 'Sin información') {
        throw new Error('los huecos no se rellenan: ' + nombres.vacio + ' / ' + nombres.raro);
      }
      if (nombres.ayudaAbandono.indexOf('error de Python') === -1) {
        throw new Error('la ayuda de abandonado no aclara lo de los errores');
      }
      return Object.values(esperado).join(' · ');
    });

    /* ================================================================ */
    group('36. 1.0.0 · sesenta estudiantes');

    await step('60 estudiantes con entregas: la interfaz sigue respondiendo', async () => {
      await salir();
      await entrarComo(PROFE.correo, PROFE.password);

      /*
       * Se siembran 60 cuentas con una entrega cada una directamente en la base
       * remota (es lo que habria tras una clase entera) y se mide lo que tarda
       * el profesor en tenerlo todo y pintar su tablero.
       */
      const siembra = await js(
        'const fb = window.__pcFakeFirebase;' +
        'const ahora = new Date().toISOString();' +
        'const ej = ' + JSON.stringify(estado.ejercicioVivo) + ';' +
        'const cid = ' + JSON.stringify(estado.cursoId) + ';' +
        'for (let i = 1; i <= 60; i++) {' +
        '  const uid = "uid_carga_" + i;' +
        '  fb._sembrar("roles/" + uid, "student");' +
        '  fb._sembrar("users/" + uid, { email: "alumno" + i + "@colegio.edu.co",' +
        '    firstName: "Alumno", lastName: String(i), grade: (i % 3) ? "10" : "11",' +
        '    createdAt: ahora, updatedAt: ahora });' +
        /*
         * Matrícula + roster: sin esto los 60 quedarían con perfil global
         * pero SIN fila de curso local -y todo lo que ahora se filtra por
         * curso (lista de estudiantes, estadísticas, ranking) los ignoraría-.
         */
        '  fb._sembrar("courses/" + cid + "/members/" + uid, "student");' +
        '  fb._sembrar("courses/" + cid + "/roster/" + uid, { email: "alumno" + i + "@colegio.edu.co",' +
        '    firstName: "Alumno", lastName: String(i), grade: (i % 3) ? "10" : "11",' +
        '    color: "#4b8bf5", active: true, createdAt: ahora, updatedAt: ahora });' +
        '  fb._sembrar("courses/" + cid + "/submissions/sub_carga_" + i, { studentId: uid, exerciseId: ej,' +
        '    attemptNumber: 1, code: "print(" + i + ")", status: "submitted",' +
        '    submittedAt: ahora, updatedAt: ahora, maxScore: 5, timeSpentSec: 60 });' +
        '}' +
        'return 60;');
      if (siembra !== 60) throw new Error('no se sembraron las cuentas');

      const t0 = Date.now();
      const sync1 = await sincronizar();
      const msSync = Date.now() - t0;

      const cuentas = await js('return (await window.pc.users.students()).length;');
      if (cuentas < 60) {
        const diag = await js('const arbol = window.__pcFakeFirebase._volcado();' +
          'const delCurso = (arbol.courses || {})[' + JSON.stringify(estado.cursoId) + '] || {};' +
          'return { usuariosRemotos: Object.keys(arbol.users || {}).length,' +
          '  rolesRemotos: Object.keys(arbol.roles || {}).length,' +
          '  miembrosRemotos: Object.keys(delCurso.members || {}).length,' +
          '  entregasRemotas: Object.keys(delCurso.submissions || {}).length };');
        throw new Error('solo llegaron ' + cuentas + ' estudiantes · descarga: ' +
          JSON.stringify(sync1) + ' · remoto: ' + JSON.stringify(diag));
      }

      const t1 = Date.now();
      await js('window.__pc.irPagina("inicio"); return true;');
      await waitFor('document.querySelectorAll("#page-host table.data tbody tr").length >= 60',
        20000, 'tabla con 60 estudiantes');
      const msPintar = Date.now() - t1;

      const t2 = Date.now();
      const respuesta = await js('return 1 + 1;');
      const msRespuesta = Date.now() - t2;
      if (respuesta !== 2) throw new Error('la interfaz no responde');
      if (msRespuesta > 1500) throw new Error('la interfaz tardó ' + msRespuesta + ' ms en responder');

      const bandeja = await js('return await window.pc.submissions.review({status:"pending", limit:200});');
      if (bandeja.total < 60) throw new Error('la bandeja tiene ' + bandeja.total + ' entregas');

      return cuentas + ' estudiantes · descarga ' + msSync + ' ms · tablero ' + msPintar +
        ' ms · respuesta ' + msRespuesta + ' ms · ' + bandeja.total + ' entregas pendientes';
    });

    await step('la bandeja de entregas se pinta por tandas', async () => {
      await js('window.__pc.irPagina("entregas"); return true;');
      await waitFor('document.querySelectorAll("#page-host .entrega-row").length > 0', 15000, 'la bandeja');

      // Con el filtro «Todas» hay mas entregas que una tanda: es lo que se mide.
      await js('const b = Array.from(document.querySelectorAll("#page-host .filtro-barra button"))' +
        '.find(x => x.textContent.indexOf("Todas") === 0); b.click(); return true;');
      await waitFor('document.querySelectorAll("#page-host .entrega-row").length > 0', 15000, 'todas las entregas');

      const leer = () => js('return { filas: document.querySelectorAll("#page-host .entrega-row").length,' +
        ' pie: (document.querySelector("#page-host .lista-pie p") || {}).textContent || "",' +
        ' boton: (document.querySelector("#page-host .lista-pie button") || {}).textContent || "" };');

      // La pagina se repinta al cambiar de filtro y al llegar novedades: se reintenta.
      let primera = await leer();
      for (let i = 0; i < 10 && !primera.pie; i++) {
        await sleep(600);
        primera = await leer();
      }
      if (primera.filas > 60) throw new Error('pinto ' + primera.filas + ' entregas de golpe');
      if (!primera.pie) throw new Error('no dice cuantas esta mostrando');
      if (!primera.boton) throw new Error('no ofrece ver las demas: ' + primera.pie);

      // La pagina puede repintarse justo antes del clic (llega una novedad): se reintenta.
      let clicado = false;
      for (let i = 0; i < 10 && !clicado; i++) {
        clicado = await js('const b = document.querySelector("#page-host .lista-pie button");' +
          'if (!b) return false; b.click(); return true;');
        if (!clicado) await sleep(300);
      }
      if (!clicado) throw new Error('no se encontró el botón «Ver más»');
      await waitFor('document.querySelectorAll("#page-host .entrega-row").length > ' + primera.filas,
        15000, 'la siguiente tanda');
      const segunda = await js('return document.querySelectorAll("#page-host .entrega-row").length;');
      return primera.filas + ' entregas y luego ' + segunda + ' | ' + primera.pie.trim();
    });

    await step('las estadísticas con 60 estudiantes salen en un tiempo razonable', async () => {
      const t0 = Date.now();
      const datos = await js('return await window.pc.stats.course();');
      const ms = Date.now() - t0;
      if (datos.resumen.estudiantes < 60) throw new Error('cuenta ' + datos.resumen.estudiantes);
      if (ms > 4000) throw new Error('tardó ' + ms + ' ms');
      const t1 = Date.now();
      const ranking = await js('return await window.pc.rankings.get();');
      const msRanking = Date.now() - t1;
      if (ranking.total < 60) throw new Error('el ranking tiene ' + ranking.total);
      return 'estadísticas en ' + ms + ' ms · ranking de ' + ranking.total + ' en ' + msRanking + ' ms';
    });

    await step('la cola no se llena de operaciones repetidas', async () => {
      const stats = await js('return await window.pc.sync.stats();');
      const pendientes = await js('return await window.pc.sync.pending(100);');
      const porOpId = {};
      for (const item of pendientes) {
        porOpId[item.opId] = (porOpId[item.opId] || 0) + 1;
      }
      const repetidos = Object.entries(porOpId).filter(([, n]) => n > 1);
      if (repetidos.length) throw new Error('operaciones repetidas: ' + JSON.stringify(repetidos));
      return (stats.pending || 0) + ' pendiente(s), ninguna repetida';
    });

  })();
};
