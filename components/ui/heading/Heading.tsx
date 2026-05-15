import * as React from "react";
import { cx } from "../cx";
import styles from "./Heading.module.css";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export interface HeadingProps
  extends React.ComponentPropsWithoutRef<"h2"> {
  /** Semantic element to render. Default `h2`. */
  as?: HeadingTag;
  /** `md` (was `.yc-heading`) or `xl` (was `.yc-heading--xl`). */
  size?: "md" | "xl";
}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ as: Tag = "h2", size = "md", className, ...rest }, ref) => (
    <Tag
      ref={ref}
      className={cx(styles.heading, size === "xl" && styles.xl, className)}
      {...rest}
    />
  ),
);
Heading.displayName = "Heading";
