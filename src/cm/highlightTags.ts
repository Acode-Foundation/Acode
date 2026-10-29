import { Tag, tags as t } from "@lezer/highlight";

/**
 * Property names in JavaScript/TypeScript: `obj.foo`, object keys and class
 * fields. It is a sub-tag of `propertyName`, so themes that don't style it
 * keep their `propertyName` colour, and themes that do can colour JS
 * properties apart from methods without changing CSS properties, JSON/YAML
 * keys or other languages that share `propertyName`.
 */
export const memberProperty = Tag.define("memberProperty", t.propertyName);
