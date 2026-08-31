'use strict';
/*
 * Pruebas de extremo a extremo de la FASE 6 (empaquetado y mantenimiento).
 *
 * Aqui solo se puede comprobar lo que ocurre DENTRO de la aplicacion:
 * preparacion del runtime escribible, copias de seguridad, restauracion y la
 * comprobacion de actualizaciones. Instalar el .exe, desinstalarlo y volver a
 * instalarlo es una prueba manual: su resultado esta en el README, no aqui.
 */

const fs = require('fs');
const path = require('path');

module.exports = function fase6(h) {
  const { js, step, group, sleep } = h;

  return (async () => {

    /* ================================================================ */
    group('26. Fase 6 · runtime escribible y arranque');

    await step('el sistema sabe si la carpeta de instalación se puede escribir', async () => {
      const estado = await js('return await window.pc.runtime.prepareState();');
      if (typeof estado.instalacionEscribible !== 'boolean') throw new Error('respuesta rara');
      if (!estado.carpetaUsuario) throw new Error('no indica la carpeta del usuario');
      if (estado.hayEmbebido && estado.instalacionEscribible && estado.necesitaCopia) {
        throw new Error('dice que hay que copiar aunque se puede escribir');
      }
      return 'plataforma ' + estado.plataforma + ' · escribible: ' + estado.instalacionEscribible +
        ' · necesita copia: ' + estado.necesitaCopia;
    });

    await step('preparar el runtime deja pip listo para trabajar', async () => {
      const res = await js('return await window.pc.runtime.prepare();');
      if (!res.ok) throw new Error(res.error || 'no quedó listo');
      if (!res.motivo) throw new Error('no explica qué hizo');
      const rt = await js('return await window.pc.python.runtime(true);');
      if (!rt.ok) throw new Error('el runtime no responde');
      const libs = await js('return await window.pc.packages.list();');
      if (libs && libs.error) throw new Error('pip: ' + libs.error);
      return res.motivo + ' · Python ' + rt.version + ' · ' +
        (Array.isArray(libs) ? libs.length : (libs.items || []).length) + ' librería(s)';
    });

    await step('la pantalla de preparación comprueba las siete piezas', async () => {
      const p = js('return await window.__pc.primerArranque.ejecutar({forzar: true});');
      await sleep(600);
      const filas = await js('return Array.from(document.querySelectorAll(".prep-row"))' +
        '.map(r => r.querySelector(".prep-text").textContent);');
      if (filas.length !== 7) throw new Error('pasos: ' + filas.length);
      // Espera a que termine y cierra con el boton ABRIR.
      for (let i = 0; i < 80; i++) {
        const listo = await js('const b = document.querySelector(".prep-foot .btn"); return !!b && !b.disabled;');
        if (listo) break;
        await sleep(400);
      }
      const resultado = await js('const b = document.querySelector(".prep-foot .btn");' +
        'const filas = Array.from(document.querySelectorAll(".prep-row"))' +
        '  .map(r => ({ paso: r.querySelector(".prep-text").textContent, estado: r.className }));' +
        'if (b) b.click(); return filas;');
      await p.catch(() => {});
      const fallidos = resultado.filter((r) => r.estado.indexOf('err') !== -1).map((r) => r.paso);
      const correctos = resultado.filter((r) => r.estado.indexOf('ok') !== -1).length;
      if (fallidos.length) throw new Error('pasos con error: ' + fallidos.join(', '));
      return correctos + ' de 7 pasos comprobados: ' + filas.join(', ');
    });

    await step('copiar el runtime a la carpeta del usuario funciona', async () => {
      // Este es el camino que se usa cuando la aplicacion esta instalada en
      // "C:\\Program Files": aqui se fuerza para poder probarlo de verdad.
      const res = await js('return await window.pc.runtime.prepare({forzar: true});');
      if (!res.ok) throw new Error(res.error || 'no quedó listo');
      if (!res.copiado) throw new Error('no copió nada: ' + res.motivo);
      if (!res.archivos) throw new Error('copió 0 archivos');

      const estado = await js('return await window.pc.runtime.prepareState();');
      if (!estado.hayCopiaUsuario) throw new Error('la copia no quedó registrada');

      const rt = await js('return await window.pc.python.runtime(true);');
      if (!rt.ok) throw new Error('el runtime copiado no responde');
      if (String(rt.executable).indexOf(estado.carpetaUsuario) !== 0) {
        throw new Error('sigue usando el original: ' + rt.executable);
      }

      // pip tiene que poder trabajar sobre la copia: es el motivo de copiarla.
      const libs = await js('return await window.pc.packages.list();');
      if (libs && libs.error) throw new Error('pip sobre la copia: ' + libs.error);
      const salida = await js('return await window.pc.python.check("print(1)", "copia");');
      if (salida && salida.error) throw new Error('el intérprete copiado falla: ' + salida.error);

      return res.archivos + ' archivos copiados · ' + rt.executable.replace(estado.carpetaUsuario, '<userData>') +
        ' · Python ' + rt.version + ' · pip responde';
    });

    await step('se informa del arranque en frío', async () => {
      const info = await js('return await window.pc.app.startup();');
      if (info.listoEnMs == null) throw new Error('no midió el arranque');
      if (info.listoEnMs <= 0 || info.listoEnMs > 120000) throw new Error('medida rara: ' + info.listoEnMs);
      return 'ventana lista en ' + info.listoEnMs + ' ms (' +
        (info.empaquetada ? 'empaquetada' : 'desarrollo') + ')';
    });

    /* ================================================================ */
    group('27. Fase 6 · copias de seguridad de la base de datos');

    await step('se puede hacer una copia manual', async () => {
      const res = await js('return await window.pc.backups.create();');
      if (!res.ok) throw new Error(res.error);
      if (!fs.existsSync(res.path)) throw new Error('el archivo no existe');
      const cabecera = fs.readFileSync(res.path).slice(0, 15).toString('utf8');
      if (cabecera.indexOf('SQLite format 3') !== 0) throw new Error('no es una base SQLite');
      return path.basename(res.path) + ' · ' + Math.round(res.sizeBytes / 1024) + ' KB';
    });

    await step('solo se conservan las cinco copias más recientes', async () => {
      for (let i = 0; i < 6; i++) {
        await js('return await window.pc.backups.create();');
        await sleep(1100);   // el nombre lleva la marca de tiempo
      }
      const { copias, carpeta } = await js('return await window.pc.backups.list();');
      if (copias.length > 5) throw new Error('hay ' + copias.length + ' copias');
      const enDisco = fs.readdirSync(carpeta).filter((f) => f.endsWith('.db'));
      if (enDisco.length > 5) throw new Error('en disco hay ' + enDisco.length);
      return copias.length + ' copia(s) en ' + carpeta;
    });

    await step('restaurar una copia devuelve los datos y avisa antes', async () => {
      const antes = await js('return await window.pc.data.info();');
      const { copias } = await js('return await window.pc.backups.list();');
      const res = await js('return await window.pc.backups.restore(' + JSON.stringify(copias[0].path) + ');');
      if (!res.ok) throw new Error(res.error);
      const despues = await js('return await window.pc.data.info();');
      if (despues.db.tables.submissions !== antes.db.tables.submissions) {
        throw new Error('entregas: ' + antes.db.tables.submissions + ' -> ' + despues.db.tables.submissions);
      }
      const nuevas = await js('return await window.pc.backups.list();');
      if (!nuevas.copias.some((c) => c.name.indexOf('previa-restauracion') !== -1)) {
        throw new Error('no guardó la copia previa a la restauración');
      }
      return 'restaurada ' + res.restaurada + ' · ' + despues.db.tables.submissions +
        ' entregas intactas · copia previa guardada';
    });

    await step('una ruta que no es una copia se rechaza', async () => {
      const res = await js('return await window.pc.backups.restore("C:/no/existe/esto.db");');
      if (res.ok) throw new Error('aceptó una ruta cualquiera');
      return res.error;
    });

    await step('la base sigue en la versión de esquema esperada', async () => {
      const info = await js('return await window.pc.data.info();');
      if (info.db.schemaVersion < 3) throw new Error('esquema ' + info.db.schemaVersion);
      for (const tabla of ['badges', 'user_badges', 'rewards']) {
        if (info.db.tables[tabla] === undefined) throw new Error('falta la tabla ' + tabla);
      }
      return 'esquema ' + info.db.schemaVersion + ' · ' +
        Object.entries(info.db.tables).map(([k, v]) => k + ':' + v).join(' ');
    });

    /* ================================================================ */
    group('28. Fase 6 · actualizaciones');

    await step('la comprobación de actualizaciones responde sin romper nada', async () => {
      const res = await js('return await window.pc.updates.check();');
      if (!res.actual) throw new Error('no dice la versión instalada');
      if (!res.mensaje) throw new Error('no da un mensaje para el usuario');
      if (res.ok && typeof res.hayNueva !== 'boolean') throw new Error('respuesta incompleta');
      return res.ok
        ? 'versión ' + res.actual + ' · ' + res.mensaje
        : 'sin conexión con GitHub (' + String(res.error).slice(0, 60) + ') · ' + res.mensaje;
    });

    await step('la configuración de actualizaciones se guarda', async () => {
      const cfg = await js('return await window.pc.updates.setConfig({repo: "colegio/python-classroom",' +
        ' comprobarAlIniciar: true});');
      if (cfg.repo !== 'colegio/python-classroom') throw new Error('repo: ' + cfg.repo);
      if (!cfg.comprobarAlIniciar) throw new Error('no guardó la preferencia');
      if (cfg.automaticas) throw new Error('dice que las automáticas están activas y no lo están');
      const vuelta = await js('return await window.pc.updates.config();');
      if (vuelta.repo !== cfg.repo) throw new Error('no persistió');
      return 'repo ' + vuelta.repo + ' · al iniciar: sí · automáticas: no (documentado en el README)';
    });

    await step('el empaquetado excluye la caché de Python y node_modules', async () => {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
      const files = pkg.build.files.join(' ');
      if (files.indexOf('!node_modules/**/*') === -1) throw new Error('no excluye node_modules');
      if (files.indexOf('!**/__pycache__/**') === -1) throw new Error('no excluye __pycache__');
      const filtro = pkg.build.extraResources[0].filter.join(' ');
      if (filtro.indexOf('!cache/**') === -1) throw new Error('no excluye python/cache');
      if (pkg.build.nsis.deleteAppDataOnUninstall !== false) {
        throw new Error('el desinstalador borraría los datos del usuario');
      }
      if (!pkg.build.win.icon) throw new Error('sin icono propio');
      return 'exclusiones correctas · icono ' + pkg.build.win.icon +
        ' · el desinstalador conserva los datos';
    });

  })();
};
