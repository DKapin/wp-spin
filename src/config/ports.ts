export const DEFAULT_PORTS = {
  WORDPRESS: 8080,
  PHPMYADMIN: 8081,
  MYSQL: 3306,
} as const;

export type PortType = keyof typeof DEFAULT_PORTS; 