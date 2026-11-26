import path from 'path';

/**
 * Configuración de la aplicación.
 * Las credenciales de la base de datos y el secreto de sesión
 * se obtienen desde las variables de entorno.
 */
export default {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'origen',
    // Las credenciales se obtienen desde las variables de entorno.
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },

  // El secreto de sesión se obtiene desde una variable de entorno.
  sessionSecret: process.env.SESSION_SECRET,

  // FALLA: credenciales por defecto que nunca se cambian.
  credencialesPorDefecto: {
    username: 'admin',
    password: 'admin',
  },

  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
};