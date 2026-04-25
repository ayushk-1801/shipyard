import { EventEmitter } from "node:events";
import type { Deployment, DeploymentEvent, DeploymentLog, LogEvent } from "./types.js";

type Listener<T> = (event: T) => void;

export class EventHub {
  private readonly emitter = new EventEmitter();

  publishLog(log: DeploymentLog) {
    const event: LogEvent = {
      event: "log",
      id: String(log.seq),
      data: log
    };
    this.emitter.emit(`logs:${log.deploymentId}`, event);
  }

  publishStatus(deployment: Deployment) {
    const logEvent: LogEvent = {
      event: "status",
      data: deployment
    };
    const deploymentEvent: DeploymentEvent = {
      event: "deployment",
      data: deployment
    };
    this.emitter.emit(`logs:${deployment.id}`, logEvent);
    this.emitter.emit("deployments", deploymentEvent);
  }

  publishDone(deploymentId: string) {
    const event: LogEvent = {
      event: "done",
      data: { deploymentId }
    };
    this.emitter.emit(`logs:${deploymentId}`, event);
  }

  subscribeToLogs(deploymentId: string, listener: Listener<LogEvent>) {
    const key = `logs:${deploymentId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  subscribeToDeployments(listener: Listener<DeploymentEvent>) {
    this.emitter.on("deployments", listener);
    return () => this.emitter.off("deployments", listener);
  }
}
