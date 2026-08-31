'use strict';
/*
 * Catalogo educativo de librerias. Sirve para buscar sin conexion: PyPI no
 * ofrece un endpoint publico de busqueda, asi que la app filtra este catalogo
 * y ademas consulta PyPI por nombre exacto cuando hay Internet.
 */

module.exports = [
  { name: 'numpy', summary: 'Calculo numerico y arreglos multidimensionales.', tags: ['matematicas', 'datos'] },
  { name: 'pandas', summary: 'Analisis y manipulacion de datos en tablas.', tags: ['datos'] },
  { name: 'matplotlib', summary: 'Graficas y visualizacion de datos.', tags: ['graficas', 'datos'] },
  { name: 'requests', summary: 'Peticiones HTTP sencillas para consumir APIs.', tags: ['web', 'red'] },
  { name: 'rich', summary: 'Texto con colores, tablas y barras de progreso en la consola.', tags: ['consola'] },
  { name: 'colorama', summary: 'Colores en la terminal compatibles con Windows.', tags: ['consola'] },
  { name: 'pillow', summary: 'Procesamiento y edicion de imagenes.', tags: ['imagen'] },
  { name: 'pygame', summary: 'Creacion de videojuegos 2D y multimedia.', tags: ['juegos'] },
  { name: 'flask', summary: 'Microframework para crear aplicaciones web.', tags: ['web'] },
  { name: 'beautifulsoup4', summary: 'Extraccion de datos de paginas HTML.', tags: ['web'] },
  { name: 'openpyxl', summary: 'Leer y escribir archivos de Excel (.xlsx).', tags: ['datos', 'oficina'] },
  { name: 'sympy', summary: 'Matematica simbolica: algebra, calculo, ecuaciones.', tags: ['matematicas'] },
  { name: 'scipy', summary: 'Algoritmos cientificos: estadistica, optimizacion, senales.', tags: ['matematicas', 'ciencia'] },
  { name: 'scikit-learn', summary: 'Aprendizaje automatico clasico.', tags: ['ia', 'datos'] },
  { name: 'seaborn', summary: 'Graficas estadisticas elegantes sobre matplotlib.', tags: ['graficas', 'datos'] },
  { name: 'plotly', summary: 'Graficas interactivas para la web.', tags: ['graficas'] },
  { name: 'tabulate', summary: 'Imprime tablas bonitas en texto plano.', tags: ['consola'] },
  { name: 'pytest', summary: 'Framework de pruebas automatizadas.', tags: ['pruebas'] },
  { name: 'faker', summary: 'Genera datos falsos para practicar.', tags: ['datos', 'pruebas'] },
  { name: 'emoji', summary: 'Trabajar con emojis en cadenas de texto.', tags: ['texto'] },
  { name: 'qrcode', summary: 'Genera codigos QR.', tags: ['utilidades'] },
  { name: 'pyfiglet', summary: 'Texto ASCII art grande para la consola.', tags: ['consola'] },
  { name: 'turtle-graphics', summary: 'Dibujo con tortuga (alternativa al modulo turtle).', tags: ['educacion'] },
  { name: 'sqlalchemy', summary: 'Acceso a bases de datos SQL desde Python.', tags: ['datos'] },
  { name: 'python-dateutil', summary: 'Manejo avanzado de fechas y horas.', tags: ['utilidades'] },
  { name: 'pytz', summary: 'Zonas horarias.', tags: ['utilidades'] },
  { name: 'tqdm', summary: 'Barras de progreso para bucles.', tags: ['consola'] },
  { name: 'httpx', summary: 'Cliente HTTP moderno con soporte asincrono.', tags: ['web', 'red'] },
  { name: 'pyyaml', summary: 'Leer y escribir archivos YAML.', tags: ['datos'] },
  { name: 'jsonschema', summary: 'Validacion de estructuras JSON.', tags: ['datos'] },
  { name: 'cryptography', summary: 'Cifrado y funciones criptograficas.', tags: ['seguridad'] },
  { name: 'pyperclip', summary: 'Copiar y pegar desde el portapapeles.', tags: ['utilidades'] },
  { name: 'psutil', summary: 'Informacion del sistema y de los procesos.', tags: ['sistema'] },
  { name: 'keyboard', summary: 'Detectar y simular pulsaciones de teclado.', tags: ['sistema'] },
  { name: 'pyautogui', summary: 'Automatizacion de raton y teclado.', tags: ['automatizacion'] },
  { name: 'networkx', summary: 'Grafos y algoritmos sobre redes.', tags: ['matematicas'] },
  { name: 'statistics-extra', summary: 'Utilidades estadisticas adicionales.', tags: ['matematicas'] },
  { name: 'black', summary: 'Formateador automatico de codigo Python.', tags: ['herramientas'] },
  { name: 'flake8', summary: 'Analisis de estilo y errores comunes.', tags: ['herramientas'] },
  { name: 'ipython', summary: 'Interprete interactivo mejorado.', tags: ['herramientas'] }
];
