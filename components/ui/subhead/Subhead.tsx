import * as React from "react";
import { cx } from "../cx";
import styles from "./Subhead.module.css";

export type SubheadProps = React.ComponentPropsWithoutRef<"p">;

export const Subhead = React.forwardRef<HTMLParagraphElement, SubheadProps>(
  ({ className, ...rest }, ref) => (
    <p ref={ref} className={cx(styles.subhead, className)} {...rest} />
  ),
);
Subhead.displayName = "Subhead";
