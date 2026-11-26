import express from 'express';
import * as comentarios from '../services/comentarios.service';
import { verificarCsrf } from '../middleware/sesion';

const router = express.Router();

/**
 * GET /api/comentarios — reseñas públicas de la cafetería.
 * El sitio las pinta con innerHTML: por eso son un vector de XSS almacenado.
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ comentarios: await comentarios.listar() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/comentarios
 *
 * La longitud del autor y del texto y el rango de la calificación se validan
 * antes de guardar la reseña.
 */
router.post('/', verificarCsrf, async (req, res, next) => {
  try {
    const { autor, texto, calificacion } = req.body || {};
    if (typeof autor !== 'string' || autor.trim().length < 2 || autor.trim().length > 40) {
      return res.status(400).json({ error: 'El autor debe tener entre 2 y 40 caracteres.' });
    }
    if (typeof texto !== 'string' || texto.trim().length < 3 || texto.trim().length > 280) {
      return res.status(400).json({ error: 'La reseña debe tener entre 3 y 280 caracteres.' });
    }
    if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
      return res.status(400).json({ error: 'La calificación debe ser un entero entre 1 y 5.' });
    }
    const comentario = await comentarios.crear({
      autor: autor.trim(),
      texto: texto.trim(),
      calificacion,
    });
    res.status(201).json(comentario);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/comentarios/:id */
router.delete('/:id', verificarCsrf, async (req, res, next) => {
  try {
    // FALLA: sin verificación de rol — cualquiera puede borrar reseñas.
    const comentario = await comentarios.eliminar(req.params.id);
    if (!comentario) {
      return res.status(404).json({ error: 'Comentario no encontrado.' });
    }
    res.json(comentario);
  } catch (err) {
    next(err);
  }
});

export default router;
