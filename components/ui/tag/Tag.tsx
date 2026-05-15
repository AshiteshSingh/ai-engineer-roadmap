import * as React from "react";
import { cx } from "../cx";
import styles from "./Tag.module.css";

export type TagProps = React.ComponentPropsWithoutRef<"span">;

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, ...rest }, ref) => (
    <span ref={ref} className={cx(styles.tag, className)} {...rest} />
  ),
);
Tag.displayName = "Tag";
