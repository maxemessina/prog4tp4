import express from 'express';

const router = express.Router();

// Se muestra únicamente información general del servidor, sin exponer datos sensibles.
router.get('/', (req, res) => {
  res.json({
    mensaje: 'Diagnóstico del servidor',
    version: '1.0.0',
  });
});

export default router;