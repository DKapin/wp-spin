export const DEFAULT_PORTS = {
  MYSQL: 3306,
  PHPMYADMIN: 8081,
  WORDPRESS: 8080,
} as const;

export type PortType = keyof typeof DEFAULT_PORTS; 