export interface SecretStore {
  resolveSecret(secretRef: string): Promise<string>;
}

export class EnvSecretStore implements SecretStore {
  async resolveSecret(secretRef: string): Promise<string> {
    if (secretRef.startsWith('vault://')) {
      throw new Error('SECRET_PROVIDER_UNSUPPORTED: Vault is not supported in MVP');
    }

    if (!secretRef.startsWith('env:')) {
      throw new Error('SECRET_REF_INVALID: Supported format is env:<VAR_NAME>');
    }

    const varName = secretRef.slice(4);
    const value = process.env[varName];

    if (!value) {
      throw new Error(`SECRET_NOT_FOUND: Environment variable ${varName} is not set`);
    }

    return value;
  }
}
