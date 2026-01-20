/**
 * Minimal stub for @opencode-ai/plugin types
 * Used for CI environments where the actual plugin is not available
 */

export interface PluginContext {
  directory: string;
  client: {
    session: {
      get: (args: { path: { id: string } }) => Promise<{ data?: { id: string } }>;
      todo: (args: { path: { id: string } }) => Promise<unknown>;
      prompt: (args: { path: { id: string }; body: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: "text"; text: string }> }; query?: { directory?: string } }) => Promise<void>;
      messages: (args: { path: { id: string } }) => Promise<{ data?: Array<{ info?: { agent?: string; model?: { providerID: string; modelID: string } } }> }>;
    };
    tui: {
      showToast: (args: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<void>;
    };
  };
}

export type Plugin = (input: PluginContext) => Promise<{
  tools?: Record<string, unknown>;
  event?: (event: { event: unknown }) => Promise<void>;
}>;

export interface ToolDefinition<T extends (...args: unknown[]) => unknown> {
  description: string;
  args: Record<string, unknown>;
  execute: T;
}

export declare function tool<T extends (...args: unknown[]) => unknown>(
  definition: {
    description: string;
    args: Record<string, unknown>;
  },
  execute: T
): ToolDefinition<T>;