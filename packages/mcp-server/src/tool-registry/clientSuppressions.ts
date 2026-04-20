export interface ClientSuppressionOptions {
  applyClientSuppressions?: boolean;
  claudeCodeEnv?: string | undefined;
  enableMemoryForClaudeEnv?: string | undefined;
}

export function shouldSuppressMemoryTool(options: ClientSuppressionOptions = {}): boolean {
  const {
    applyClientSuppressions = true,
    claudeCodeEnv = process.env.CLAUDECODE,
    enableMemoryForClaudeEnv = process.env.FW_ENABLE_MEMORY_FOR_CLAUDE,
  } = options;

  return applyClientSuppressions &&
    claudeCodeEnv === '1' &&
    enableMemoryForClaudeEnv !== '1';
}
