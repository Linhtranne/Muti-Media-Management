export interface SecretStore {
  resolveSecret(secretRef: string): Promise<string>;
  storeSecret(workspaceId: string, suffix: string, secretValue: string): Promise<string>;
}

export class EnvSecretStore implements SecretStore {
  private readonly inMemoryStore = new Map<string, string>();

  async resolveSecret(secretRef: string): Promise<string> {
    await Promise.resolve();

    if (secretRef.startsWith('vault://')) {
      throw new Error('SECRET_PROVIDER_UNSUPPORTED: Vault is not supported in MVP');
    }

    if (!secretRef.startsWith('env:')) {
      throw new Error('SECRET_REF_INVALID: Supported format is env:<VAR_NAME>');
    }

    const varName = secretRef.slice(4);
    const value = process.env[varName] ?? this.inMemoryStore.get(varName);

    if (!value) {
      throw new Error(`SECRET_NOT_FOUND: Environment variable ${varName} is not set`);
    }

    return value;
  }

  async storeSecret(workspaceId: string, suffix: string, secretValue: string): Promise<string> {
    await Promise.resolve();

    const varName = `${workspaceId.replaceAll('-', '_').toUpperCase()}_${suffix.toUpperCase()}_${String(Date.now())}`;
    this.inMemoryStore.set(varName, secretValue);
    
    console.warn(`[WARNING] MVP in-memory secret store is volatile; configure a production secret provider before rollout.`);

    return `env:${varName}`;
  }
}
