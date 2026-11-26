import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { isIP } from "net";
import config from "../config";
import * as catalogo from "../services/catalogo.service";
import * as usuarios from "../services/usuarios.service";
import { requiereSesion, requiereRol } from "../middleware/auth";
import type { Usuario } from "../tipos";

const router = express.Router();

/**
 * Rutas del panel de administración.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Autorización ausente / escalada de privilegios (OWASP A01:2021)
 * -----------------------------------------------------------------------------
 * Se exige estar autenticado, pero NO se comprueba el rol: `requiereRol` está
 * importado y no se usa. Cualquier usuario autenticado (incluso con rol
 * "cliente") entra al panel y puede:
 *   - crear, editar y BORRAR productos,
 *   - cambiar contraseñas,
 *   - dar de alta usuarios y cambiarles el rol (escalada de privilegios),
 *   - ejecutar comandos en el servidor.
 *
 * Corrección: `router.use(requiereRol('admin'))` sobre las rutas sensibles.
 * -----------------------------------------------------------------------------
 */
router.use(requiereSesion, requiereRol("admin"));

/** GET /api/admin/usuarios */
router.get("/usuarios", async (req, res, next) => {
  try {
    res.json({ usuarios: await usuarios.listar() });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id
 *
 * FALLA — Asignación masiva: se actualiza cualquier campo que llegue en el
 * cuerpo, incluido el `rol`. Un usuario con rol "cliente" puede mandarse
 * `{"rol": "admin"}` y convertirse en administrador.
 */
router.put("/usuarios/:id", async (req, res, next) => {
  try {
    const { username, nombre, rol, password } = req.body || {};
    const cambios: Partial<Usuario> = {};
    if (username !== undefined) cambios.username = username;
    if (nombre !== undefined) cambios.nombre = nombre;
    if (password !== undefined) cambios.password = password;

    const usuario = await usuarios.actualizar(req.params.id, cambios);
    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    res.json(usuario);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/productos — alta de producto. */
router.post("/productos", async (req, res, next) => {
  try {
    const producto = await catalogo.crear(req.body || {});
    res.status(201).json(producto);
  } catch (err) {
    // El nombre del producto es único en la base.
    if ((err as { code?: string }).code === "23505") {
      return res
        .status(409)
        .json({ error: "Ya existe un producto con ese nombre." });
    }
    next(err);
  }
});

/** PUT /api/admin/productos/:id */
router.put("/productos/:id", async (req, res, next) => {
  try {
    const producto = await catalogo.actualizar(req.params.id, req.body || {});
    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado." });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/productos/:id
 *
 * FALLA — CSRF: la petición que borra un producto no lleva ningún token y se
 * acepta con un simple GET/POST desde cualquier origen.
 */
router.delete("/productos/:id", async (req, res, next) => {
  try {
    const producto = await catalogo.eliminar(req.params.id);
    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado." });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/cambiar-contrasena
 *
 * FALLAS: sin token anti-CSRF, sin límite de intentos, y la contraseña nueva
 * se guarda en texto plano.
 */
router.post("/cambiar-contrasena", async (req, res, next) => {
  try {
    const { nueva } = req.body || {};
    if (!nueva) {
      return res.status(400).json({ error: "Falta la contraseña nueva." });
    }
    // FALLA: no se valida la longitud ni la complejidad de la contraseña.
    // (`req.usuario!`: requiereSesion ya garantizó que hay un usuario.)
    const usuario = await usuarios.cambiarPassword(req.usuario!.id, nueva);
    res.json({ mensaje: "Contraseña actualizada.", usuario });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/probar-conexion
 *
 * -----------------------------------------------------------------------------
 * FALLA — Inyección de comandos del sistema operativo (OWASP A03:2021)
 * -----------------------------------------------------------------------------
 * La dirección del proveedor se mete dentro de una cadena de shell.
 * Como `exec` launches /bin/sh -c, los operadores del shell (|, ;, &&, $())
 * se interpretan y permiten ejecutar comandos arbitrarios en el contenedor.
 *
 * Corrección: validar el host contra una LISTA BLANCA y ejecutar el proceso
 * con `spawn('ping', ['-c', '3', host], { shell: false })`, sin pasar por el
 * shell.
 * -----------------------------------------------------------------------------
 */
router.post("/probar-conexion", (req, res) => {
  const { host } = req.body || {};

  if (typeof host !== "string" || host.length === 0 || host.length > 253) {
    return res.status(400).json({ error: "Host inválido." });
  }
  const esIP = isIP(host) !== 0;

  const esDominio =
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(
      host,
    );

  if (!esIP && !esDominio) {
    return res.status(400).json({ error: "Host inválido." });
  }

  const proceso = spawn("ping", ["-c", "3", host], {
    shell: false,
  });

  let salida = "";
  let errorSalida = "";

  proceso.stdout.on("data", (datos) => {
    salida += datos.toString();
  });

  proceso.stderr.on("data", (datos) => {
    errorSalida += datos.toString();
  });

  proceso.on("error", (error) => {
    res.status(500).json({
      error: "No se pudo ejecutar la prueba de conexión.",
    });
  });

  proceso.on("close", (codigo) => {
    if (res.headersSent) return;

    res.json({
      host,
      salida,
      error: errorSalida || (codigo !== 0 ? "Falló la conexión." : null),
    });
  });
});

/**
 * POST /api/admin/subir-archivo
 *
 * -----------------------------------------------------------------------------
 * FALLA — Carga de archivos sin restricciones (OWASP A04:2021)
 * -----------------------------------------------------------------------------
 * No se valida la extensión, el tipo MIME ni el tamaño del archivo, y se
 * guarda con el nombre que manda el cliente (además sin sanitizar "../", lo
 * que permite escribir fuera de la carpeta de subidas). Los archivos subidos
 * se sirven con express.static desde el mismo origen.
 *
 * Corrección: validar extensión contra lista blanca (.png/.jpg/.svg saneado),
 * verificar el tipo MIME real, limitar el tamaño, generar un nombre aleatorio
 * y guardar fuera del árbol web.
 * -----------------------------------------------------------------------------
 */
router.post(
  "/subir-archivo",
  express.json({ limit: "8mb" }),
  (req, res, next) => {
    try {
      const { nombre, contenidoBase64 } = req.body || {};

      if (!nombre || !contenidoBase64) {
        return res.status(400).json({ error: "Falta el archivo." });
      }

      // Validar extensión.
      const extension = path.extname(nombre).toLowerCase();
      const extensionesPermitidas = [".jpg", ".jpeg", ".png", ".webp"];

      if (!extensionesPermitidas.includes(extension)) {
        return res.status(400).json({ error: "Tipo de archivo no permitido" });
      }

      // Evitar path traversal.
      if (path.basename(nombre) !== nombre) {
        return res.status(400).json({ error: "Nombre de archivo inválido" });
      }

      const buffer = Buffer.from(contenidoBase64, "base64");

      // Validar tamaño máximo de 5 MB.
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: "El archivo supera el tamaño máximo permitido",
        });
      }

      // Validar el contenido real del archivo.
      const esImagen =
        ((extension === ".jpg" || extension === ".jpeg") &&
          buffer[0] === 0xff &&
          buffer[1] === 0xd8) ||
        (extension === ".png" &&
          buffer
            .subarray(0, 4)
            .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
        (extension === ".webp" && buffer.toString("ascii", 8, 12) === "WEBP");

      if (!esImagen) {
        return res.status(400).json({
          error: "El contenido del archivo no coincide con su extensión",
        });
      }

      fs.mkdirSync(config.uploadsDir, { recursive: true });

      // Generar un nombre seguro del lado del servidor.
      const nombreSeguro = `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
      const destino = path.join(config.uploadsDir, nombreSeguro);

      fs.writeFileSync(destino, buffer);

      return res.json({
        mensaje: "Archivo subido correctamente",
        nombre: nombreSeguro,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
