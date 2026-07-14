import { registerSignalHandlers, startSchedulerIfEnabled } from './lib/start-backup-scheduler';

export function registerNodeInstrumentation(): void {
  registerSignalHandlers();
  startSchedulerIfEnabled();
}
