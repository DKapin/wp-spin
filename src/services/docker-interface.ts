/**
 * Interface for DockerService
 * Both the real implementation and mock will implement this interface
 */
export interface IDockerService {
  checkDiskSpace(): Promise<void>;
  checkDockerComposeInstalled(): Promise<void>;
  checkDockerInstalled(): Promise<void>;
  checkDockerRunning(): Promise<void>;
  checkMemory(): Promise<void>;
  checkPorts(): Promise<void>;
  checkProjectExists(): Promise<boolean>;
  getLogs(): Promise<string>;
  getPort(service: string): Promise<number>;
  getPortMappings(): Record<number, number>;
  getProjectPath(): string;
  logs(): Promise<void>;
  restart(): Promise<void>;
  shell(): Promise<void>;
  start(): Promise<void>;
  status(): Promise<void>;
  stop(): Promise<void>;
  updateDockerComposePorts(originalPort: number, newPort: number): Promise<void>;
} 