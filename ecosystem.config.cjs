/**
 * PM2 process definitions for the Hostinger VPS.
 *
 * Both apps read their configuration from the environment, not from a committed
 * file — set the real values in PM2's own env (or a deploy-time `.env` that is
 * never committed) rather than here. Nothing in this file is a secret.
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'heirlom-server',
      cwd: './apps/server',
      script: 'dist/index.js',
      instances: 1,
      /* Deliberately not clustered. The breed endpoint's Redis lock is
         cross-process safe, but scaling out is a decision to take with load
         numbers in hand rather than by default. */
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      error_file: './logs/server.err.log',
      out_file: './logs/server.out.log',
      time: true,
    },
    {
      name: 'heirlom-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/web.err.log',
      out_file: './logs/web.out.log',
      time: true,
    },
  ],
};
