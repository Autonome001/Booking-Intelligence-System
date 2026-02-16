import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { ConfigSchema, type Config } from './schema.js';
import { ZodError } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration Loader for Booking Intelligence System
 * Loads and validates YAML configuration files with environment-specific overrides
 */
export class ConfigLoader {
  private config: Config | null = null;
  private configPath: string;
  private environment: string;

  constructor(environment?: string) {
    this.environment = environment || process.env['NODE_ENV'] || 'development';
    this.configPath = this.resolveConfigPath();
  }

  /**
   * Resolve the configuration file path based on environment
   */
  private resolveConfigPath(): string {
    const configDir = join(__dirname, '..', '..', 'config');
    const envConfigPath = join(configDir, `${this.environment}.yaml`);
    const defaultConfigPath = join(configDir, 'default.yaml');

    // Try environment-specific config first
    if (existsSync(envConfigPath)) {
      return envConfigPath;
    }

    // Fall back to default config
    if (existsSync(defaultConfigPath)) {
      return defaultConfigPath;
    }

    throw new Error(
      `Configuration file not found. Tried: ${envConfigPath}, ${defaultConfigPath}`
    );
  }

  /**
   * Load configuration from YAML file
   */
  public load(): Config {
    if (this.config) {
      return this.config;
    }

    try {
      // Read YAML file
      const yamlContent = readFileSync(this.configPath, 'utf8');

      // Parse YAML
      const rawConfig = yamlLoad(yamlContent) as unknown;

      // Validate against Zod schema
      const validatedConfig = ConfigSchema.parse(rawConfig);

      // Apply environment variable substitution
      this.config = this.substituteEnvVars(validatedConfig);

      console.log(`✅ Configuration loaded successfully from: ${this.configPath}`);
      console.log(`📋 Environment: ${this.environment}`);

      return this.config;
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        console.error('❌ Configuration validation failed:');
        console.error(JSON.stringify(error.errors, null, 2));
        throw new Error(`Configuration validation failed: ${error.message}`);
      }

      if (error instanceof Error) {
        console.error(`❌ Failed to load configuration: ${error.message}`);
        throw error;
      }

      throw new Error('Unknown error loading configuration');
    }
  }

  /**
   * Substitute environment variables in configuration
   * Replaces ${ENV_VAR} patterns with actual environment variable values
   */
  private substituteEnvVars(config: Config): Config {
    const configString = JSON.stringify(config);
    const substituted = configString.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
      const value = process.env[envVar];
      if (value === undefined) {
        console.warn(`⚠️  Environment variable not found: ${envVar}`);
        return match; // Keep the original placeholder
      }
      return value;
    });

    return JSON.parse(substituted) as Config;
  }

  /**
   * Reload configuration (useful for hot-reload scenarios)
   */
  public reload(): Config {
    this.config = null;
    return this.load();
  }

  /**
   * Get specific configuration section
   */
  public get<K extends keyof Config>(section: K): Config[K] {
    if (!this.config) {
      this.load();
    }
    return this.config![section];
  }

  /**
   * Get full configuration
   */
  public getAll(): Config {
    if (!this.config) {
      this.load();
    }
    return this.config!;
  }

  /**
   * Validate configuration without loading
   */
  public static validate(configObject: unknown): Config {
    return ConfigSchema.parse(configObject);
  }
}

// Singleton instance
let configLoaderInstance: ConfigLoader | null = null;

/**
 * Get the global configuration loader instance
 */
export function getConfigLoader(): ConfigLoader {
  if (!configLoaderInstance) {
    configLoaderInstance = new ConfigLoader();
  }
  return configLoaderInstance;
}

/**
 * Get configuration singleton
 */
export function getConfig(): Config {
  return getConfigLoader().getAll();
}

/**
 * Get specific configuration section
 */
export function getConfigSection<K extends keyof Config>(section: K): Config[K] {
  return getConfigLoader().get(section);
}

// Export for convenience
export { Config, ConfigSchema };
