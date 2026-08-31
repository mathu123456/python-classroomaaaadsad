/*
 * Graficas en SVG escrito a mano (fase 5).
 *
 * El pliego prohibe expresamente traer una libreria enorme para dibujar cuatro
 * barras, asi que aqui hay lo justo: barras verticales, barras horizontales y
 * una linea. Los colores salen de las variables CSS que ya usa la aplicacion,
 * de modo que el tema claro y el oscuro funcionan sin tocar nada.
 *
 * Al pasar el raton se ve el dato exacto (elemento <title> del SVG, el tooltip
 * nativo). No hay animaciones ni zoom: no aportan nada y molestan al leer.
 */

const NS = 'http://www.w3.org/2000/svg';

function n(tag, attrs, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function titulo(texto) {
  return n('title', null, texto);
}

/** Caja con el mensaje honesto de que no hay datos suficientes. */
export function sinDatos(mensaje) {
  const caja = document.createElement('div');
  caja.className = 'chart-empty';
  caja.textContent = mensaje || 'Todavía no hay datos suficientes para dibujar esta gráfica.';
  return caja;
}

function marco(ancho, alto) {
  const svg = n('svg', {
    class: 'chart',
    viewBox: '0 0 ' + ancho + ' ' + alto,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img'
  });
  return svg;
}

/** Rejilla horizontal con sus etiquetas de valor. */
function rejilla(svg, x0, y0, ancho, alto, maximo, lineas, formato) {
  const pasos = lineas || 4;
  for (let i = 0; i <= pasos; i++) {
    const valor = (maximo / pasos) * i;
    const y = y0 + alto - (alto / pasos) * i;
    svg.append(n('line', {
      x1: x0, y1: y, x2: x0 + ancho, y2: y,
      stroke: 'var(--border)', 'stroke-width': i === 0 ? 1.2 : 0.8,
      'stroke-dasharray': i === 0 ? '' : '3 4'
    }));
    svg.append(n('text', {
      x: x0 - 6, y: y + 3.5, 'text-anchor': 'end', class: 'chart-tick'
    }, formato ? formato(valor) : String(Math.round(valor * 10) / 10)));
  }
}

/**
 * Barras verticales.
 * datos: [{ etiqueta, valor, detalle, color }]
 */
export function barras(datos, opciones) {
  const o = opciones || {};
  if (!datos || !datos.length) return sinDatos(o.vacio);

  const ancho = o.ancho || 640;
  const alto = o.alto || 240;
  const margen = { arriba: 14, derecha: 12, abajo: 46, izquierda: 42 };
  const util = { w: ancho - margen.izquierda - margen.derecha, h: alto - margen.arriba - margen.abajo };

  const maximo = o.maximo || Math.max(1, ...datos.map((d) => d.valor || 0));
  const svg = marco(ancho, alto);
  rejilla(svg, margen.izquierda, margen.arriba, util.w, util.h, maximo, 4, o.formatoEje);

  const paso = util.w / datos.length;
  const anchoBarra = Math.max(6, Math.min(48, paso * 0.62));

  datos.forEach((d, i) => {
    const valor = Math.max(0, Math.min(maximo, d.valor || 0));
    const h = maximo ? (valor / maximo) * util.h : 0;
    const x = margen.izquierda + paso * i + (paso - anchoBarra) / 2;
    const y = margen.arriba + util.h - h;

    const barra = n('rect', {
      x: x, y: y, width: anchoBarra, height: Math.max(h, valor > 0 ? 2 : 0),
      rx: 3, fill: d.color || 'var(--accent)', class: 'chart-bar'
    }, titulo(d.detalle || (d.etiqueta + ': ' + (d.valor == null ? '—' : d.valor))));
    svg.append(barra);

    if (o.mostrarValor !== false && valor > 0) {
      svg.append(n('text', {
        x: x + anchoBarra / 2, y: y - 4, 'text-anchor': 'middle', class: 'chart-value'
      }, d.valorTexto != null ? d.valorTexto : String(d.valor)));
    }

    svg.append(n('text', {
      x: x + anchoBarra / 2, y: alto - margen.abajo + 14,
      'text-anchor': 'end', class: 'chart-label',
      transform: 'rotate(-32 ' + (x + anchoBarra / 2) + ' ' + (alto - margen.abajo + 14) + ')'
    }, d.etiqueta));
  });

  return svg;
}

/**
 * Barras horizontales (una por elemento, util para listas de estudiantes).
 * datos: [{ etiqueta, valor, detalle, color }] con valor en 0..maximo
 */
export function barrasHorizontales(datos, opciones) {
  const o = opciones || {};
  if (!datos || !datos.length) return sinDatos(o.vacio);

  const filaAlto = o.filaAlto || 22;
  const ancho = o.ancho || 640;
  const margen = { arriba: 10, derecha: 46, abajo: 18, izquierda: o.izquierda || 150 };
  const alto = margen.arriba + margen.abajo + filaAlto * datos.length;
  const util = ancho - margen.izquierda - margen.derecha;
  const maximo = o.maximo || Math.max(1, ...datos.map((d) => d.valor || 0));

  const svg = marco(ancho, alto);

  datos.forEach((d, i) => {
    const y = margen.arriba + filaAlto * i;
    const valor = Math.max(0, Math.min(maximo, d.valor || 0));
    const w = maximo ? (valor / maximo) * util : 0;

    svg.append(n('text', {
      x: margen.izquierda - 8, y: y + filaAlto / 2 + 3.5, 'text-anchor': 'end', class: 'chart-label'
    }, d.etiqueta));

    svg.append(n('rect', {
      x: margen.izquierda, y: y + 3, width: util, height: filaAlto - 8,
      rx: 3, fill: 'var(--surface-3)'
    }));

    svg.append(n('rect', {
      x: margen.izquierda, y: y + 3, width: Math.max(w, valor > 0 ? 2 : 0), height: filaAlto - 8,
      rx: 3, fill: d.color || 'var(--accent)', class: 'chart-bar'
    }, titulo(d.detalle || (d.etiqueta + ': ' + d.valor))));

    svg.append(n('text', {
      x: ancho - margen.derecha + 6, y: y + filaAlto / 2 + 3.5, class: 'chart-value'
    }, d.valorTexto != null ? d.valorTexto : String(d.valor)));
  });

  return svg;
}

/**
 * Linea con puntos.
 * datos: [{ etiqueta, valor, detalle }]
 */
export function lineas(datos, opciones) {
  const o = opciones || {};
  if (!datos || datos.length < 2) return sinDatos(o.vacio || 'Hacen falta al menos dos periodos con datos.');

  const ancho = o.ancho || 640;
  const alto = o.alto || 240;
  const margen = { arriba: 14, derecha: 14, abajo: 42, izquierda: 42 };
  const util = { w: ancho - margen.izquierda - margen.derecha, h: alto - margen.arriba - margen.abajo };
  const maximo = o.maximo || Math.max(1, ...datos.map((d) => d.valor || 0));

  const svg = marco(ancho, alto);
  rejilla(svg, margen.izquierda, margen.arriba, util.w, util.h, maximo, 4, o.formatoEje);

  const paso = datos.length > 1 ? util.w / (datos.length - 1) : util.w;
  const puntos = datos.map((d, i) => {
    const x = margen.izquierda + paso * i;
    const valor = Math.max(0, Math.min(maximo, d.valor || 0));
    const y = margen.arriba + util.h - (maximo ? (valor / maximo) * util.h : 0);
    return { x, y, d };
  });

  svg.append(n('polyline', {
    points: puntos.map((p) => p.x + ',' + p.y).join(' '),
    fill: 'none', stroke: o.color || 'var(--accent)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  }));

  for (const p of puntos) {
    svg.append(n('circle', {
      cx: p.x, cy: p.y, r: 3.4, fill: o.color || 'var(--accent)', class: 'chart-dot'
    }, titulo(p.d.detalle || (p.d.etiqueta + ': ' + p.d.valor))));
  }

  const cada = Math.ceil(datos.length / 8);
  puntos.forEach((p, i) => {
    if (i % cada !== 0 && i !== puntos.length - 1) return;
    svg.append(n('text', {
      x: p.x, y: alto - margen.abajo + 16, 'text-anchor': 'middle', class: 'chart-label'
    }, p.d.etiqueta));
  });

  return svg;
}

/** Envoltura con titulo y nota explicativa. */
export function tarjetaGrafica(titulo_, nodo, nota) {
  const card = document.createElement('div');
  card.className = 'card chart-card';
  const h = document.createElement('h3');
  h.textContent = titulo_;
  card.append(h);
  card.append(nodo);
  if (nota) {
    const p = document.createElement('p');
    p.className = 'chart-note';
    p.textContent = nota;
    card.append(p);
  }
  return card;
}
