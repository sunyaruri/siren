import type { Command } from './priority.ts';

export type Publish = (topic: string, payload: object, retain: boolean) => void;

/** Intersection commands are retained so an ESP32 or dashboard gets the current state on (re)connect. */
export function publishCommands(publish: Publish, topicPrefix: string, commands: Command[]): void {
  for (const { intersectionId, cmd } of commands) publish(`${topicPrefix}/intersection/${intersectionId}/cmd`, cmd, true);
}
