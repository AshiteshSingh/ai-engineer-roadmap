import type { CssCategory, CssProperty } from "./css-properties";
import type { MemorizeCategory, MemorizeItem } from "./memorize-types";

export function cssPropertyToMemorizeItem(prop: CssProperty): MemorizeItem {
  return {
    id: prop.id,
    term: prop.property,
    description: prop.shortDescription,
    details: prop.values.map((v) => ({
      label: v.value,
      description: v.description,
    })),
    context: `Default: ${prop.defaultValue} · Applies to: ${prop.appliesTo}`,
    demo: prop.demo,
    relatedItems: prop.relatedProps,
    mnemonicHint: prop.mnemonicHint,
  };
}

export function cssCategoryToMemorizeCategory(
  cat: CssCategory,
): MemorizeCategory {
  return {
    id: cat.id,
    name: cat.name,
    icon: cat.icon,
    color: cat.color,
    items: cat.properties.map(cssPropertyToMemorizeItem),
  };
}

export function cssCategoriesToMemorize(
  cats: CssCategory[],
): MemorizeCategory[] {
  return cats.map(cssCategoryToMemorizeCategory);
}
