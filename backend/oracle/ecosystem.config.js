// ecosystem.config.js
// PM2 process manager configuration
// Usage:
//   pm2 start ecosystem.config.js        — start all services
//   pm2 stop all                          — stop all
//   pm2 logs oracle                       — tail oracle logs
//   pm2 monit                             — live dashboard

module.exports = {
  apps: [
    {
      name:         'oracle',
      script:       './oracle.js',
      cwd:          __dirname,
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      error_file:   './logs/oracle-error.log',
      out_file:     './logs/oracle-out.log',
      log_file:     './logs/oracle-combined.log',
      time:         true,
      restart_delay: 5000,
      max_restarts:  10,
    },
  ],
};
