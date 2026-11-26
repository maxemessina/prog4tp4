/**
 * Gestión de sesiones.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Gestión de sesiones insegura (Autenticación insegura)
 * -----------------------------------------------------------------------------
 * El cierre de sesión sólo borra la cookie del cliente: la sesión sigue
 *    viva en el servidor.
 *
 * Corrección: usar crypto.randomUUID() (o crypto.randomBytes -> hex) para el
 * id, con expiración por inactividad y absoluta, cookie con
 * { httpOnly: true, secure: true, sameSite: 'lax' }, regeneración del id tras
 * el login y borrado de la sesión en el servidor al hacer logout.
 * -----------------------------------------------------------------------------
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import config from '../config';
import type { Sesion, UsuarioSesion } from '../tipos';

export const sesiones = new Map<string, Sesion>();
const claveAnonima = randomBytes(32);
const TTL_INACTIVIDAD = 30 * 60 * 1000;
const TTL_ABSOLUTO = 8 * 60 * 60 * 1000;

function tokenAnonimo(valor: string): string {
  return createHmac('sha256', claveAnonima).update(valor).digest('hex');
}

/** Lee las cookies de la petición (parser mínimo, sin dependencias). */
export function leerCookies(req: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const parte of header.split(';')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    const nombre = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();
    if (nombre) cookies[nombre] = decodeURIComponent(valor);
  }
  return cookies;
}

/** Crea una sesión nueva para el usuario y setea la cookie. */
export function crearSesion(req: Request, res: Response, usuario: UsuarioSesion): string {
  destruirSesion(req);
  const id = randomBytes(32).toString('hex');
  const ahora = Date.now();

  sesiones.set(id, {
    usuario,
    creadaEn: ahora,
    expiraEn: ahora + TTL_INACTIVIDAD,
    csrfToken: randomBytes(32).toString('hex'),
  });

  res.cookie('sid', id, {
    path: '/',
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: TTL_ABSOLUTO,
  });

  return id;
}

/** Devuelve la sesión de la petición, si existe. */
export function obtenerSesion(req: Request): Sesion | null {
  const cookies = leerCookies(req);
  const id = cookies.sid;
  if (!id) return null;
  const sesion = sesiones.get(id);
  if (!sesion) return null;

  const ahora = Date.now();
  const limiteAbsoluto = sesion.creadaEn + TTL_ABSOLUTO;
  if (sesion.expiraEn === null || ahora >= sesion.expiraEn || ahora >= limiteAbsoluto) {
    sesiones.delete(id);
    return null;
  }

  sesion.expiraEn = Math.min(ahora + TTL_INACTIVIDAD, limiteAbsoluto);
  return sesion;
}

export function entregarTokenCsrf(req: Request, res: Response): void {
  const sesion = obtenerSesion(req);
  let token: string;

  if (sesion) {
    token = sesion.csrfToken;
  } else {
    let identificador = leerCookies(req).csrf;
    if (!identificador || !/^[a-f0-9]{64}$/.test(identificador)) {
      identificador = randomBytes(32).toString('hex');
      res.cookie('csrf', identificador, { httpOnly: true, sameSite: 'lax', path: '/' });
    }
    token = tokenAnonimo(identificador);
  }

  res.set('Cache-Control', 'no-store').json({ token });
}

export function verificarCsrf(req: Request, res: Response, next: NextFunction) {
  const origen = req.get('Origin');
  const referer = req.get('Referer');
  const origenEsperado = `${req.protocol}://${req.get('Host')}`;
  if (origen && origen !== origenEsperado) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  if (!origen && referer) {
    let origenReferer: string;
    try {
      origenReferer = new URL(referer).origin;
    } catch {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
    if (origenReferer !== origenEsperado) {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
  }

  const sesion = obtenerSesion(req);
  const identificador = leerCookies(req).csrf;
  const esperado = sesion
    ? sesion.csrfToken
    : identificador && /^[a-f0-9]{64}$/.test(identificador)
      ? tokenAnonimo(identificador)
      : '';
  const recibido = req.get('X-CSRF-Token') || req.body?._csrf;
  if (typeof recibido !== 'string' || !/^[a-f0-9]{64}$/.test(recibido) ||
      !esperado || !timingSafeEqual(Buffer.from(recibido, 'hex'), Buffer.from(esperado, 'hex'))) {
    return res.status(403).json({ error: 'Token CSRF inválido o ausente.' });
  }

  next();
}

/** Cierra la sesión en el servidor (debería llamarse en el logout). */
export function destruirSesion(req: Request): void {
  const cookies = leerCookies(req);
  const id = cookies.sid;
  if (id) sesiones.delete(id);
}
