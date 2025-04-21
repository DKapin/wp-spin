export const DEFAULT_PORTS = {
  MYSQL: 3306,
  PHPMYADMIN: 8082,
  WORDPRESS: 8083,
} as const;

export type PortType = keyof typeof DEFAULT_PORTS; 