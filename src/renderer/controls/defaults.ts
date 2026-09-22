import type { ScalarType, ScalarValue } from '@core/registry/types';

/** The value a brand new list/row-set entry starts with for one member/column's scalar type. */
export function defaultForType(type: ScalarType): ScalarValue {
  switch (type.kind) {
    case 'string':
    case 'text':
      return '';
    case 'creatureOrGo':
      return { target: 'creature', id: 0 };
    default:
      return 0;
  }
}
