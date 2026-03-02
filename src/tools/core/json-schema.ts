export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface JsonSchema {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  description?: string;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  items?: JsonSchema;
  enum?: readonly JsonValue[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: JsonValue;
}
