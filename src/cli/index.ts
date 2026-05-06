import { connectControlClient, ControlClientError } from '../control/client';
import { formatHelp } from './help';
import { parseCliArgs, type CliCommand } from './parse';
import { getCliVersion } from './version';
import { createSessionOnDisk, listSessionsOnDisk } from './session-store';
import { runUpdateCommand } from './update';
import { SessionStorageError } from '../effect/errors';

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_NO_UI = 3;
const EXIT_NOT_FOUND = 4;
const EXIT_AMBIGUOUS = 5;
const EXIT_INTERNAL = 6;

type CliOutcome = { kind: 'attach'; session?: string } | { kind: 'handled'; exitCode: number };

function printError(message: string): void {
  console.error(message);
}

function handleControlError(error: unknown): { exitCode: number; message: string } {
  if (error instanceof ControlClientError) {
    switch (error.code) {
      case 'invalid_request':
        return { exitCode: EXIT_USAGE, message: error.message };
      case 'not_found':
        return { exitCode: EXIT_NOT_FOUND, message: error.message };
      case 'ambiguous':
        return { exitCode: EXIT_AMBIGUOUS, message: error.message };
      default:
        return { exitCode: EXIT_INTERNAL, message: error.message };
    }
  }

  const fallback = error instanceof Error ? error.message : 'Control command failed.';
  return { exitCode: EXIT_INTERNAL, message: fallback };
}

async function withControlClient(): Promise<ReturnType<typeof connectControlClient> | null> {
  try {
    return await connectControlClient({ timeoutMs: 250 });
  } catch {
    // intentionally ignored: control server may not be running
    return null;
  }
}

async function runSessionList(json: boolean): Promise<CliOutcome> {
  const { sessions, activeSessionId } = await listSessionsOnDisk();

  if (json) {
    const payload = sessions.map((session) => ({
      ...session,
      active: session.id === activeSessionId,
    }));
    console.log(JSON.stringify(payload));
  } else {
    const lines = sessions.map((session) => {
      const marker = session.id === activeSessionId ? '*' : ' ';
      return `${marker} ${session.name} (${session.id})`;
    });
    console.log(lines.join('\n'));
  }

  return { kind: 'handled', exitCode: EXIT_SUCCESS };
}

async function runSessionCreate(name?: string): Promise<CliOutcome> {
  const client = await withControlClient();
  if (client) {
    try {
      const response = await client.request('session.create', name ? { name } : undefined);
      const result = response.header.result as { session?: { id?: string } } | undefined;
      const sessionId = result?.session?.id ?? null;
      if (sessionId) {
        console.log(sessionId);
      }
      client.close();
      return { kind: 'handled', exitCode: EXIT_SUCCESS };
    } catch (error) {
      client.close();
      const mapped = handleControlError(error);
      printError(mapped.message);
      return { kind: 'handled', exitCode: mapped.exitCode };
    }
  }

  const metadata = await createSessionOnDisk(name);
  if (metadata instanceof SessionStorageError) {
    console.error(`Failed to create session: ${metadata.message}`);
    return { kind: 'handled', exitCode: EXIT_INTERNAL };
  }
  console.log(metadata.id);
  return { kind: 'handled', exitCode: EXIT_SUCCESS };
}

async function runPaneSplit(
  command: Extract<CliCommand, { kind: 'pane.split' }>
): Promise<CliOutcome> {
  const client = await withControlClient();
  if (!client) {
    printError('No active openmux UI. Attach first.');
    return { kind: 'handled', exitCode: EXIT_NO_UI };
  }

  try {
    await client.request('pane.split', {
      direction: command.direction,
      workspaceId: command.workspaceId,
      pane: command.pane,
    });
    client.close();
    return { kind: 'handled', exitCode: EXIT_SUCCESS };
  } catch (error) {
    client.close();
    const mapped = handleControlError(error);
    printError(mapped.message);
    return { kind: 'handled', exitCode: mapped.exitCode };
  }
}

async function runPaneSend(
  command: Extract<CliCommand, { kind: 'pane.send' }>
): Promise<CliOutcome> {
  const client = await withControlClient();
  if (!client) {
    printError('No active openmux UI. Attach first.');
    return { kind: 'handled', exitCode: EXIT_NO_UI };
  }

  try {
    await client.request('pane.send', {
      text: command.text,
      workspaceId: command.workspaceId,
      pane: command.pane,
    });
    client.close();
    return { kind: 'handled', exitCode: EXIT_SUCCESS };
  } catch (error) {
    client.close();
    const mapped = handleControlError(error);
    printError(mapped.message);
    return { kind: 'handled', exitCode: mapped.exitCode };
  }
}

async function runPaneCapture(
  command: Extract<CliCommand, { kind: 'pane.capture' }>
): Promise<CliOutcome> {
  const client = await withControlClient();
  if (!client) {
    printError('No active openmux UI. Attach first.');
    return { kind: 'handled', exitCode: EXIT_NO_UI };
  }

  try {
    const response = await client.request('pane.capture', {
      format: command.format,
      lines: command.lines,
      raw: command.raw,
      workspaceId: command.workspaceId,
      pane: command.pane,
    });
    const result = response.header.result as { text?: string } | undefined;
    console.log(result?.text ?? '');
    client.close();
    return { kind: 'handled', exitCode: EXIT_SUCCESS };
  } catch (error) {
    client.close();
    const mapped = handleControlError(error);
    printError(mapped.message);
    return { kind: 'handled', exitCode: mapped.exitCode };
  }
}

export async function runCli(args: string[]): Promise<CliOutcome> {
  const parsed = parseCliArgs(args);
  if (!parsed.ok) {
    printError(parsed.error);
    return { kind: 'handled', exitCode: EXIT_USAGE };
  }

  const command = parsed.command;

  switch (command.kind) {
    case 'help': {
      const version = await getCliVersion();
      console.log(formatHelp(command.topic, version));
      return { kind: 'handled', exitCode: EXIT_SUCCESS };
    }
    case 'attach':
      return { kind: 'attach', session: command.session };
    case 'update':
      return runUpdateCommand(command);
    case 'session.list':
      return runSessionList(command.json);
    case 'session.create':
      return runSessionCreate(command.name);
    case 'pane.split':
      return runPaneSplit(command);
    case 'pane.send':
      return runPaneSend(command);
    case 'pane.capture':
      return runPaneCapture(command);
    default:
      printError('Unknown command.');
      return { kind: 'handled', exitCode: EXIT_USAGE };
  }
}

export type { CliCommand, CliOutcome };
