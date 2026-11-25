import express from 'express';
import { requiereSesion, requiereRol } from '../middleware/auth';

const router = express.Router();

router.use(requiereSesion);
router.use(requiereRol('admin'));

// Se muestra únicamente información general del servidor, sin exponer datos sensibles.
router.get('/', (req, res) => {
  res.json({
    mensaje: 'Diagnóstico del servidor',
    version: '1.0.0',
  });
});

export default router;