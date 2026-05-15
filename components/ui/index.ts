// Dependency-free design-system primitives (Phase 2).
// CSS Modules + cx(); no Radix runtime deps. Styles relocated out of
// app/globals.css (the YC PRIMITIVES block).
export { cx } from "./cx";

export { Section } from "./section";
export type { SectionProps } from "./section";
export { Eyebrow } from "./eyebrow";
export type { EyebrowProps } from "./eyebrow";
export { Heading } from "./heading";
export type { HeadingProps } from "./heading";
export { Subhead } from "./subhead";
export type { SubheadProps } from "./subhead";
export { Button } from "./button";
export type { ButtonProps } from "./button";
export { Card } from "./card";
export type { CardProps } from "./card";
export { Tag } from "./tag";
export type { TagProps } from "./tag";
export { Pill } from "./pill";
export type { PillProps } from "./pill";
export { Stat } from "./stat";
export type { StatProps } from "./stat";
export { Divider } from "./divider";
export type { DividerProps } from "./divider";
