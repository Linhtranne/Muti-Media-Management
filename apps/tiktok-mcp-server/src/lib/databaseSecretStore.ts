import type { SecretStore } from "./secretStore.js";
import pg from "pg";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AES_256_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;

interface SecretRow {
  ciphertext: string;
  status: string;
}

interface InsertSecretRow {
  id: string;
}

export class DatabaseSecretStore implements SecretStore {
  private readonly pool: pg.Pool;
  private readonly encryptionKey: Buffer;

  constructor() {
    const keyString = process.env.SECRET_ENCRYPTION_KEY;
    if (!keyString) {
      throw new Error("SECRET_ENCRYPTION_KEY environment variable is missing");
    }
    
    this.encryptionKey = Buffer.from(keyString, 'base64');
    if (this.encryptionKey.length !== AES_256_KEY_BYTES) {
      throw new Error("SECRET_ENCRYPTION_KEY must be a 32-byte base64 encoded string");
    }

    const connectionString = process.env.INSFORGE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("INSFORGE_URL or DATABASE_URL must be provided for DatabaseSecretStore");
    }

    this.pool = new pg.Pool({
      connectionString,
      max: 10
    });
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(AES_GCM_IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');
    
    return `${iv.toString('base64')}:${authTag}:${encrypted}`;
  }

  private decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error("Invalid ciphertext format");
    }
    
    const [ivStr, authTagStr, encryptedStr] = parts;
    const iv = Buffer.from(ivStr, 'base64');
    const authTag = Buffer.from(authTagStr, 'base64');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedStr, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async resolveSecretForChannel(workspaceId: string, channelAccountId: string): Promise<string> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_workspace_id', $1, true)`,
        [workspaceId]
      );
      
      const result = await client.query<{ secret_ref: string }>(
        `SELECT secret_ref FROM channel_accounts 
         WHERE (id::text = $1 OR external_account_id = $1) 
           AND workspace_id = $2
           AND lower(platform) = 'tiktok'
           AND status = 'active'
           AND token_status = 'valid'`,
        [channelAccountId, workspaceId]
      );

      await client.query('COMMIT');

      if (result.rows.length === 0) {
        throw new Error(`CHANNEL_ACCOUNT_NOT_FOUND: Active TikTok account ${channelAccountId} not found in workspace ${workspaceId}`);
      }

      const secretRef = result.rows[0].secret_ref;
      return await this.resolveSecret(secretRef);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveSecret(secretRef: string): Promise<string> {
    const match = /^dbsecret:([^:]+):(.+)$/.exec(secretRef);
    if (!match) {
      throw new Error('SECRET_REF_INVALID: Supported format is dbsecret:<workspaceId>:<uuid>');
    }

    const [, workspaceId, id] = match;
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_workspace_id', $1, true)`,
        [workspaceId]
      );
      
      const result = await client.query<SecretRow>(
        `SELECT ciphertext, status FROM secret_references WHERE id = $1`,
        [id]
      );

      await client.query('COMMIT');

      if (result.rows.length === 0) {
        throw new Error(`SECRET_NOT_FOUND: Secret reference ${id} not found`);
      }

      const row = result.rows[0];
      if (row.status !== 'active') {
        throw new Error(`SECRET_REVOKED: Secret reference ${id} is no longer active`);
      }

      return this.decrypt(row.ciphertext);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async storeSecret(workspaceId: string, suffix: string, secretValue: string): Promise<string> {
    const ciphertext = this.encrypt(secretValue);
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_workspace_id', $1, true)`,
        [workspaceId]
      );

      const result = await client.query<InsertSecretRow>(
        `
        INSERT INTO secret_references (workspace_id, provider, purpose, ciphertext, status)
        VALUES ($1, 'dbsecret', $2, $3, 'active')
        RETURNING id
        `,
        [workspaceId, suffix, ciphertext]
      );
      await client.query('COMMIT');

      const id = result.rows[0].id;
      return `dbsecret:${workspaceId}:${id}`;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
