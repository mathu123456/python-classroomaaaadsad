'use strict';
/*
 * Pruebas del diseño adaptable.
 *
 * Se cambia el tamaño de la ventana de verdad (no se simula con CSS) y se
 * comprueba lo que tiene que pasar en cada tramo: que la barra de actividad se
 * va abajo en teléfono, que las páginas no se salen a lo ancho, que las tablas
 * se desplazan solas y que los diálogos ocupan el ancho completo.
 *
 * El ancho que importa es el de la ventana, así que la comprobación clave es
 * siempre la misma: `scrollWidth <= innerWidth`. Si algo se sale, se sabe qué
 * elemento es, no solo que hay barra horizontal.
 */

const TAMANOS = {
  escritorio: [1280, 800],
  tableta: [820, 1100],
  telefono: [390, 844],      // iPhone 12/13/14
  estrecho: [360, 640]       // Android pequeño
};

module.exports = function responsive(h) {
  const { js, waitFor, step, group, sleep, resize, captura } = h;

  /** Cambia el tamaño de la ventana y espera a que el layout se recalcule. */
  async function medir(nombre) {
    const [w, alto] = TAMANOS[nombre];
    let cambio = null;
    let dentro = null;
    // Se reintenta: si el sistema tarda en aplicar el tamano, la primera medida
    // llega con el ancho anterior.
    for (let intento = 0; intento < 3; intento++) {
      cambio = resize(w, alto);
      await sleep(intento === 0 ? 450 : 700);
      dentro = await js('return { w: window.innerWidth, h: window.innerHeight,' +
        ' zoom: window.devicePixelRatio, css: !!Array.from(document.styleSheets)' +
        '  .find(h => String(h.href || "").indexOf("responsive.css") !== -1) };');
      if (Math.abs(dentro.w - w) <= 3) break;
    }
    if (!dentro.css) throw new Error('responsive.css no está cargada en la ventana');
    if (Math.abs(dentro.w - w) > 3) {
      throw new Error('la ventana no llegó a ' + w + 'px: quedó en ' + dentro.w +
        ' (electron dice ' + JSON.stringify(cambio && cambio.real) + ')');
    }
    return dentro;
  }

  /** Elementos que se salen del ancho de la ventana. */
  const DESBORDES =
    'const limite = document.documentElement.clientWidth + 2;' +
    'const malos = [];' +
    'const dentroDeScroll = (n) => {' +
    '  for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {' +
    '    const ox = getComputedStyle(p).overflowX;' +
    '    if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;' +
    '  }' +
    '  return false;' +
    '};' +
    'for (const n of document.querySelectorAll("body *")) {' +
    '  if (!n.getClientRects().length) continue;' +
    '  if (dentroDeScroll(n)) continue;' +   // lo que vive en una caja que se desplaza no cuenta
    '  const r = n.getBoundingClientRect();' +
    '  if (r.right > limite || r.width > limite + 1) {' +
    '    const cs = getComputedStyle(n);' +
    '    malos.push({' +
    '      que: (n.id ? "#" + n.id : "." + String(n.className || n.tagName).split(" ")[0]),' +
    '      ancho: Math.round(r.width), derecha: Math.round(r.right),' +
    '      overflowX: cs.overflowX, minWidth: cs.minWidth, padre: n.parentElement' +
    '        ? (n.parentElement.id ? "#" + n.parentElement.id : "." + String(n.parentElement.className || "").split(" ")[0])' +
    '        : "-" });' +
    '  }' +
    '}' +
    'return { limite: limite, scroll: document.documentElement.scrollWidth,' +
    ' body: document.body.scrollWidth, malos: malos.slice(0, 8) };';

  async function paginaSinDesbordes(pagina) {
    await js('window.__pc.irPagina(' + JSON.stringify(pagina) + '); return true;');
    await waitFor('!document.getElementById("page-host").hidden', 8000, 'página ' + pagina);
    await sleep(300);
    const res = await js(DESBORDES);
    if (res.malos.length) {
      throw new Error(pagina + ': se salen ' + JSON.stringify(res.malos) + ' (ancho ' + res.limite + ')');
    }
    if (res.scroll > res.limite) {
      throw new Error(pagina + ': la página se desplaza a lo ancho (' + res.scroll + ' > ' + res.limite +
        ', body ' + res.body + ')');
    }
    return pagina;
  }

  return (async () => {

    group('30. Diseño adaptable · tableta y teléfono');

    await step('en escritorio la barra de actividad está a la izquierda', async () => {
      const v = await medir('escritorio');
      const barra = await js('const a = document.getElementById("activitybar");' +
        'const r = a.getBoundingClientRect();' +
        'return { x: Math.round(r.left), ancho: Math.round(r.width), alto: Math.round(r.height) };');
      if (barra.x > 8) throw new Error('no está pegada a la izquierda: x=' + barra.x);
      if (barra.alto <= barra.ancho) throw new Error('no es vertical: ' + barra.ancho + 'x' + barra.alto);
      return v.w + 'x' + v.h + ' · barra vertical de ' + barra.ancho + 'px';
    });

    await step('en tableta la revisión pasa a una sola columna', async () => {
      const v = await medir('tableta');
      const columnas = await js(
        'const d = document.createElement("div");' +
        'd.className = "revision";' +
        'document.body.append(d);' +
        'const n = getComputedStyle(d).gridTemplateColumns.split(" ").filter(Boolean).length;' +
        'd.remove(); return n;');
      if (columnas !== 1) throw new Error('la revisión sigue en ' + columnas + ' columnas');
      const kpis = await js(
        'const d = document.createElement("div");' +
        'd.className = "dos-columnas";' +
        'document.body.append(d);' +
        'const n = getComputedStyle(d).gridTemplateColumns.split(" ").filter(Boolean).length;' +
        'd.remove(); return n;');
      if (kpis !== 1) throw new Error('las dos columnas siguen siendo ' + kpis);
      return v.w + 'x' + v.h + ' · revisión y comparativas en una columna';
    });

    await step('en teléfono la barra de actividad se va abajo', async () => {
      const v = await medir('telefono');
      const info = await js(
        'const a = document.getElementById("activitybar");' +
        'const ra = a.getBoundingClientRect();' +
        'const host = document.getElementById("page-host").hidden' +
        '  ? document.querySelector(".main") : document.getElementById("page-host");' +
        'const rh = host.getBoundingClientRect();' +
        'return { barra: { y: Math.round(ra.top), ancho: Math.round(ra.width), alto: Math.round(ra.height) },' +
        '  contenidoY: Math.round(rh.top), ventana: window.innerHeight };');
      if (info.barra.y < info.contenidoY) throw new Error('la barra sigue arriba/izquierda: y=' + info.barra.y);
      if (info.barra.ancho < v.w - 4) throw new Error('no ocupa el ancho: ' + info.barra.ancho);
      if (info.barra.alto > 80) throw new Error('demasiado alta para un teléfono: ' + info.barra.alto);
      return v.w + 'x' + v.h + ' · barra inferior de ' + info.barra.alto + 'px y ' + info.barra.ancho + 'px de ancho';
    });

    await step('ninguna página se sale a lo ancho en teléfono', async () => {
      const yo = await js('return await window.pc.session.me();');
      const paginas = ['inicio', 'ejercicios', 'entregas', 'proyectos', 'rankings']
        .concat(yo && yo.rol === 'profesor' ? ['curso', 'estadisticas'] : []);
      const hechas = [];
      for (const p of paginas) hechas.push(await paginaSinDesbordes(p));
      return hechas.join(', ');
    });

    await step('las tablas se desplazan dentro de su caja, no de la página', async () => {
      await js('window.__pc.irPagina("inicio"); return true;');
      await sleep(500);
      const info = await js(
        'const caja = document.querySelector("#page-host .table-wrap");' +
        'if (!caja) return { sinTabla: true };' +
        'const t = caja.querySelector("table");' +
        'return { sinTabla: false,' +
        ' desplazable: getComputedStyle(caja).overflowX,' +
        ' tabla: Math.round(t.getBoundingClientRect().width),' +
        ' caja: Math.round(caja.getBoundingClientRect().width),' +
        ' pagina: document.documentElement.scrollWidth,' +
        ' ventana: document.documentElement.clientWidth };');
      if (info.sinTabla) return 'sin tablas en esta pantalla';
      if (info.desplazable !== 'auto' && info.desplazable !== 'scroll') {
        throw new Error('la caja no se desplaza: overflow-x = ' + info.desplazable);
      }
      if (info.pagina > info.ventana + 2) {
        throw new Error('la página se desplaza a lo ancho (' + info.pagina + ' > ' + info.ventana + ')');
      }
      return 'tabla de ' + info.tabla + 'px dentro de una caja de ' + info.caja + 'px, página quieta';
    });

    await step('los diálogos ocupan el ancho completo en teléfono', async () => {
      const p = js('await window.pc.app.copy(""); ' +
        'const { modal } = await import("./js/ui.js");' +
        'window.__pcModal = modal({ title: "Prueba", body: "Contenido", ' +
        '  buttons: [{ label: "Cerrar", value: null, primary: true }] });' +
        'return true;');
      await p;
      await waitFor('!!document.querySelector(".modal-backdrop .modal")', 8000, 'diálogo');
      const info = await js(
        'const m = document.querySelector(".modal-backdrop .modal");' +
        'const r = m.getBoundingClientRect();' +
        'return { ancho: Math.round(r.width), ventana: window.innerWidth,' +
        ' alto: Math.round(r.height), abajo: Math.round(window.innerHeight - r.bottom) };');
      await js('const b = document.querySelector(".modal-backdrop .btn.primary"); if (b) b.click();' +
        'document.querySelectorAll(".modal-backdrop").forEach(n => n.remove()); return true;');
      if (info.ancho < info.ventana - 4) {
        throw new Error('el diálogo mide ' + info.ancho + ' de ' + info.ventana + ' disponibles');
      }
      if (info.abajo > 4) throw new Error('no queda pegado abajo: ' + info.abajo + 'px de hueco');
      return 'hoja inferior de ' + info.ancho + 'x' + info.alto;
    });

    await step('los campos usan 15px o más para que iOS no haga zoom', async () => {
      const tam = await js(
        'const i = document.createElement("input");' +
        'i.className = "input";' +
        'document.body.append(i);' +
        'const px = parseFloat(getComputedStyle(i).fontSize);' +
        'i.remove(); return px;');
      if (tam < 15) throw new Error('los campos miden ' + tam + 'px: Safari haría zoom al enfocarlos');
      return tam + 'px en los campos de formulario';
    });

    await step('en pantalla estrecha se recorta lo accesorio sin romper nada', async () => {
      const v = await medir('estrecho');
      await paginaSinDesbordes('inicio');
      const kpis = await js('const g = document.querySelector("#page-host .kpi-grid");' +
        'return g ? getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length : 0;');
      if (kpis > 2) throw new Error('siguen ' + kpis + ' columnas de indicadores');
      const botones = await js(
        'return Array.from(document.querySelectorAll("#page-host .btn"))' +
        '.map(b => Math.round(b.getBoundingClientRect().height))' +
        '.filter(alto => alto > 0 && alto < 34).length;');
      if (botones) throw new Error(botones + ' botón(es) por debajo de 34px de alto');
      return v.w + 'x' + v.h + ' · ' + kpis + ' columnas de indicadores y botones tocables';
    });

    await step('capturas de teléfono y tableta para revisarlas a ojo', async () => {
      if (!captura) return 'sin función de captura';
      await medir('telefono');
      await js('window.__pc.irPagina("inicio"); return true;');
      await sleep(600);
      const tel = await captura('telefono-inicio');
      await js('window.__pc.irPagina("rankings"); return true;');
      await sleep(600);
      const rank = await captura('telefono-rankings');
      await medir('tableta');
      await js('window.__pc.irPagina("estadisticas"); return true;');
      await sleep(900);
      const tab = await captura('tableta-estadisticas');
      const hechas = [tel, rank, tab].filter(Boolean);
      if (!hechas.length) throw new Error('no se pudo capturar la ventana');
      return hechas.map((r) => r.split(/[\/]/).pop()).join(', ');
    });

    await step('la ventana vuelve al tamaño de escritorio', async () => {
      const v = await medir('escritorio');
      await js('window.__pc.irPagina("inicio"); return true;');
      await sleep(300);
      const barra = await js('const r = document.getElementById("activitybar").getBoundingClientRect();' +
        'return { x: Math.round(r.left), ancho: Math.round(r.width) };');
      if (barra.x > 8) throw new Error('la barra no volvió a la izquierda');
      return v.w + 'x' + v.h;
    });

  })();
};

module.exports.TAMANOS = TAMANOS;
