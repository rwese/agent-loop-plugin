export interface AgentLoopPluginOptions {
    taskLoop?: boolean;
    iterationLoop?: boolean;
    countdownSeconds?: number;
    errorCooldownMs?: number;
    toastDurationMs?: number;
    agent?: string;
    model?: string;
    debug?: boolean;
    logFilePath?: string;
    continuationPromptFile?: string;
}
interface InternalConfig {
    taskLoop: boolean;
    iterationLoop: boolean;
    countdownSeconds: number;
    errorCooldownMs: number;
    toastDurationMs: number;
    agent: string | undefined;
    model: string | undefined;
    debug: boolean;
    logFilePath: string | undefined;
    continuationPromptFile: string | undefined;
}
export declare function getEffectiveConfig(options?: AgentLoopPluginOptions): InternalConfig;
export declare function getConfigFilePath(): string;
export declare function isConfigFileValid(): boolean;
export declare function getConfigSourceInfo(): {
    path: string;
    exists: boolean;
    source: "file" | "defaults";
};
export {};
//# sourceMappingURL=config.d.ts.map