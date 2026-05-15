import * as React from "react";
import { cx } from "../cx";
import styles from "./Eyebrow.module.css";

export type EyebrowProps = React.ComponentPropsWithoutRef<"span">;

export const Eyebrow = React.forwardRef<HTMLSpanElement, EyebrowProps>(
  ({ className, ...rest }, ref) => (
    <span ref={ref} className={cx(styles.eyebrow, className)} {...rest} />
  ),
);
Eyebrow.displayName = "Eyebrow";
