/* =============================================================================
   Cafetería Origen — lógica del sitio público
   ============================================================================= */
(function () {
  "use strict";

  var API = "/api";
  var CARRITO_KEY = "origen.carrito";

  var estado = {
    tipo: "",
    variedad: "",
    q: "",
    carrito: cargarCarrito(),
  };

  /* ---------------------------------------------------------------- utils */
  function $(sel) {
    return document.querySelector(sel);
  }

  function money(valor) {
    var n = Number(valor || 0);
    return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  function api(url, opciones) {
    return fetch(API + url, opciones).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
    });
  }

  function postJSON(url, cuerpo) {
    return api(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function guardarCarrito() {
    try {
      localStorage.setItem(CARRITO_KEY, JSON.stringify(estado.carrito));
    } catch (e) {
      /* almacenamiento no disponible */
    }
  }

  function cargarCarrito() {
    try {
      return JSON.parse(localStorage.getItem(CARRITO_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  /* ------------------------------------------------------------- catálogo */
  function urlCatalogo() {
    var params = new URLSearchParams();
    if (estado.tipo) params.set("tipo", estado.tipo);
    if (estado.variedad) params.set("variedad", estado.variedad);
    if (estado.q) params.set("q", estado.q);
    var s = params.toString();
    return "/productos" + (s ? "?" + s : "");
  }

  function cargarProductos() {
    return api(urlCatalogo()).then(function (resp) {
      if (!resp.ok) {
        renderErrorProductos(resp.data && resp.data.error);
        return;
      }
      renderProductos(resp.data.productos);
      renderResultado(resp.data.filtros, resp.data.total);
    });
  }

  function renderProductos(productos) {
    var grid = $('#productos-grid');
    grid.replaceChildren();

    if (!productos || productos.length === 0) {
      var parrafo = document.createElement('p');
      parrafo.className = 'empty';
      parrafo.textContent = 'No encontramos productos con esos filtros.';
      grid.appendChild(parrafo);
      return;
    }

    // Se crean los elementos del catálogo sin interpretar los datos como HTML.
    productos.forEach(function (p) {
      window.__productos[p.id] = p;

      var article = document.createElement('article');
      article.className = 'product-card';

      var top = document.createElement('div');
      top.className = 'product-top';

      var nombre = document.createElement('h3');
      nombre.className = 'product-name';
      nombre.textContent = p.nombre;

      var precio = document.createElement('span');
      precio.className = 'product-price';
      precio.textContent = money(p.precio);

      top.append(nombre, precio);

      var tags = document.createElement('div');
      tags.className = 'product-tags';

      var tipo = document.createElement('span');
      tipo.className = 'tag';
      tipo.textContent = p.tipo;
      tags.appendChild(tipo);

      if (p.variedad) {
        var variedad = document.createElement('span');
        variedad.className = 'tag tag-origen';
        variedad.textContent = p.variedad;
        tags.appendChild(variedad);
      }

      if (p.tamano) {
        var tamano = document.createElement('span');
        tamano.className = 'tag';
        tamano.textContent = p.tamano;
        tags.appendChild(tamano);
      }

      var descripcion = document.createElement('p');
      descripcion.className = 'product-desc';
      descripcion.textContent = p.descripcion;

      var boton = document.createElement('button');
      boton.className = 'btn btn-ghost btn-agregar';
      boton.setAttribute('data-id', String(p.id));
      boton.textContent = 'Agregar';

      article.append(top, tags, descripcion, boton);
      grid.appendChild(article);
    });
  }

  function renderResultado(filtros, total) {
    var el = $("#resultado-busqueda");

    // Se muestra el texto de búsqueda sin interpretarlo como HTML.
    if (filtros && filtros.q) {
      var strong = document.createElement('strong');
      strong.textContent = filtros.q;

      el.replaceChildren(
        'Resultados para ',
        strong,
        ' — ' + total + ' producto(s)'
      );
    } else {
      el.textContent = total + " producto(s) en el menú";
    }
  }

  function renderErrorProductos(mensaje) {
    var grid = $('#productos-grid');
    var parrafo = document.createElement('p');

    parrafo.className = 'empty';
    parrafo.textContent = 'No se pudo cargar el menú: ' + (mensaje || 'error desconocido');

    grid.replaceChildren(parrafo);
  }

  /* --------------------------------------------------------------- carrito */
  function agregarAlCarrito(productoId) {
    var existente = null;
    for (var i = 0; i < estado.carrito.length; i++) {
      if (String(estado.carrito[i].id) === String(productoId))
        existente = estado.carrito[i];
    }
    if (existente) {
      existente.cantidad += 1;
    } else {
      estado.carrito.push({
        id: productoId,
        nombre: window.__productos[productoId]
          ? window.__productos[productoId].nombre
          : "Producto",
        precio: window.__productos[productoId]
          ? window.__productos[productoId].precio
          : 0,
        cantidad: 1,
      });
    }
    guardarCarrito();
    renderCarrito();
  }

  function cambiarCantidad(indice, delta) {
    var item = estado.carrito[indice];
    if (!item) return;
    item.cantidad += delta;
    if (item.cantidad <= 0) estado.carrito.splice(indice, 1);
    guardarCarrito();
    renderCarrito();
  }

  function quitarDelCarrito(indice) {
    estado.carrito.splice(indice, 1);
    guardarCarrito();
    renderCarrito();
  }

  function renderCarrito() {
    var cont = $("#carrito");
    var lista = $("#resumen-carrito");
    var total = 0;

    cont.replaceChildren();
    lista.replaceChildren();

    if (estado.carrito.length === 0) {
      var parrafo = document.createElement('p');
      parrafo.className = 'empty';
      parrafo.textContent = 'El carrito está vacío.';
      cont.appendChild(parrafo);
      $('#resumen-total').textContent = money(0);
      return;
    }

    // Se muestran los datos del carrito sin interpretarlos como HTML.
    estado.carrito.forEach(function (item, i) {
      var subtotal = item.precio * item.cantidad;
      total += subtotal;

      var cartItem = document.createElement('div');
      cartItem.className = 'cart-item';

      var info = document.createElement('div');

      var nombre = document.createElement('div');
      nombre.className = 'cart-item-name';
      nombre.textContent = item.nombre;

      var precio = document.createElement('div');
      precio.className = 'cart-item-meta';
      precio.textContent = money(item.precio) + ' c/u';

      info.append(nombre, precio);

      var cantidad = document.createElement('div');
      cantidad.className = 'qty-control';

      var menos = document.createElement('button');
      menos.type = 'button';
      menos.setAttribute('data-acc', 'menos');
      menos.setAttribute('data-i', String(i));
      menos.textContent = '−';

      var numero = document.createElement('span');
      numero.textContent = item.cantidad;

      var mas = document.createElement('button');
      mas.type = 'button';
      mas.setAttribute('data-acc', 'mas');
      mas.setAttribute('data-i', String(i));
      mas.textContent = '+';

      cantidad.append(menos, numero, mas);

      var acciones = document.createElement('div');

      var precioTotal = document.createElement('div');
      precioTotal.className = 'cart-item-price';
      precioTotal.textContent = money(subtotal);

      var quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'link-danger';
      quitar.setAttribute('data-acc', 'quitar');
      quitar.setAttribute('data-i', String(i));
      quitar.textContent = 'Quitar';

      acciones.append(precioTotal, quitar);
      cartItem.append(info, cantidad, acciones);
      cont.appendChild(cartItem);

      var li = document.createElement('li');

      var detalle = document.createElement('span');
      detalle.textContent = item.nombre + ' × ' + item.cantidad;

      var importe = document.createElement('span');
      importe.textContent = money(subtotal);

      li.append(detalle, importe);
      lista.appendChild(li);
    });

    $('#resumen-total').textContent = money(total);
  }

  /* ---------------------------------------------------------------- pedidos */
  function enviarPedido(evento) {
    evento.preventDefault();
    var feedback = $("#pedido-feedback");
    feedback.className = "form-feedback";
    feedback.textContent = "Enviando…";

    postJSON("/pedidos", {
      mesa: $("#pedido-mesa").value,
      cliente: $("#pedido-cliente").value,
      items: estado.carrito.map(function (item) {
        return { productoId: item.id, cantidad: item.cantidad };
      }),
    }).then(function (resp) {
      if (!resp.ok) {
        // Se muestra el mensaje de error como texto seguro.
        feedback.className = 'form-feedback is-error';
        feedback.textContent = 'No pudimos enviar el pedido: ' + (resp.data.error || 'error desconocido');
        return;
      }
      feedback.className = 'form-feedback is-ok';
      feedback.textContent = '¡Pedido #' + resp.data.id + ' recibido! Total ' + money(resp.data.total) +
        '. Te atendemos en la mesa ' + resp.data.mesa + '.';
      estado.carrito = [];
      guardarCarrito();
      renderCarrito();
      $('#form-pedido').reset();
    }).catch(function () {
      feedback.className = 'form-feedback is-error';
      feedback.textContent = 'Error de conexión con el servidor.';
    });
  }

  /* --------------------------------------------------------------- reseñas */
  function cargarReseñas() {
    return api('/comentarios').then(function (resp) {
      var cont = $('#lista-resenas');
      cont.replaceChildren();

      if (!resp.ok || !resp.data.comentarios || resp.data.comentarios.length === 0) {
        var parrafo = document.createElement('p');
        parrafo.className = 'empty';
        parrafo.textContent = 'Todavía no hay reseñas. ¡Sé el primero!';
        cont.appendChild(parrafo);
        return;
      }

      // Se muestran las reseñas como texto, sin interpretar código HTML.
      resp.data.comentarios.forEach(function (c) {
        var estrellas = '';
        var i;
        for (i = 0; i < Number(c.calificacion || 0); i++) estrellas += '★';

        var article = document.createElement('article');
        article.className = 'review';

        var head = document.createElement('div');
        head.className = 'review-head';

        var autor = document.createElement('span');
        autor.className = 'review-author';
        autor.textContent = c.autor;

        var calificacion = document.createElement('span');
        calificacion.className = 'review-stars';
        calificacion.textContent = estrellas;

        var texto = document.createElement('p');
        texto.className = 'review-text';
        texto.textContent = c.texto;

        head.append(autor, calificacion);
        article.append(head, texto);
        cont.appendChild(article);
      });
    });
  }

  function enviarReseña(evento) {
    evento.preventDefault();
    var feedback = $("#resena-feedback");
    feedback.className = "form-feedback";
    feedback.textContent = "Publicando…";

    postJSON("/comentarios", {
      autor: $("#resena-autor").value,
      texto: $("#resena-texto").value,
      calificacion: Number($("#resena-calificacion").value),
    }).then(function (resp) {
      if (!resp.ok) {
        feedback.className = 'form-feedback is-error';
        feedback.textContent = 'No se pudo publicar: ' + (resp.data.error || 'error desconocido');
        return;
      }
      feedback.className = "form-feedback is-ok";
      feedback.textContent = "¡Gracias por tu reseña!";
      $("#form-resena").reset();
      cargarReseñas();
    });
  }

  /* ------------------------------------------------------------- listeners */
  function init() {
    window.__productos = {};

    // Filtros
    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        chip.classList.add("is-active");
        estado.tipo = chip.getAttribute("data-tipo");
        cargarProductos();
      });
    });

    $("#filtro-variedad").addEventListener("change", function (e) {
      estado.variedad = e.target.value;
      cargarProductos();
    });

    var temporizador = null;
    $("#filtro-busqueda").addEventListener("input", function (e) {
      estado.q = e.target.value;
      clearTimeout(temporizador);
      temporizador = setTimeout(cargarProductos, 250);
    });

    // Carrito (delegación de eventos)
    $("#productos-grid").addEventListener("click", function (e) {
      var btn = e.target.closest(".btn-agregar");
      if (!btn) return;
      agregarAlCarrito(btn.getAttribute("data-id"));
    });

    $("#carrito").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var i = Number(btn.getAttribute("data-i"));
      var accion = btn.getAttribute("data-acc");
      if (accion === "mas") cambiarCantidad(i, 1);
      else if (accion === "menos") cambiarCantidad(i, -1);
      else if (accion === "quitar") quitarDelCarrito(i);
    });

    $("#form-pedido").addEventListener("submit", enviarPedido);
    $("#form-resena").addEventListener("submit", enviarReseña);

    // Carga inicial
    api(urlCatalogo()).then(function (resp) {
      if (resp.ok) {
        (resp.data.productos || []).forEach(function (p) {
          window.__productos[p.id] = p;
        });
        renderProductos(resp.data.productos);
        renderResultado(resp.data.filtros, resp.data.total);
      } else {
        renderErrorProductos(resp.data.error);
      }
    });
    cargarReseñas();
    renderCarrito();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
