export const DEFAULT_PORTS = {
  MAILHOG_SMTP: 1025,
  MAILHOG_WEB: 8025,
  MYSQL: 3306,
  PHPMYADMIN: 8082,
  WORDPRESS: 8083,
} as const;

export type PortType = keyof typeof DEFAULT_PORTS; 