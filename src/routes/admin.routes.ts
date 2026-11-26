import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

import config from '../config';
import * as catalogo from '../services/catalogo.service';
import * as usuarios from '../services/usuarios.service';
import { requiereSesion, requiereRol } from '../middleware/auth';
import { verificarCsrf } from '../middleware/sesion';
import type { Rol, Usuario } from '../tipos';

const router = express.Router();
const MAX_UPLOAD_BYTES = 700 * 1024;
const SERVIDORES_PERMITIDOS = new Set(['127.0.0.1', 'localhost', 'proveedor.origen.com']);
const ROLES_PERMITIDOS: readonly Rol[] = ['admin', 'barista', 'mozo', 'cliente'];
const MIME_POR_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function detectarMimeImagen(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Rutas del panel de administración.
 *
 * -----------------------------------------------------------------------------
 * Autorización del panel (OWASP A01:2021)
 * -----------------------------------------------------------------------------
 * Las rutas del panel requieren sesión y el rol admin.
 * -----------------------------------------------------------------------------
 */
router.use(requiereSesion);
router.use(requiereRol('admin'));

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
 */
router.put("/usuarios/:id", async (req, res, next) => {
  try {
    const { username, nombre, rol, password } = req.body || {};
    const cambios: Partial<Usuario> = {};
    if (username !== undefined) cambios.username = username;
    if (nombre !== undefined) cambios.nombre = nombre;
    if (rol !== undefined) {
      const rolValidado = typeof rol === 'string'
        ? ROLES_PERMITIDOS.find((rolPermitido) => rolPermitido === rol)
        : undefined;
      if (!rolValidado) {
        return res.status(400).json({ error: 'Rol no válido.' });
      }
      cambios.rol = rolValidado;
    }
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
router.post("/productos", verificarCsrf, async (req, res, next) => {
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
router.put("/productos/:id", verificarCsrf, async (req, res, next) => {
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
 */
router.delete("/productos/:id", verificarCsrf, async (req, res, next) => {
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
 * FALLAS: sin límite de intentos, y la contraseña nueva se guarda en texto
 * plano.
 */
router.post("/cambiar-contrasena", verificarCsrf, async (req, res, next) => {
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
 * Prueba de conexión con lista blanca y sin shell (OWASP A03:2021)
 * -----------------------------------------------------------------------------
 * Sólo se permiten destinos conocidos y ping recibe argumentos separados,
 * sin interpretar la entrada mediante un shell.
 * -----------------------------------------------------------------------------
 */
router.post("/probar-conexion", (req, res) => {
  const { host } = req.body || {};

  if (typeof host !== 'string' || !SERVIDORES_PERMITIDOS.has(host)) {
    return res.status(400).json({ error: 'Servidor no permitido.' });
  }

  const argumentos = ['-c', '3', host];
  const proceso = spawn('ping', argumentos, { shell: false });
  let salida = '';
  let errorSalida = '';

  proceso.stdout.on('data', (fragmento) => {
    salida += fragmento.toString();
  });
  proceso.stderr.on('data', (fragmento) => {
    errorSalida += fragmento.toString();
  });
  proceso.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  });
  proceso.on('close', (codigo) => {
    if (res.headersSent) return;
    res.json({
      comando: `ping ${argumentos.join(' ')}`,
      salida,
      error: errorSalida || (codigo === 0 ? null : `ping finalizó con código ${codigo}`),
    });
  });
});

/**
 * POST /api/admin/subir-archivo
 *
 * -----------------------------------------------------------------------------
 * Carga de imágenes con validación en servidor (OWASP A04:2021)
 * -----------------------------------------------------------------------------
 * Sólo se admiten imágenes PNG, JPEG y WebP que coincidan con su magic number.
 * Se limita el tamaño y se genera el nombre del archivo en el servidor.
 * -----------------------------------------------------------------------------
 */
router.post(
  "/subir-archivo",
  express.json({ limit: "8mb" }),
  (req, res, next) => {
    try {
      const { nombre, contenidoBase64 } = req.body || {};

    if (
      typeof nombre !== 'string' ||
      typeof contenidoBase64 !== 'string' ||
      !nombre.trim() ||
      !contenidoBase64
    ) {
      return res.status(400).json({ error: 'Falta el archivo.' });
    }

    const extension = path.extname(nombre).toLowerCase();
    const mimeEsperado = Object.prototype.hasOwnProperty.call(MIME_POR_EXTENSION, extension)
      ? MIME_POR_EXTENSION[extension]
      : undefined;
    if (!mimeEsperado) {
      return res.status(400).json({ error: 'Sólo se permiten imágenes PNG, JPG y WebP.' });
    }

    const maxBase64Length = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
    if (contenidoBase64.length > maxBase64Length) {
      return res.status(413).json({ error: 'El archivo supera el tamaño máximo de 700 KB.' });
    }

    const buffer = Buffer.from(contenidoBase64, 'base64');
    if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'El archivo supera el tamaño máximo de 700 KB o está vacío.' });
    }
    if (detectarMimeImagen(buffer) !== mimeEsperado) {
      return res.status(400).json({ error: 'El contenido del archivo no coincide con su extensión.' });
    }

    fs.mkdirSync(config.uploadsDir, { recursive: true });

    const nombreGenerado = `${randomUUID()}${extension}`;
    const destino = path.join(config.uploadsDir, nombreGenerado);
    fs.writeFileSync(destino, buffer);

    res.json({
      mensaje: 'Archivo subido.',
      url: `/uploads/${nombreGenerado}`,
      bytes: buffer.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
