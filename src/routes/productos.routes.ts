import express from 'express';
import * as catalogo from '../services/catalogo.service';
import type { FiltrosCatalogo } from '../services/catalogo.service';

const router = express.Router();

// Lista el catálogo con filtros opcionales.
// Los filtros se muestran como texto seguro en el cliente.
router.get('/', async (req, res, next) => {
  try {
    const productos = await catalogo.listar(req.query as FiltrosCatalogo);
    res.json({
      productos,
      filtros: {
        tipo: req.query.tipo || '',
        variedad: req.query.variedad || '',
        q: req.query.q || '',
      },
      total: productos.length,
    });
  } catch (err) {
    next(err);
  }
});

// Devuelve las variedades de café disponibles.
router.get('/variedades', async (req, res, next) => {
  try {
    res.json({ variedades: await catalogo.variedades() });
  } catch (err) {
    next(err);
  }
});

// Se valida el identificador del producto y se muestran mensajes de error genéricos.
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
      return res.status(400).json({ error: 'ID de producto inválido.' });
    }

    const producto = await catalogo.obtener(String(id));

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    res.json(producto);
  } catch (err) {
    next(err);
  }
});

export default router;