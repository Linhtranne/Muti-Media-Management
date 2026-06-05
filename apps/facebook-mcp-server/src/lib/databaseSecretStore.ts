import type { SecretStore } from "./secretStore.js";
import pg from "pg";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

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
    
    // We expect a 32-byte key for AES-256-GCM. 
    // It can be provided as a base64 string or 32-character string.
    this.encryptionKey = Buffer.from(keyString, 'base64');
    if (this.encryptionKey.length !== 32) {
      throw new Error("SECRET_ENCRYPTION_KEY must be a 32-byte base64 encoded string");
    }

    const connectionString = process.env.INSFORGE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("INSFORGE_URL or DATABASE_URL must be provided for DatabaseSecretStore");
    }

    this.pool = new pg.Pool({
      connectionString,
      max: 10 // Basic connection pool for MCP server
    });
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');
    
    // Format: iv:authTag:encryptedData
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

  async resolveSecret(secretRef: string): Promise<string> {
    const match = /^dbsecret:([^:]+):(.+)$/.exec(secretRef);
    if (!match) {
      throw new Error('SECRET_REF_INVALID: Supported format is dbsecret:<workspaceId>:<uuid>');
    }

    const [, workspaceId, id] = match;
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_workspace_id = $1`, [workspaceId]);
      
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
      // Setup workspace context for RLS
      await client.query(`SET LOCAL app.current_workspace_id = $1`, [workspaceId]);

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
