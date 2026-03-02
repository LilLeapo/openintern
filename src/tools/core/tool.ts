import type { JsonSchema, JsonValue } from "./json-schema.js";

export interface ToolExecutionContext {
  signal?: AbortSignal;
}

type TypeName = "string" | "integer" | "number" | "boolean" | "array" | "object";

function typeMatches(value: unknown, typeName: TypeName): boolean {
  switch (typeName) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

function validateRecursive(value: unknown, schema: JsonSchema, path = "parameter"): string[] {
  const errors: string[] = [];
  const schemaType = schema.type as TypeName | undefined;
  if (schemaType && !typeMatches(value, schemaType)) {
    return [`${path} should be ${schemaType}`];
  }

  if (schema.enum && !schema.enum.includes(value as JsonValue)) {
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} chars`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} chars`);
    }
  }

  if (schemaType === "object") {
    const obj = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        errors.push(`missing required ${path === "parameter" ? key : `${path}.${key}`}`);
      }
    }
    for (const [key, propValue] of Object.entries(obj)) {
      const propSchema = properties[key];
      if (propSchema) {
        const nextPath = path === "parameter" ? key : `${path}.${key}`;
        errors.push(...validateRecursive(propValue, propSchema, nextPath));
      }
    }
  }

  if (schemaType === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, idx) => {
      errors.push(...validateRecursive(item, schema.items as JsonSchema, `${path}[${idx}]`));
    });
  }

  return errors;
}

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchema;

  validateParams(params: Record<string, unknown>): string[] {
    const schema = this.parameters;
    if (schema.type !== "object") {
      throw new Error(`Tool schema for ${this.name} must be object type`);
    }
    return validateRecursive(params, schema, "parameter");
  }

  abstract execute(
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string>;

  toSchema(): Record<string, unknown> {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

