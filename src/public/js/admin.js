/* =============================================================================
   Cafetería Origen — lógica del panel de administración
   ============================================================================= */
(function () {
  'use strict';

  var API = '/api';
  var usuario = null;
  var productosCache = {};
  var solicitudToken = null;

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function money(valor) {
    return Number(valor || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  function elemento(etiqueta, texto, clase) {
    var el = document.createElement(etiqueta);
    if (texto != null) el.textContent = String(texto);
    if (clase) el.className = clase;
    return el;
  }

  function crearTabla(tabla, encabezados) {
    tabla.replaceChildren();
    var cabeza = elemento('thead');
    var fila = elemento('tr');
    encabezados.forEach(function (titulo) {
      fila.appendChild(elemento('th', titulo.texto, titulo.clase));
    });
    cabeza.appendChild(fila);
    tabla.appendChild(cabeza);
    var cuerpo = elemento('tbody');
    tabla.appendChild(cuerpo);
    return cuerpo;
  }

  function agregarCeldas(fila, valores) {
    valores.forEach(function (valor) {
      fila.appendChild(elemento('td', valor.texto, valor.clase));
    });
  }

  function renderizarKpis(contenedor, kpis) {
    contenedor.replaceChildren();
    kpis.forEach(function (kpi) {
      var tarjeta = elemento('div', null, 'kpi');
      tarjeta.appendChild(elemento('div', kpi.label, 'kpi-label'));
      tarjeta.appendChild(elemento('div', kpi.value, 'kpi-value'));
      contenedor.appendChild(tarjeta);
    });
  }

  function api(url, opciones) {
    var metodo = opciones && opciones.method;
    var requiereCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(metodo) !== -1;
    var peticion;
    if (requiereCsrf) {
      if (!solicitudToken) {
        solicitudToken = fetch(API + '/csrf-token', { cache: 'no-store' }).then(function (res) {
          if (!res.ok) throw new Error('No se pudo obtener el token CSRF.');
          return res.json();
        }).finally(function () { solicitudToken = null; });
      }
      peticion = solicitudToken.then(function (datos) {
        var cabeceras = new Headers(opciones.headers || {});
        cabeceras.set('X-CSRF-Token', datos.token);
        return fetch(API + url, Object.assign({}, opciones, { headers: cabeceras }));
      });
    } else {
      peticion = fetch(API + url, opciones);
    }
    return peticion.then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function postJSON(url, cuerpo) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function putJSON(url, cuerpo) {
    return api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function patchJSON(url, cuerpo) {
    return api(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function feedback(el, mensaje, ok) {
    el.className = 'form-feedback ' + (ok ? 'is-ok' : 'is-error');
    el.textContent = mensaje;
  }

  /* ------------------------------------------------------------------ login */
  function iniciarSesion(evento) {
    evento.preventDefault();
    var caja = $('#login-feedback');
    caja.className = 'form-feedback';

    postJSON('/auth/login', {
      username: $('#login-usuario').value,
      password: $('#login-password').value,
    }).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No pudimos iniciar sesión: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      usuario = resp.data.usuario;
      mostrarPanel();
    });
  }

  function cerrarSesion() {
    postJSON('/auth/logout', {}).then(function (resp) {
      if (!resp.ok) {
        alert('No se pudo cerrar sesión: ' + (resp.data.error || 'error'));
        return;
      }
      usuario = null;
      $('#vista-login').hidden = false;
      $('#vista-panel').hidden = true;
      $('#admin-user').textContent = '';
    });
  }

  function mostrarPanel() {
    $('#vista-login').hidden = true;
    $('#vista-panel').hidden = false;
    var adminUser = $('#admin-user');
    adminUser.replaceChildren(
      document.createTextNode('Sesión de '),
      elemento('strong', usuario.nombre),
      document.createTextNode(' · rol: '),
      elemento('strong', usuario.rol)
    );
    $('#panel-bienvenida').textContent = 'Hola, ' + usuario.nombre;
    cargarTodo();
  }

  function cargarTodo() {
    cargarResumen();
    cargarPedidos();
    cargarProductos();
    cargarReportes();
    cargarUsuarios();
  }

  /* ---------------------------------------------------------------- resumen */
  function cargarResumen() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/mas-vendido').then(function (m) {
        api('/reportes/cantidad-vendida').then(function (c) {
          var mas = m.data.producto;
          var kpis = [
            { label: 'Facturación total', value: money(f.data.facturado) },
            { label: 'Pedidos registrados', value: f.data.pedidos },
            {
              label: 'Producto más vendido',
              value: mas ? mas.nombre : '—',
            },
            {
              label: 'Unidades por tipo',
              value: Object.keys(c.data.cantidadVendida || {})
                .map(function (k) { return k + ': ' + c.data.cantidadVendida[k]; })
                .join(' · ') || '—',
            },
          ];

          renderizarKpis($('#kpis'), kpis);
        });
      });
    });
  }

  /* --------------------------------------------------------------- pedidos */
  function tablaPedidos(tabla, filas, conAcciones) {
    if (!filas || filas.length === 0) {
      var cuerpoVacio = crearTabla(tabla, []);
      var filaVacia = elemento('tr');
      filaVacia.appendChild(elemento('td', 'No hay pedidos.', 'empty'));
      cuerpoVacio.appendChild(filaVacia);
      return;
    }

    var encabezados = [
      { texto: '#' }, { texto: 'Mesa' }, { texto: 'Cliente' }, { texto: 'Estado' },
      { texto: 'Total', clase: 'num' }, { texto: 'Fecha' },
    ];
    if (conAcciones) encabezados.push({ texto: 'Acciones' });
    var cuerpo = crearTabla(tabla, encabezados);
    filas.forEach(function (p) {
      var fila = elemento('tr');
      agregarCeldas(fila, [{ texto: p.id }, { texto: p.mesa }, { texto: p.cliente }]);
      var estado = elemento('td');
      estado.appendChild(elemento('span', p.estado, 'badge badge-' + p.estado));
      fila.appendChild(estado);
      agregarCeldas(fila, [
        { texto: money(p.total), clase: 'num' },
        { texto: new Date(p.creado_en).toLocaleString('es-AR') },
      ]);
      if (conAcciones) {
        var acciones = elemento('td');
        var select = elemento('select', null, 'sel-estado');
        select.setAttribute('data-pedido', p.id);
        ['abierto', 'preparando', 'listo', 'entregado'].forEach(function (e) {
          var opcion = elemento('option', e);
          opcion.value = e;
          opcion.selected = e === p.estado;
          select.appendChild(opcion);
        });
        acciones.appendChild(select);
        fila.appendChild(acciones);
      }
      cuerpo.appendChild(fila);
    });
  }

  function cargarPedidos() {
    api('/pedidos').then(function (resp) {
      var pedidos = resp.data.pedidos || [];
      tablaPedidos($('#tabla-pedidos'), pedidos, true);
      tablaPedidos($('#tabla-ultimos'), pedidos.slice(0, 5), false);
    });
  }

  function cambiarEstado(evento) {
    var select = evento.target.closest('.sel-estado');
    if (!select) return;
    var id = select.getAttribute('data-pedido');
    patchJSON('/pedidos/' + id + '/estado', { estado: select.value }).then(function (resp) {
      if (!resp.ok) {
        alert('No se pudo cambiar el estado: ' + (resp.data.error || 'error'));
      }
      cargarPedidos();
    });
  }

  /* ------------------------------------------------------------- productos */
  function cargarProductos() {
    api('/productos').then(function (resp) {
      var productos = resp.data.productos || [];
      productosCache = {};
      var cuerpo = crearTabla($('#tabla-productos'), [
        { texto: '#' }, { texto: 'Nombre' }, { texto: 'Tipo' }, { texto: 'Origen' },
        { texto: 'Precio', clase: 'num' }, { texto: 'Acciones' },
      ]);

      productos.forEach(function (p) {
        productosCache[p.id] = p;
        var fila = elemento('tr');
        agregarCeldas(fila, [
          { texto: p.id }, { texto: p.nombre }, { texto: p.tipo },
          { texto: p.variedad || '—' }, { texto: money(p.precio), clase: 'num' },
        ]);
        var acciones = elemento('td');
        var boton = elemento('button', 'Borrar', 'link-danger');
        boton.setAttribute('data-borrar', p.id);
        acciones.appendChild(boton);
        fila.appendChild(acciones);
        cuerpo.appendChild(fila);
      });
    });
  }

  function guardarProducto(evento) {
    evento.preventDefault();
    var caja = $('#producto-feedback');
    var id = $('#producto-id').value;

    var cuerpo = {
      nombre: $('#p-nombre').value,
      tipo: $('#p-tipo').value,
      variedad: $('#p-variedad').value || null,
      tamano: $('#p-tamano').value || null,
      gramos: $('#p-gramos').value ? Number($('#p-gramos').value) : null,
      precio_base: Number($('#p-precio-base').value || 0),
      precio_por_gramo: Number($('#p-precio-gramo').value || 0),
      descripcion: $('#p-descripcion').value,
    };

    var peticion = id ? putJSON('/admin/productos/' + id, cuerpo) : postJSON('/admin/productos', cuerpo);

    peticion.then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo guardar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Producto guardado correctamente.', true);
      $('#form-producto').reset();
      $('#producto-id').value = '';
      cargarProductos();
    });
  }

  function borrarProducto(evento) {
    var btn = evento.target.closest('[data-borrar]');
    if (!btn) return;
    var id = btn.getAttribute('data-borrar');
    if (!confirm('¿Borrar el producto #' + id + '?')) return;

    api('/admin/productos/' + id, { method: 'DELETE' }).then(function (resp) {
      if (!resp.ok) alert('No se pudo borrar: ' + (resp.data.error || 'error'));
      cargarProductos();
    });
  }

  function limpiarFormularioProducto() {
    $('#form-producto').reset();
    $('#producto-id').value = '';
  }

  /* ---------------------------------------------------------------- upload */
  function subirArchivo(evento) {
    evento.preventDefault();
    var caja = $('#upload-feedback');
    var input = $('#archivo-subida');
    if (!input.files || !input.files[0]) {
      feedback(caja, 'Elegí un archivo primero.', false);
      return;
    }

    var archivo = input.files[0];
    var lector = new FileReader();

    lector.onload = function () {
      var base64 = String(lector.result).split(',')[1] || '';
      postJSON('/admin/subir-archivo', {
        nombre: archivo.name,
        contenidoBase64: base64,
      }).then(function (resp) {
        if (!resp.ok) {
          feedback(caja, 'No se pudo subir: ' + (resp.data.error || 'error desconocido'), false);
          return;
        }
        feedback(caja, 'Archivo subido a ' + resp.data.url, true);
      });
    };

    lector.readAsDataURL(archivo);
  }

  /* -------------------------------------------------------------- reportes */
  function cargarReportes() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/ticket-promedio').then(function (t) {
        api('/reportes/mas-vendido').then(function (m) {
          var mas = m.data.producto;
          var kpis = [
            { label: 'Facturación', value: money(f.data.facturado) },
            { label: 'Pedidos', value: f.data.pedidos },
            { label: 'Ticket promedio', value: money(t.data.promedio) },
            { label: 'Más vendido', value: mas ? mas.nombre + ' (' + mas.unidades + ')' : '—' },
          ];
          renderizarKpis($('#kpis-reportes'), kpis);
        });
      });
    });
  }

  function consultarVentas() {
    var caja = $('#reporte-feedback');
    var variedad = $('#reporte-variedad').value;

    api('/reportes/ventas-por-variedad?variedad=' + encodeURIComponent(variedad)).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'Error: ' + (resp.data.error || 'desconocido'), false);
        $('#tabla-ventas').replaceChildren();
        return;
      }
      var ventas = resp.data.ventas || [];
      var cuerpo = crearTabla($('#tabla-ventas'), [
        { texto: 'Origen' }, { texto: 'Producto' },
        { texto: 'Unidades', clase: 'num' }, { texto: 'Total', clase: 'num' },
      ]);
      ventas.forEach(function (v) {
        var fila = elemento('tr');
        agregarCeldas(fila, [
          { texto: v.variedad }, { texto: v.nombre },
          { texto: v.unidades, clase: 'num' }, { texto: money(v.total), clase: 'num' },
        ]);
        cuerpo.appendChild(fila);
      });
      feedback(caja, 'Consulta realizada.', true);
    });
  }

  /* -------------------------------------------------------------- usuarios */
  function cargarUsuarios() {
    api('/admin/usuarios').then(function (resp) {
      var usuarios = resp.data.usuarios || [];
      var cuerpo = crearTabla($('#tabla-usuarios'), [
        { texto: '#' }, { texto: 'Usuario' }, { texto: 'Nombre' },
        { texto: 'Rol' }, { texto: 'Acciones' },
      ]);
      usuarios.forEach(function (u) {
        var fila = elemento('tr');
        agregarCeldas(fila, [{ texto: u.id }, { texto: u.username }, { texto: u.nombre }]);
        var rol = elemento('td');
        rol.appendChild(elemento('span', u.rol, 'badge' + (u.rol === 'admin' ? ' badge-admin' : '')));
        fila.appendChild(rol);
        var acciones = elemento('td');
        var select = elemento('select', null, 'sel-rol');
        select.setAttribute('data-usuario', u.id);
        ['cliente', 'mozo', 'barista', 'admin'].forEach(function (r) {
          var opcion = elemento('option', r);
          opcion.value = r;
          opcion.selected = r === u.rol;
          select.appendChild(opcion);
        });
        acciones.appendChild(select);
        fila.appendChild(acciones);
        cuerpo.appendChild(fila);
      });
    });
  }

  function cambiarRol(evento) {
    var select = evento.target.closest('.sel-rol');
    if (!select) return;
    var id = select.getAttribute('data-usuario');

    putJSON('/admin/usuarios/' + id, { rol: select.value }).then(function (resp) {
      if (!resp.ok) alert('No se pudo actualizar: ' + (resp.data.error || 'error'));
      cargarUsuarios();
    });
  }

  function cambiarPassword(evento) {
    evento.preventDefault();
    var caja = $('#password-feedback');
    postJSON('/admin/cambiar-contrasena', { nueva: $('#nueva-password').value }).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo cambiar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Contraseña actualizada.', true);
      $('#nueva-password').value = '';
    });
  }

  /* ----------------------------------------------------------- herramientas */
  function probarConexion(evento) {
    evento.preventDefault();
    var salida = $('#salida-conexion');
    salida.textContent = 'Probando…';

    postJSON('/admin/probar-conexion', { host: $('#conexion-host').value }).then(function (resp) {
      if (!resp.ok) {
        salida.textContent = 'Error: ' + (resp.data.error || 'desconocido');
        return;
      }
      salida.textContent =
        '$ ' + resp.data.comando + '\n\n' +
        (resp.data.salida || '') +
        (resp.data.error ? '\n[stderr]\n' + resp.data.error : '');
    });
  }

  function verDiagnostico() {
    var salida = $('#salida-diagnostico');
    salida.textContent = 'Cargando…';
    api('/_diagnostico').then(function (resp) {
      salida.textContent = JSON.stringify(resp.data, null, 2);
    });
  }

  /* ------------------------------------------------------------------ tabs */
  function activarTab(evento) {
    var tab = evento.target.closest('.tab');
    if (!tab) return;
    var vista = tab.getAttribute('data-vista');
    $$('.tab').forEach(function (t) { t.classList.remove('is-active'); });
    tab.classList.add('is-active');
    $$('.tab-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === vista);
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    var params = new URLSearchParams(window.location.search);
    var objetivo = params.get('vista');
    if (objetivo) {
      $('#panel-bienvenida').textContent = 'Panel ' + objetivo;
    }

    $('#form-login').addEventListener('submit', iniciarSesion);
    $('#btn-logout').addEventListener('click', cerrarSesion);
    $('#btn-refrescar').addEventListener('click', cargarTodo);
    $('#tabs').addEventListener('click', activarTab);
    $('#tabla-pedidos').addEventListener('change', cambiarEstado);
    $('#tabla-productos').addEventListener('click', borrarProducto);
    $('#form-producto').addEventListener('submit', guardarProducto);
    $('#btn-limpiar-producto').addEventListener('click', limpiarFormularioProducto);
    $('#form-upload').addEventListener('submit', subirArchivo);
    $('#form-password').addEventListener('submit', cambiarPassword);
    $('#btn-reporte-variedad').addEventListener('click', consultarVentas);
    $('#tabla-usuarios').addEventListener('change', cambiarRol);
    $('#form-conexion').addEventListener('submit', probarConexion);
    $('#btn-diagnostico').addEventListener('click', verDiagnostico);

    // ¿Ya hay sesión?
    api('/auth/yo').then(function (resp) {
      if (resp.ok) {
        usuario = resp.data.usuario;
        mostrarPanel();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
