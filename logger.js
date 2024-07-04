const winston = require('winston');
const { format, transports } = winston;

const logger = winston.createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message, meta }) => {
            return `${timestamp} [${level}] telegram_id: ${meta?.telegram_id || 'unknown'} - ${message} ${meta?.clientIp ? 'Client IP: ' + meta.clientIp : ''}`;
        })
    ),
    transports: [
        new transports.Console({  // Виводимо логи в консоль
            format: format.combine(
                format.colorize(),  // Додаємо кольори для кращого сприйняття
                format.printf(({ timestamp, level, message, meta }) => {
                    return `${timestamp} [${level}] telegram_id: ${meta?.telegram_id || 'unknown'} - ${message}`;
                })
            )
        }),
        new transports.File({ filename: 'combined.log' })  // Зберігаємо логи в файл
    ]
});

module.exports = logger;