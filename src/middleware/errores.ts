import type { NextFunction, Request, Response } from 'express';

import type { ErrorHttp } from '../tipos';

export function rutaNoEncontrada(req: Request, res: Response): void {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

// Se registra el detalle del error en el servidor y se devuelve un mensaje genérico al cliente.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function manejadorErrores(err: ErrorHttp, req: Request, res: Response, next: NextFunction): void {
  console.error('[error]', err.stack || err.message);

  res.status(err.status || 500).json({
    error: 'Error interno',
  });
}