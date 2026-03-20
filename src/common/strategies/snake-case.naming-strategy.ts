import { DefaultNamingStrategy } from 'typeorm';

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

export class SnakeCaseNamingStrategy extends DefaultNamingStrategy {
  columnName(propertyName: string, customName: string, embeddeds: string[]): string {
    return customName ?? toSnakeCase(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }
}
